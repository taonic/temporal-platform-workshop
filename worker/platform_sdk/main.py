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
            "The physical namespace is a platform decision -- the generated manifest sets it "
            "from the leased slot. Running by hand? Get it from `nsctl status "
            f"{config.namespace}`."
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
    await asyncio.gather(*(w.run() for w in workers))


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


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-5s %(name)s %(message)s",
    )

    p = argparse.ArgumentParser(prog="managed-worker")
    p.add_argument(
        "--config",
        default=os.environ.get("WORKER_CONFIG", "generated/worker-config.json"),
        help="generated worker config",
    )
    args = p.parse_args(argv)

    try:
        config = WorkerConfig.load(args.config)
    except FileNotFoundError:
        print(
            f"no worker config at {args.config}.\n"
            "Generate it: nsctl worker gen-config --out generated/worker-config.json",
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
