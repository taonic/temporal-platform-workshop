"""The managed worker.

A product team never writes this file. The platform provides it, and the team
writes decorated workflows. That division is the whole point: the boundary is what
lets four people run seven hundred namespaces.

Startup order matters and is deliberate:

  1. load the generated config
  2. check it against what the code actually registered, and die loudly if they
     disagree -- before connecting to anything
  3. fetch the credential from Vault, as this pod's own identity
  4. poll
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

from temporalio.client import Client
from temporalio.service import TLSConfig
from temporalio.worker import Worker

import workflows  # noqa: F401 -- imported for the decorator side effects
from platform_sdk import validate as config_check
from platform_sdk.config import ConfigMismatch, WorkerConfig
from platform_sdk.registry import registry
from platform_sdk.vault import Vault, VaultError

log = logging.getLogger("managed-worker")


async def run(config: WorkerConfig) -> None:
    namespace = os.environ.get("TEMPORAL_NAMESPACE")
    if not namespace:
        raise SystemExit(
            "TEMPORAL_NAMESPACE is not set.\n"
            "The physical namespace is a platform decision, not a value you type: the "
            "generated manifest sets it, derived from the username you chose. Running "
            f"by hand? Get it from `tpctl status {config.namespace}`."
        )

    address = os.environ.get("TEMPORAL_ADDRESS", "us-west-2.aws.api.temporal.io:7233")
    api_key = resolve_api_key(config)

    if api_key:
        client = await Client.connect(
            address,
            namespace=namespace,
            api_key=api_key,
            tls=TLSConfig(),
        )
    else:
        # Local dev against `temporal server start-dev`.
        client = await Client.connect(
            os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"), namespace=namespace
        )

    workers = [
        Worker(
            client,
            task_queue=queue,
            workflows=registry.workflows_for(queue),
            activities=registry.activities_for(queue),
        )
        for queue in config.taskQueues
    ]

    log.info(
        "polling namespace=%s queues=%s workflows=%d",
        namespace,
        config.taskQueues,
        len(config.workflows),
    )

    # Serve /healthz only once the workers exist and the client has connected.
    #
    # A worker has no port of its own, so the honest options were an exec probe on
    # the process -- which tells you only what the container exiting already tells
    # you -- or this. The distinction that matters to Kubernetes is between "the
    # process is up" and "it reached Temporal", because the failures here are all
    # the second kind: no credential, wrong namespace, unreachable Cloud. Every one
    # of those happens BEFORE this point, so a served /healthz means the client
    # connected and the queues are being polled.
    health = await serve_health()
    try:
        await asyncio.gather(*(w.run() for w in workers))
    finally:
        health.close()
        await health.wait_closed()


async def serve_health(port: int | None = None) -> asyncio.AbstractServer:
    """A one-route HTTP server: 200 on /healthz, 404 otherwise.

    Hand-rolled on asyncio rather than pulling in a web framework. The worker's
    dependencies are temporalio, jsonschema and pyyaml; adding aiohttp so that a
    probe has something to talk to would be a poor trade, and this is twelve lines.
    """
    port = port or int(os.environ.get("HEALTH_PORT", "8080"))

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request = await asyncio.wait_for(reader.readline(), timeout=5)
            path = request.decode("latin-1").split(" ")[1] if b" " in request else "/"
            body, status = (b"ok\n", "200 OK") if path.startswith("/healthz") else (b"", "404 Not Found")
            writer.write(
                f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\n"
                "Content-Type: text/plain\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            await writer.drain()
        except (asyncio.TimeoutError, ConnectionError, IndexError):
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "0.0.0.0", port)
    log.info("health endpoint on :%d/healthz", port)
    return server


def resolve_api_key(config: WorkerConfig) -> str | None:
    """Fetch the credential the platform minted for this namespace.

    The path comes from config or the environment; the secret comes from Vault.
    Nothing in this container, this manifest or this image contains a key.
    """
    path = os.environ.get("VAULT_SECRET_PATH") or config.vaultPath
    if not path:
        if os.environ.get("TEMPORAL_API_KEY"):
            return os.environ["TEMPORAL_API_KEY"]
        return None
    try:
        vault = Vault.from_env()
        return vault.read_field(path, "api_key")
    except VaultError as e:
        raise SystemExit(
            f"could not read the worker credential from Vault at {path}:\n  {e}\n\n"
            "The platform wrote a path here, not a secret. If this is a pod, check that "
            "VAULT_K8S_ROLE matches a Vault role bound to this ServiceAccount."
        ) from e


def log_level() -> tuple[int, str | None]:
    """Read LOG_LEVEL tolerantly. Returns the level, and the bad value if any.

    logging.basicConfig accepts a level NAME, and only the upper-case ones. So
    LOG_LEVEL=info -- lower case, which most tools accept and which plenty of
    shells already export -- raises ValueError from inside basicConfig before the
    worker has done anything at all, with a traceback that ends in logging
    internals and never mentions the variable.

    A logging preference is not worth a crash, and refusing to start is a thing
    this worker does deliberately and narrowly: on a config mismatch, where the
    alternative is running the wrong code. Not on a typo in a log level.
    """
    raw = (os.environ.get("LOG_LEVEL") or "INFO").strip()
    level = logging.getLevelNamesMapping().get(raw.upper())
    if level is None:
        return logging.INFO, raw
    return level, None


def main(argv: list[str] | None = None) -> int:
    level, unknown = log_level()
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-5s %(name)s %(message)s",
    )
    if unknown:
        log.warning(
            "LOG_LEVEL=%r is not a level name; using INFO. "
            "Try DEBUG, INFO, WARNING, ERROR or CRITICAL.",
            unknown,
        )

    p = argparse.ArgumentParser(prog="managed-worker")
    p.add_argument(
        "--config",
        default=os.environ.get("WORKER_CONFIG", "worker-config.json"),
        help="generated worker config",
    )
    args = p.parse_args(argv)

    # Checked before load(), so that a FileNotFoundError from anywhere else inside
    # it -- the JSON schema, most easily -- is not reported as a missing config.
    # It was, once: the schema was baked into the directory the config ConfigMap
    # mounts over, and the resulting message sent everyone to look at the config,
    # which was present and correct the whole time.
    if not os.path.exists(args.config):
        print(
            f"no worker config at {args.config}.\n"
            "Generate it: tpctl worker gen-config --out worker-config.json",
            file=sys.stderr,
        )
        return 2

    try:
        config = WorkerConfig.load(args.config)
    except FileNotFoundError as e:
        print(
            f"{args.config} is there, but something it needs is not: {e}\n"
            "This is a packaging problem rather than anything you did.",
            file=sys.stderr,
        )
        return 2

    # Before anything else, and fatally.
    try:
        config_check.check(config, registry)
    except ConfigMismatch as e:
        print(f"{e}", file=sys.stderr)
        return 3

    try:
        asyncio.run(run(config))
    except KeyboardInterrupt:
        log.info("stopping")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
