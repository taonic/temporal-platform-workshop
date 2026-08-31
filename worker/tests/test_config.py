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


def test_log_level_is_case_insensitive_and_never_fatal(monkeypatch):
    """LOG_LEVEL=info must not stop the worker starting.

    logging.basicConfig only accepts the upper-case level names, so a lower-case
    value -- which most tools accept, and which plenty of shells already export --
    used to raise ValueError from inside logging before the worker did anything,
    with a traceback that never mentioned the variable.
    """
    import logging

    from platform_sdk.main import log_level

    for value, want in [("info", logging.INFO), ("INFO", logging.INFO), ("debug", logging.DEBUG)]:
        monkeypatch.setenv("LOG_LEVEL", value)
        level, unknown = log_level()
        assert (level, unknown) == (want, None), value

    # An unrecognised value is reported, not raised: refusing to start is for a
    # config mismatch, where the alternative is running the wrong code.
    monkeypatch.setenv("LOG_LEVEL", "verbose")
    level, unknown = log_level()
    assert level == logging.INFO
    assert unknown == "verbose"

    monkeypatch.delenv("LOG_LEVEL", raising=False)
    assert log_level() == (logging.INFO, None)
