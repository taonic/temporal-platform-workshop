"""What the decorators recorded.

This is the single source of truth for "what does this worker actually run". The
generated config is derived from it, and on boot the worker checks the config
against it again -- so a config can never quietly disagree with the code.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class WorkflowEntry:
    name: str
    task_queue: str
    namespace: str
    cls: type


@dataclass(frozen=True)
class ActivityEntry:
    name: str
    task_queue: str
    fn: object


@dataclass
class Registry:
    workflows: list[WorkflowEntry] = field(default_factory=list)
    activities: list[ActivityEntry] = field(default_factory=list)

    def add_workflow(self, entry: WorkflowEntry) -> None:
        existing = {w.name for w in self.workflows}
        if entry.name in existing:
            raise ValueError(
                f"workflow {entry.name!r} is declared twice. Temporal keys workflows "
                f"by type name, so two declarations mean one of them will never run."
            )
        self.workflows.append(entry)

    def add_activity(self, entry: ActivityEntry) -> None:
        existing = {a.name for a in self.activities}
        if entry.name in existing:
            raise ValueError(f"activity {entry.name!r} is declared twice")
        self.activities.append(entry)

    def task_queues(self) -> list[str]:
        queues = {w.task_queue for w in self.workflows} | {a.task_queue for a in self.activities}
        return sorted(queues)

    def namespaces(self) -> list[str]:
        return sorted({w.namespace for w in self.workflows})

    def workflows_for(self, task_queue: str) -> list[type]:
        return [w.cls for w in self.workflows if w.task_queue == task_queue]

    def activities_for(self, task_queue: str) -> list[object]:
        return [a.fn for a in self.activities if a.task_queue == task_queue]


registry = Registry()
