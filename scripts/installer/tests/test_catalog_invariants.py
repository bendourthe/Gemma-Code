"""v1.15.0 Phase 3 (Issue 2) -- model-catalog content invariants.

Guards against a *stale* catalog shipping (the v1.13/v1.14 install-reliability
regression): the real repo catalog must pass, and the validator must catch the
two specific defects -- a broken Gemma Ollama reference and an unflagged
access-gated model.
"""

from __future__ import annotations

import json
from typing import Any

from nexus_installer.catalog_invariants import validate_catalog
from nexus_installer.registry_paths import default_catalog_path


def _load_repo_catalog() -> dict[str, Any]:
    return json.loads(default_catalog_path().read_text(encoding="utf-8"))


class TestRepoCatalog:
    def test_repo_catalog_passes_invariants(self) -> None:
        problems = validate_catalog(_load_repo_catalog())
        assert problems == [], f"catalog.json violates invariants: {problems}"

    def test_current_gemma_entry_is_the_ollama_library_build(self) -> None:
        # Direct regression check for the reported HTTP-400 failure.
        catalog = _load_repo_catalog()
        gemma = next(
            m for m in catalog["models"] if m.get("id") == "gemma-4-12b-it-gguf"
        )
        assert gemma["source"]["url"] == "ollama://gemma4:12b"

    def test_sana_int4_is_flagged_gated(self) -> None:
        # Direct regression check for the reported HTTP-401 loop.
        catalog = _load_repo_catalog()
        sana = next(
            (m for m in catalog["models"] if m.get("id") == "sana-1.6b-int4"), None
        )
        if sana is not None:
            assert sana.get("gated") is True


class TestValidateCatalog:
    def test_empty_models_is_flagged(self) -> None:
        assert validate_catalog({"models": []})
        assert validate_catalog({})

    def test_broken_gemma_ollama_ref_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "gemma-4-12b-it-gguf",
                    "source": {
                        "protocol": "ollama",
                        "url": "ollama://hf.co/unsloth/gemma-4-12b-it-GGUF",
                    },
                }
            ]
        }
        assert any("known-broken" in p for p in validate_catalog(catalog))

    def test_current_gemma_ollama_ref_passes(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "gemma-4-12b-it-gguf",
                    "source": {"protocol": "ollama", "url": "ollama://gemma4:12b"},
                }
            ]
        }
        assert validate_catalog(catalog) == []

    def test_requires_license_without_gated_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "x",
                    "source": {"protocol": "huggingface", "repo": "r"},
                    "requiresLicense": True,
                    "gatedReason": "why",
                }
            ]
        }
        assert any("requiresLicense" in p for p in validate_catalog(catalog))

    def test_gated_without_reason_or_url_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "x",
                    "source": {"protocol": "huggingface", "repo": "r"},
                    "gated": True,
                }
            ]
        }
        assert any("gatedReason" in p for p in validate_catalog(catalog))

    def test_known_gated_id_must_stay_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "sana-1.6b-int4",
                    "source": {"protocol": "huggingface", "repo": "r"},
                }
            ]
        }
        assert any("known access-gated" in p for p in validate_catalog(catalog))

    def test_missing_source_protocol_is_flagged(self) -> None:
        catalog = {"models": [{"id": "x"}]}
        assert any("source.protocol" in p for p in validate_catalog(catalog))
