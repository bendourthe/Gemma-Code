"""v1.15.0 Phase 3 (Issue 2) -- model-catalog content invariants.

Guards against a *stale* catalog shipping (the v1.13/v1.14 install-reliability
regression): the real repo catalog must pass, and the validator must catch the
two specific defects -- a broken Gemma Ollama reference and an unflagged
access-gated model.
"""

from __future__ import annotations

import json
from typing import Any

from nexus_installer.catalog_invariants import (
    POST_2025_OLLAMA_TARGETS,
    validate_catalog,
)
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
        assert gemma.get("minOllamaVersion") == "0.32.15"

    def test_sana_int4_uses_public_pinned_nunchaku_source(self) -> None:
        # Direct regression check for the reported 404/auth loop.
        catalog = _load_repo_catalog()
        sana = next(
            (m for m in catalog["models"] if m.get("id") == "sana-1.6b-int4"), None
        )
        if sana is not None:
            assert sana.get("gated") is not True
            assert sana["source"]["repo"] == "nunchaku-ai/nunchaku-sana"
            assert len(sana["source"]["revision"]) == 40
            assert sana["weights"]["files"][0]["sha256"] != "0" * 64

    def test_post_2025_ollama_targets_are_present(self) -> None:
        catalog = _load_repo_catalog()
        by_id = {m.get("id"): m for m in catalog["models"] if isinstance(m, dict)}
        for model_id, expected_url in POST_2025_OLLAMA_TARGETS.items():
            entry = by_id.get(model_id)
            assert entry is not None, f"{model_id} missing from catalog.json"
            assert entry.get("source", {}).get("url") == expected_url
        assert "qwen2.5-coder:7b" not in by_id
        assert "qwen2.5-coder:14b" not in by_id
        assert "deepseek-coder-v2:16b" not in by_id


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
        entry = _lfm_entry(weights={"files": [{"path": "x.gguf", "sha256": "0" * 64}]})
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


class TestMuseAndLightning:
    def test_repo_catalog_includes_muse_and_lightning(self) -> None:
        catalog = _load_repo_catalog()
        ids = {str(m.get("id")) for m in catalog["models"] if isinstance(m, dict)}
        assert "muse-glimmer:30b" in ids
        assert "muse-glimmer:30b-dynamic" in ids
        assert "nemotron-lightning:30b-a3b" in ids
        assert "nemotron-lightning:30b-a3b-offload" in ids
        assert "sam2:hiera-tiny" in ids
        lightning = next(
            m for m in catalog["models"] if m.get("id") == "nemotron-lightning:30b-a3b"
        )
        assert lightning["source"]["url"] == "ollama://nemotron-3.5-lightning:30b"
        assert validate_catalog(catalog) == []

    def test_muse_vendor_score_in_copy_is_flagged(self) -> None:
        entry = {
            "id": "muse-glimmer:30b",
            "family": "muse-glimmer",
            "agentic": True,
            "license": "Apache-2.0",
            "minOllamaVersion": "0.32.7",
            "hideBelowVramGB": 16,
            "requiredVramGB": 24,
            "source": {
                "protocol": "ollama",
                "url": "ollama://hf.co/meta-models/Muse-Glimmer-30B-GGUF:K-Quant-17GB",
            },
            "vendorReported": {"suite": "SWE-Bench Verified", "vendorReported": True},
            "localEval": {"status": "not_run"},
            "whyRecommended": "SWE-Bench 76.0",
        }
        problems = validate_catalog({"models": [entry]})
        assert any("76.0" in p or "SWE-Bench" in p for p in problems)

    def test_lightning_missing_role_is_flagged(self) -> None:
        entry = {
            "id": "nemotron-lightning:30b-a3b",
            "family": "nemotron-lightning",
            "agentic": True,
            "license": "OpenMDW-1.1",
            "minOllamaVersion": "0.32.9",
            "hideBelowVramGB": 16,
            "requiredVramGB": 24,
            "source": {
                "protocol": "ollama",
                "url": "ollama://nemotron-3.5-lightning:30b",
            },
            "localEval": {"status": "not_run"},
        }
        problems = validate_catalog({"models": [entry]})
        assert any("worker-candidate" in p for p in problems)


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
                    "minOllamaVersion": "0.32.15",
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

    def test_sana_public_source_is_not_a_known_gated_id(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "sana-1.6b-int4",
                    "source": {
                        "protocol": "huggingface",
                        "repo": "nunchaku-ai/nunchaku-sana",
                    },
                }
            ]
        }
        assert not any("known access-gated" in p for p in validate_catalog(catalog))

    def test_missing_source_protocol_is_flagged(self) -> None:
        catalog = {"models": [{"id": "x"}]}
        assert any("source.protocol" in p for p in validate_catalog(catalog))

    def test_pre_2025_opt_in_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "llama3.1:8b",
                    "task": "chat",
                    "releaseDate": "2024-07-23",
                    "source": {"protocol": "ollama", "url": "ollama://llama3.1:8b"},
                }
            ]
        }
        assert any("pre-2025" in p for p in validate_catalog(catalog))

    def test_pre_2025_keep_list_is_allowed(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "nomic-embed-text",
                    "task": "embed",
                    "releaseDate": "2024-02-14",
                    "source": {
                        "protocol": "ollama",
                        "url": "ollama://nomic-embed-text",
                    },
                }
            ]
        }
        problems = validate_catalog(catalog)
        assert not any("pre-2025" in p for p in problems)

    def test_gemma12_missing_min_ollama_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "gemma-4-12b-it-gguf",
                    "source": {"protocol": "ollama", "url": "ollama://gemma4:12b"},
                }
            ]
        }
        assert any("minOllamaVersion" in p for p in validate_catalog(catalog))

    def test_post_2025_wrong_url_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "gpt-oss:20b",
                    "source": {"protocol": "ollama", "url": "ollama://gpt-oss:wrong"},
                }
            ]
        }
        assert any("gpt-oss:20b" in p for p in validate_catalog(catalog))

    def test_qwen35_sizes_must_ship_together(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "qwen3.5:9b",
                    "source": {"protocol": "ollama", "url": "ollama://qwen3.5:9b"},
                }
            ]
        }
        assert any("qwen3.5" in p for p in validate_catalog(catalog))


class TestRequiredEmbedderPolicy:
    def test_decision_file_records_embeddinggemma_supersession(self) -> None:
        from nexus_installer.catalog_invariants import REQUIRED_EMBEDDER_ID

        repo = default_catalog_path().resolve().parents[2]
        decision = (
            repo
            / "docs"
            / "v2"
            / "v2.3"
            / "development"
            / "embedder-default-decision.md"
        )
        text = decision.read_text(encoding="utf-8")
        assert "Superseded" in text
        assert "**SWITCH**" in text
        assert REQUIRED_EMBEDDER_ID in text
        assert "300M" in text
        assert "reindex" in text.lower()

    def test_repo_catalog_embeddinggemma_is_300m_not_300b(self) -> None:
        catalog = _load_repo_catalog()
        gemma = next(m for m in catalog["models"] if m.get("id") == "embeddinggemma")
        assert gemma["displayName"] == "EmbeddingGemma 300M"
        assert gemma["tag"] == "300m"
        copy = " ".join(
            [
                gemma["displayName"],
                gemma["description"],
                gemma["whyRecommended"],
                gemma["differentiators"],
            ]
        )
        assert "300M" in copy or "300 million" in copy.lower()
        assert "300b" not in copy.lower()
        assert "required default" in gemma["description"].lower()

    def test_recommended_embed_defaults_are_embeddinggemma_only(self) -> None:
        from nexus_installer.catalog_invariants import REQUIRED_EMBEDDER_ID
        from nexus_installer.registry_paths import default_recommended_path

        matrix = json.loads(default_recommended_path().read_text(encoding="utf-8"))
        for tier, sections in matrix["tiers"].items():
            assert sections["embed"] == [REQUIRED_EMBEDDER_ID], tier

    def test_settings_default_embedding_model_is_embeddinggemma(self) -> None:
        from nexus_installer.catalog_invariants import REQUIRED_EMBEDDER_ID

        repo = default_catalog_path().resolve().parents[2]
        manifest = json.loads((repo / "package.json").read_text(encoding="utf-8"))
        default = manifest["contributes"]["configuration"]["properties"][
            "nexus.memory.embeddingModel"
        ]["default"]
        assert default == REQUIRED_EMBEDDER_ID

    def test_embeddinggemma_300b_copy_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "embeddinggemma",
                    "displayName": "EmbeddingGemma 300B",
                    "description": "GemmaEmbedding 300B",
                    "source": {
                        "protocol": "ollama",
                        "url": "ollama://embeddinggemma:300m",
                    },
                }
            ]
        }
        problems = validate_catalog(catalog)
        assert any("300B" in p for p in problems)

    def test_required_embeddinggemma_wrong_task_is_flagged(self) -> None:
        catalog = {
            "models": [
                {
                    "id": "embeddinggemma",
                    "displayName": "EmbeddingGemma 300M",
                    "task": "chat",
                    "source": {
                        "protocol": "ollama",
                        "url": "ollama://embeddinggemma:300m",
                    },
                }
            ]
        }
        problems = validate_catalog(catalog)
        assert any("task must be embed" in p for p in problems)
