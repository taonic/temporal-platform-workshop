"""The boot-time check that makes a forgotten registration loud.

On startup the worker compares the config it was handed against the workflows it
actually registered, and refuses to start if they disagree -- exiting non-zero
with the discrepancy named.

Not a warning. A warning in a pod's logs is a warning nobody reads, and the
failure it would hide is the worst kind: a workflow that starts, gets scheduled,
and is never picked up, because the one worker that should have run it does not
know it exists.
"""

from __future__ import annotations

from platform_sdk.config import ConfigMismatch, WorkerConfig
from platform_sdk.registry import Registry


def check(config: WorkerConfig, registry: Registry) -> None:
    problems: list[str] = []

    declared = {(w.name, w.task_queue) for w in registry.workflows}
    configured = {(w.name, w.taskQueue) for w in config.workflows}

    for name, queue in sorted(configured - declared):
        problems.append(
            f"config expects workflow {name!r} on queue {queue!r}, but nothing declared it. "
            f"Is its module imported in workflows/__init__.py?"
        )
    for name, queue in sorted(declared - configured):
        problems.append(
            f"workflow {name!r} on queue {queue!r} is declared in code but missing from the config. "
            f"Regenerate it: tpctl worker gen-config"
        )

    declared_acts = {(a.name, a.task_queue) for a in registry.activities}
    configured_acts = {(a.name, a.taskQueue) for a in config.activities}
    for name, queue in sorted(configured_acts - declared_acts):
        problems.append(f"config expects activity {name!r} on queue {queue!r}, but nothing declared it")
    for name, queue in sorted(declared_acts - configured_acts):
        problems.append(f"activity {name!r} on queue {queue!r} is declared in code but missing from the config")

    if set(config.taskQueues) != set(registry.task_queues()):
        problems.append(
            f"task queues disagree: config has {sorted(config.taskQueues)}, "
            f"code declares {registry.task_queues()}"
        )

    if config.namespace not in registry.namespaces():
        problems.append(
            f"config is for namespace {config.namespace!r} but the code declares "
            f"{registry.namespaces()}. This worker would poll the wrong namespace."
        )

    if problems:
        raise ConfigMismatch(
            "this worker will not start, because its config and its code disagree:\n  - "
            + "\n  - ".join(problems)
        )
