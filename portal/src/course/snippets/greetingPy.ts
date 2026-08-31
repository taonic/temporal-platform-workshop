// GENERATED from the reference solution. Do not hand-edit the code below --
// `pnpm snippets:emit` writes it back to worker/workflows/greeting.py and `./scripts/workshop verify` compiles it
// there, so a drifted copy fails CI rather than a student's paste.
//
// The spec name is interpolated: the decorator's namespace has to match the
// student's own spec, and the portal reads it from the namespace tags.
export const greetingPy = (spec: string) => `"""A product team's code, in full.

Note what is absent: no namespace plumbing, no task-queue constant shared with a
deployment file, no API key, no client construction, no Dockerfile, no manifest.
The decorator says where this runs, and the platform does the rest.

That is the paved road. The measure of it is time-to-first-workflow, and the last
challenge puts a stopwatch on exactly this file.
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow

from platform_sdk import managed_activity, managed_workflow

TASK_QUEUE = "${spec}-main"
NAMESPACE = "${spec}"


@managed_activity(task_queue=TASK_QUEUE)
async def compose_greeting(name: str) -> str:
    return f"Hello, {name}. Your platform provisioned this namespace for you."


@managed_workflow(task_queue=TASK_QUEUE, namespace=NAMESPACE)
class GreetingWorkflow:
    @workflow.run
    async def run(self, name: str) -> str:
        return await workflow.execute_activity(
            compose_greeting,
            name,
            start_to_close_timeout=timedelta(seconds=30),
        )
`;
