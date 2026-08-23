"""The two decorators that are the platform's entire product surface.

A workflow declares where it runs, next to the code that runs there:

    @managed_workflow(task_queue="orders-main", namespace="orders")
    class SubmitOrder:
        @workflow.run
        async def run(self, req: Request) -> Response:
            ...

Nobody writes a task-queue name in a YAML file, nobody writes a worker manifest,
and nobody can forget to register a workflow -- because declaring it *is*
registering it. That last part is the fix for the failure the OpenAI talk names
out loud: "always register that workflow at bootstrap; often times people miss
that."
"""

from __future__ import annotations

from typing import Callable, TypeVar

from temporalio import activity, workflow

from platform_sdk.registry import ActivityEntry, WorkflowEntry, registry

T = TypeVar("T", bound=type)


def managed_workflow(*, task_queue: str, namespace: str) -> Callable[[T], T]:
    """Declare a workflow and where it runs.

    Wraps Temporal's own @workflow.defn, so a managed workflow is an ordinary
    Temporal workflow -- there is no parallel universe to learn, and dropping the
    platform later means deleting one decorator.
    """
    if not task_queue:
        raise ValueError("task_queue is required: a workflow that does not say where it runs cannot be deployed")
    if not namespace:
        raise ValueError("namespace is required: it links this workflow to a namespace spec")

    def decorate(cls: T) -> T:
        defined = workflow.defn(cls)
        registry.add_workflow(
            WorkflowEntry(
                name=cls.__name__,
                task_queue=task_queue,
                namespace=namespace,
                cls=defined,
            )
        )
        return defined

    return decorate


def managed_activity(*, task_queue: str) -> Callable[[Callable], Callable]:
    """Declare an activity and the queue it is served on.

    Activities get their own queue in the general case -- separating workflow and
    activity task queues is the first tuning lever any platform team reaches for.
    Here the default is to share, because one worker is enough for a workshop, and
    pretending otherwise would teach premature partitioning.
    """
    if not task_queue:
        raise ValueError("task_queue is required")

    def decorate(fn: Callable) -> Callable:
        defined = activity.defn(fn)
        registry.add_activity(ActivityEntry(name=fn.__name__, task_queue=task_queue, fn=defined))
        return defined

    return decorate
