"""Contract tests. These pass on a fresh clone and must stay passing.

The golden fixture is the one document both languages must agree about; Go reads
the same file in internal/workerconfig/config_test.go. Nothing here depends on
student code -- the tests that do live in test_lab.py.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from platform_sdk.config import ConfigInvalid, WorkerConfig, validate

FIXTURE = Path(__file__).parent / "fixtures" / "worker-config.json"
REPO = Path(__file__).resolve().parents[2]


def test_fixture_matches_schema():
    validate(json.loads(FIXTURE.read_text()))


def test_fixture_round_trips():
    original = json.loads(FIXTURE.read_text())
    assert WorkerConfig.from_dict(original).to_dict() == original


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
