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

_LFM_PIN = "79fdf00351b46cf26f020aead28d01889886be87c55fa0eb907e6f9b00bfee14"
_LFM_NOTE = "USD 10M cap. This is a use restriction, not a download gate."
_LFM_URL = "ollama://hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M"


def _lfm_entry(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": "lfm2.5:2.6b",
        "task": "agentic",
        "agentic": True,
        "license": "LFM Open License v1.0",
        "licenseUrl": "https://www.liquid.ai/lfm-license",
        "licenseNote": _LFM_NOTE,
        "requiresLicense": False,
        "source": {"protocol": "ollama", "url": _LFM_URL},
        "weights": {"files": [{"path": "x.gguf", "sha256": _LFM_PIN}]},
    }
    entry.update(overrides)
    return entry


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


class TestLfmLowVramAgentic:
    def test_repo_catalog_includes_lfm_entry(self) -> None:
        catalog = _load_repo_catalog()
        lfm = next((m for m in catalog["models"] if m.get("id") == "lfm2.5:2.6b"), None)
        assert lfm is not None
        assert validate_catalog(catalog) == []

    def test_missing_use_restriction_is_flagged(self) -> None:
        entry = _lfm_entry(whyRecommended="fits CPU hosts")
        del entry["licenseNote"]
        problems = validate_catalog({"models": [entry]})
        assert any("licenseNote" in p for p in problems)

    def test_vendor_benchmark_in_copy_is_flagged(self) -> None:
        entry = _lfm_entry(whyRecommended="ToolSandbox 77.83")
        problems = validate_catalog({"models": [entry]})
        assert any("ToolSandbox" in p for p in problems)

    def test_requires_license_true_is_flagged(self) -> None:
        entry = _lfm_entry(
            requiresLicense=True,
            gated=True,
            gatedReason="should not fire",
        )
        problems = validate_catalog({"models": [entry]})
        assert any("requiresLicense" in p for p in problems)
        assert any("gated" in p for p in problems)

    def test_placeholder_pin_is_flagged(self) -> None:
        entry = _lfm_entry(
            weights={"files": [{"path": "x.gguf", "sha256": "0" * 64}]}
        )
        problems = validate_catalog({"models": [entry]})
        assert any("placeholder" in p or "SHA-256" in p for p in problems)

    def test_wrong_task_license_or_source_is_flagged(self) -> None:
        task = _lfm_entry(task="chat")
        assert any("task" in p for p in validate_catalog({"models": [task]}))
        no_agentic = _lfm_entry(agentic=False)
        assert any("agentic" in p for p in validate_catalog({"models": [no_agentic]}))
        license_ = _lfm_entry(license="MIT")
        assert any("license" in p for p in validate_catalog({"models": [license_]}))
        url = _lfm_entry(licenseUrl="http://example.invalid")
        assert any("licenseUrl" in p for p in validate_catalog({"models": [url]}))
        source = _lfm_entry(
            source={"protocol": "ollama", "url": "ollama://lfm2.5:2.6b"}
        )
        assert any("official" in p for p in validate_catalog({"models": [source]}))

    def test_phase3_decline_keeps_8b_a1b_out_of_the_repo_catalog(self) -> None:
        catalog = _load_repo_catalog()
        ids = [str(m.get("id")) for m in catalog["models"] if isinstance(m, dict)]
        assert "lfm2.5:8b-a1b" not in ids
        assert not any("8b-a1b" in i.lower() for i in ids)


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
