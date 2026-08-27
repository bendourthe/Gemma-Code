"""v2.2.9 Phase 5 (T011) -- patient-tier rows are ordinary picker rows.

The v1.12.0 NEXUS_PATIENT_TIER hide is removed: a catalog entry tagged
"patient-tier" (Inkling-Small) appears in the installer wizard exactly as it
does in Settings (same rows on both surfaces). It must still never be a
recommended.json default. Exercises the data-layer loader directly (no Qt).
"""

from __future__ import annotations

import json
from pathlib import Path

from nexus_installer.pages.typed_catalog import load_catalog_models
from nexus_installer.tier_defaults import load_tier_matrix

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


class TestPatientTierVisibility:
    def test_visible_without_env_opt_in(self, tmp_path, monkeypatch) -> None:
        monkeypatch.delenv("NEXUS_PATIENT_TIER", raising=False)
        ids = {
            m.id for m in load_catalog_models(_write(tmp_path, [_PATIENT, _STANDARD]))
        }
        assert "glm-5.2" in ids  # patient-tier is a plain row now
        assert "gemma4:e4b" in ids

    def test_repo_inkling_visible_by_default(self, monkeypatch) -> None:
        from nexus_installer.registry_paths import default_catalog_path

        monkeypatch.delenv("NEXUS_PATIENT_TIER", raising=False)
        ids = {m.id for m in load_catalog_models(default_catalog_path())}
        assert "inkling-small" in ids
        assert "nomic-embed-text" in ids

    def test_repo_inkling_never_a_recommended_default(self) -> None:
        from nexus_installer.registry_paths import registry_file

        matrix = load_tier_matrix(registry_file("recommended.json"))
        for tier, sections in matrix.items():
            for section, ids in sections.items():
                assert "inkling-small" not in ids, (
                    f"patient-tier inkling-small must stay out of "
                    f"recommended defaults ({tier}/{section})"
                )
