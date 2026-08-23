"""Generate the worker config from the decorated workflows and a namespace spec.

Two inputs, both already the source of truth for what they describe:

  * the code, via the decorators -- which queues, which workflows, which namespace
  * the spec, via specs/<name>.yaml -- who owns it, what it is called

Nothing is hand-listed, so the config cannot drift from either. Run through the
CLI facade rather than directly:

    nsctl worker gen-config --out generated/worker-config.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

import workflows  # noqa: F401 -- imported for the decorator side effects
from platform_sdk.config import SCHEMA_VERSION, Entry, WorkerConfig, validate
from platform_sdk.registry import registry


def build(spec: dict, environment: str, image: str = "") -> WorkerConfig:
    if not registry.workflows:
        raise SystemExit(
            "no workflows were declared.\n\n"
            "Every workflow module has to be imported for its decorator to run. "
            "Add it to workflows/__init__.py."
        )

    name = spec["name"]
    declared = registry.namespaces()
    if name not in declared:
        raise SystemExit(
            f"spec is for namespace {name!r} but the code declares {declared}.\n"
            f"Fix the namespace= argument on the decorator, or generate against the right spec."
        )

    return WorkerConfig(
        version=SCHEMA_VERSION,
        service=f"{name}-{environment}-worker",
        owner=spec["owner"],
        namespace=name,
        environment=environment,
        taskQueues=registry.task_queues(),
        workflows=[Entry(name=w.name, taskQueue=w.task_queue) for w in registry.workflows],
        activities=[Entry(name=a.name, taskQueue=a.task_queue) for a in registry.activities],
        image=image,
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="gen-config", description=__doc__)
    p.add_argument("--spec", default=None, help="namespace spec to derive service and owner from")
    p.add_argument("--environment", default="staging", choices=["staging", "prod"])
    p.add_argument("--image", default="", help="container image to record in the config")
    p.add_argument("--out", default=None, help="write here instead of stdout")
    args = p.parse_args(argv)

    spec_path = Path(args.spec) if args.spec else default_spec_path()
    spec = yaml.safe_load(spec_path.read_text())

    config = build(spec, args.environment, args.image)
    validate(config.to_dict())

    body = config.to_json()
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(body)
        print(f"wrote {out}", file=sys.stderr)
        print(
            f"  {len(config.workflows)} workflow(s), {len(config.activities)} activity(ies), "
            f"queues {config.taskQueues}",
            file=sys.stderr,
        )
    else:
        sys.stdout.write(body)
    return 0


def default_spec_path() -> Path:
    """Find the spec matching the namespace the code declares.

    Derived rather than asked for, because there is exactly one right answer and
    making a student type it is how typos become deploys.
    """
    declared = registry.namespaces()
    if len(declared) != 1:
        raise SystemExit(
            f"this worker declares {declared}; pass --spec to say which one to generate for"
        )
    root = Path(__file__).resolve().parents[2]
    candidate = root / "specs" / f"{declared[0]}.yaml"
    if not candidate.is_file():
        raise SystemExit(
            f"no spec at {candidate}. The code declares namespace {declared[0]!r};\n"
            f"create it with: nsctl new --name {declared[0]}"
        )
    return candidate


if __name__ == "__main__":
    raise SystemExit(main())
