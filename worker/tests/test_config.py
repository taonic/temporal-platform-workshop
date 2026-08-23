"""The golden fixture, from the Python side.

tests/fixtures/worker-config.json is the one document both languages must agree
about. Go reads the same file in internal/workerconfig/config_test.go. If the two
ever diverge, one of these tests fails before anything reaches a cluster.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from platform_sdk.config import ConfigInvalid, ConfigMismatch, WorkerConfig, validate
from platform_sdk.genconfig import build
from platform_sdk.registry import registry
from platform_sdk.validate import check

FIXTURE = Path(__file__).parent / "fixtures" / "worker-config.json"
REPO = Path(__file__).resolve().parents[2]


def test_fixture_matches_schema():
    validate(json.loads(FIXTURE.read_text()))


def test_fixture_round_trips():
    original = json.loads(FIXTURE.read_text())
    assert WorkerConfig.from_dict(original).to_dict() == original


def test_generated_config_equals_fixture():
    """gen-config against the example spec must reproduce the golden fixture.

    This is the test that actually protects the contract: it fails the moment a
    decorator changes a queue name, or the spec changes an owner, without the
    fixture being updated to match.
    """
    spec = yaml.safe_load((REPO / "specs" / "_example.yaml").read_text())
    generated = build(spec, environment="staging").to_dict()
    assert generated == json.loads(FIXTURE.read_text())


def test_worker_refuses_a_config_that_disagrees_with_the_code():
    """The whole point of boot-time validation."""
    config = WorkerConfig.load(FIXTURE)
    config.workflows.append(type(config.workflows[0])(name="GhostWorkflow", taskQueue="orders-main"))

    with pytest.raises(ConfigMismatch) as e:
        check(config, registry)
    assert "GhostWorkflow" in str(e.value)
    assert "nothing declared it" in str(e.value)


def test_worker_refuses_a_config_missing_a_declared_workflow():
    config = WorkerConfig.load(FIXTURE)
    config.workflows = []
    with pytest.raises(ConfigMismatch) as e:
        check(config, registry)
    assert "declared in code but missing from the config" in str(e.value)


def test_worker_accepts_the_generated_config():
    check(WorkerConfig.load(FIXTURE), registry)


def test_schema_copies_are_identical():
    """The image ships its own copy of the schema. It must not drift."""
    canonical = (REPO / "schema" / "workerconfig.schema.json").read_text()
    shipped = (REPO / "worker" / "schema" / "workerconfig.schema.json").read_text()
    assert canonical == shipped, "run `make sync-schema`"


def test_invalid_config_is_rejected_with_a_useful_location():
    bad = json.loads(FIXTURE.read_text())
    bad["environment"] = "production"  # not in the enum
    with pytest.raises(ConfigInvalid) as e:
        validate(bad)
    assert "environment" in str(e.value)
