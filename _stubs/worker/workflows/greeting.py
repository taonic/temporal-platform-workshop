# ============================================================================
# Lab 4 — The paved road
#
# Goal: be the product team. Write a workflow that declares where it runs, and
#       let the platform do everything else.
#
# Write below:
#   · an activity, decorated with @managed_activity(task_queue=TASK_QUEUE), that
#     takes a name and returns a greeting string. Make it async.
#   · a workflow class, decorated with
#     @managed_workflow(task_queue=TASK_QUEUE, namespace=NAMESPACE), with one
#     method decorated @workflow.run that takes a name and awaits the activity
#     via workflow.execute_activity with a start_to_close_timeout.
#
# TASK_QUEUE and NAMESPACE are below. NAMESPACE must match the `name` in your
# spec — the platform links the two, and gen-config refuses to run if they
# disagree rather than generating a config for a namespace that does not exist.
#
# Now notice what you are NOT writing, because this is the entire point of the
# challenge:
#
#   no namespace plumbing        the manifest sets it, from your leased slot
#   no task-queue constant       shared with a deployment file you must remember
#                                to update — the decorator IS the declaration
#   no API key                   the platform minted one and put it in Vault
#   no client construction       platform_sdk/main.py connects
#   no Dockerfile, no manifest   nsctl generates both from what you declared here
#
# That list is the paved road. The measure of it is time-to-first-workflow, and
# challenge 5 puts a stopwatch on writing a file exactly like this one.
#
# Two things follow from the decorator, and they are worth understanding rather
# than just obeying:
#
#   1. A decorator only runs when its module is imported. workflows/__init__.py
#      imports this module for that reason and no other. Comment that import out
#      and the registry is empty — which is the failure OpenAI's platform team
#      calls out by name: "always register that workflow at bootstrap; often times
#      people miss that."
#
#   2. Because the config is generated from the registry, it cannot drift from the
#      code. And because the worker re-checks the config against the registry on
#      boot, it refuses to start if they ever disagree — non-zero exit, not a
#      warning. Try it: generate the config, then rename your workflow class.
#
# Your feedback loop:
#
#   cd worker && uv run pytest -m lab
#
# Then generate and inspect what the platform made of it:
#
#   nsctl worker gen-config --out generated/worker-config.json
# ============================================================================

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow

from platform_sdk import managed_activity, managed_workflow

TASK_QUEUE = "orders-main"
NAMESPACE = "orders"
