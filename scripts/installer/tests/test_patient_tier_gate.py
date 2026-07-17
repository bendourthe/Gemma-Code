"""v1.12.0 Phase 4 (E1/E3) -- the installer's disk-offload "patient" tier gate.

A catalog entry tagged "patient-tier" (a large MoE streamed off disk, sub-1-tok/s)
is HIDDEN from the picker unless the operator opts in via NEXUS_PATIENT_TIER=1.
Exercises the data-layer loader directly (no Qt).
"""

from __future__ import annotations

import json
from pathlib import Path

from nexus_installer.pages.typed_catalog import load_catalog_models

_PATIENT = {
    "id": "glm-5.2",
    "displayName": "GLM-5.2",
    "type": "llm",
    "task": "chat",
    "family": "glm",
    "tags": ["patient-tier", "chat"],
}
_STANDARD = {
    "id": "gemma4:e4b",
    "displayName": "Gemma 4",
    "type": "llm",
    "task": "chat",
    "family": "gemma",
    "tags": ["chat"],
}


def _write(tmp_path: Path, models: list[dict]) -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"models": models}), encoding="utf-8")
    return path


class TestPatientTierGate:
    def test_hidden_by_default(self, tmp_path, monkeypatch) -> None:
        monkeypatch.delenv("NEXUS_PATIENT_TIER", raising=False)
        ids = {m.id for m in load_catalog_models(_write(tmp_path, [_PATIENT, _STANDARD]))}
        assert "glm-5.2" not in ids  # patient-tier hidden
        assert "gemma4:e4b" in ids  # ordinary entry unaffected

    def test_surfaced_when_opted_in(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("NEXUS_PATIENT_TIER", "1")
        ids = {m.id for m in load_catalog_models(_write(tmp_path, [_PATIENT]))}
        assert "glm-5.2" in ids
