"""Loading, validating and generating the worker config.

This file is the Python half of the one contract that crosses the language seam.
The Go half is internal/workerconfig. Both validate against
schema/workerconfig.schema.json, and tests/fixtures/worker-config.json is the
golden document both must round-trip.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import jsonschema

SCHEMA_VERSION = 1


def schema_path() -> Path:
    """Locate the shared schema, whether running from a checkout or an image."""
    candidates = [
        Path(__file__).resolve().parents[2] / "schema" / "workerconfig.schema.json",
        Path(__file__).resolve().parents[1] / "schema" / "workerconfig.schema.json",
        Path("/etc/worker/workerconfig.schema.json"),
    ]
    for c in candidates:
        if c.is_file():
            return c
    raise FileNotFoundError(
        "cannot find workerconfig.schema.json. Looked in: " + ", ".join(str(c) for c in candidates)
    )


@dataclass
class Entry:
    name: str
    taskQueue: str  # noqa: N815 -- the wire format is the schema's, not Python's


@dataclass
class WorkerConfig:
    version: int
    service: str
    owner: str
    namespace: str
    environment: str
    taskQueues: list[str]  # noqa: N815
    workflows: list[Entry]
    activities: list[Entry] = field(default_factory=list)
    image: str = ""
    vaultPath: str = ""  # noqa: N815

    def to_dict(self) -> dict:
        d = asdict(self)
        # Omit empty optional fields rather than emitting "": the schema forbids
        # nothing here, but a config full of empty strings reads like a bug.
        for key in ("image", "vaultPath"):
            if not d.get(key):
                d.pop(key, None)
        if not d.get("activities"):
            d.pop("activities", None)
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2) + "\n"

    @classmethod
    def from_dict(cls, data: dict) -> "WorkerConfig":
        validate(data)
        return cls(
            version=data["version"],
            service=data["service"],
            owner=data["owner"],
            namespace=data["namespace"],
            environment=data["environment"],
            taskQueues=list(data["taskQueues"]),
            workflows=[Entry(**e) for e in data["workflows"]],
            activities=[Entry(**e) for e in data.get("activities", [])],
            image=data.get("image", ""),
            vaultPath=data.get("vaultPath", ""),
        )

    @classmethod
    def load(cls, path: str | Path) -> "WorkerConfig":
        return cls.from_dict(json.loads(Path(path).read_text()))


def validate(data: dict) -> None:
    """Validate against the shared schema, with a readable failure."""
    schema = json.loads(schema_path().read_text())
    try:
        jsonschema.validate(data, schema)
    except jsonschema.ValidationError as e:
        location = "/".join(str(p) for p in e.absolute_path) or "(root)"
        raise ConfigInvalid(f"worker config is invalid at {location}: {e.message}") from e


class ConfigInvalid(Exception):
    """The config does not match the schema."""


class ConfigMismatch(Exception):
    """The config and the code disagree about what this worker runs."""
