"""Lab 4's feedback loop.

Every test here depends on the workflow you write in workflows/greeting.py, so
they all fail on a fresh clone. That is deliberate: run them, read the failure,
make it pass.

    cd worker && uv run pytest -m lab

`make py-test` deliberately skips these, so repo health and lab progress are
different questions with different answers.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from platform_sdk.config import ConfigMismatch, Entry, WorkerConfig
from platform_sdk.genconfig import build
from platform_sdk.registry import registry
from platform_sdk.validate import check

pytestmark = pytest.mark.lab

FIXTURE = Path(__file__).parent / "fixtures" / "worker-config.json"
REPO = Path(__file__).resolve().parents[2]


def test_a_workflow_is_declared():
    """The decorator has to actually run, which means the module has to be imported."""
    assert registry.workflows, (
        "no workflows declared. Either greeting.py has no @managed_workflow yet, "
        "or its module is not imported in workflows/__init__.py -- a decorator that "
        "never runs registers nothing."
    )


def test_the_workflow_declares_a_queue_and_a_namespace():
    entry = registry.workflows[0]
    assert entry.task_queue, "the workflow must declare a task_queue"
    assert entry.namespace, "the workflow must declare a namespace, matching your spec"


def test_an_activity_is_declared_on_the_same_queue():
    assert registry.activities, "no activities declared -- the workflow needs something to call"
    assert registry.activities[0].task_queue == registry.workflows[0].task_queue


def test_generated_config_equals_the_golden_fixture():
    """gen-config against the example spec must reproduce the fixture exactly.

    This is the test that protects the cross-language contract: it fails the
    moment a decorator changes a queue name without the fixture being updated.
    """
    spec = yaml.safe_load((REPO / "specs" / "_example.yaml").read_text())
    assert build(spec, environment="staging").to_dict() == json.loads(FIXTURE.read_text())


def test_the_worker_accepts_the_generated_config():
    check(WorkerConfig.load(FIXTURE), registry)


def test_the_worker_refuses_a_config_that_expects_a_workflow_nobody_declared():
    config = WorkerConfig.load(FIXTURE)
    config.workflows.append(Entry(name="GhostWorkflow", taskQueue=config.taskQueues[0]))
    with pytest.raises(ConfigMismatch) as e:
        check(config, registry)
    assert "GhostWorkflow" in str(e.value)
    assert "nothing declared it" in str(e.value)


def test_the_worker_refuses_a_config_missing_a_workflow_the_code_declares():
    config = WorkerConfig.load(FIXTURE)
    config.workflows = []
    with pytest.raises(ConfigMismatch) as e:
        check(config, registry)
    assert "declared in code but missing from the config" in str(e.value)
