"""Model-catalog content invariants -- the regression guard that keeps the
shipped catalog free of the install-reliability defects fixed in v1.13.0 /
v1.14.0 (v1.15.0 Phase 3 / Issue 2).

The PyInstaller spec bundles ``core/registry/catalog.json`` straight from the
repo, so a *fresh* build always ships the current catalog. The failure the user
hit was a *stale* catalog: an older build whose Gemma entry still pointed at the
Unsloth ``hf.co`` GGUF pull target (Ollama manifest bug -> the blobs download
fully, then the manifest commit errors HTTP 400). The former access-gated SANA
INT4 source was replaced in v2.4.1 by a public, pinned Nunchaku repository.
This module keeps the remaining catalog fixes as invariants so CI and the build
fail if the catalog ever regresses to a shippable-but-broken shape.

Pure and Qt-free: :func:`validate_catalog` takes the parsed catalog dict and
returns a list of human-readable problems (empty list == valid).
"""

from __future__ import annotations

from typing import Any

#: Ollama pull targets known to fail (Ollama manifest bug): the Unsloth hf.co
#: GGUF reference downloads fully, then errors HTTP 400 on the manifest commit.
#: The fix routes Gemma to the Ollama-library ``gemma4:12b`` build.
KNOWN_BROKEN_OLLAMA_REFS: tuple[str, ...] = ("unsloth/gemma-4-12b-it-GGUF",)

#: Model ids known to live in access-gated Hugging Face repos (an
#: unauthenticated fetch returns HTTP 401). They MUST stay flagged ``gated`` so
#: the installer offers the guided token step / clean skip instead of looping on
#: a 401 it can never satisfy without credentials.
KNOWN_GATED_IDS: frozenset[str] = frozenset()

#: v1.19.0 Phase 1 -- low-VRAM Agentic entry. Present-or-valid: synthetic
#: catalogs without this id are unchanged; when the id is present the
#: license-label / pin / no-vendor-benchmark contract is enforced.
LFM_AGENTIC_ID = "lfm2.5:2.6b"
LFM_LICENSE = "LFM Open License v1.0"
LFM_OLLAMA_TARGET = "hf.co/LiquidAI/LFM2.5-2.6B-GGUF"
PLACEHOLDER_SHA256 = "0" * 64
#: Vendor-reported numbers and suite names that must not appear in card copy
#: until locally reproduced (comparison Section 9).
LFM_FORBIDDEN_BENCHMARK_TOKENS: tuple[str, ...] = (
    "ToolSandbox",
    "BFCLv4",
    "BFCL",
    "77.83",
    "56.88",
    "220 tok",
    "tok/s",
    "tok-per-s",
)

MUSE_K17_ID = "muse-glimmer:30b"
MUSE_DYNAMIC_ID = "muse-glimmer:30b-dynamic"
MUSE_IDS: frozenset[str] = frozenset({MUSE_K17_ID, MUSE_DYNAMIC_ID})
MUSE_OLLAMA_TARGET = "hf.co/meta-models/Muse-Glimmer-30B-GGUF"
MUSE_MIN_OLLAMA = "0.32.7"
MUSE_FORBIDDEN_COPY: tuple[str, ...] = ("SWE-Bench", "76.0", "76.00")

LIGHTNING_NATIVE_ID = "nemotron-lightning:30b-a3b"
LIGHTNING_OFFLOAD_ID = "nemotron-lightning:30b-a3b-offload"
LIGHTNING_IDS: frozenset[str] = frozenset({LIGHTNING_NATIVE_ID, LIGHTNING_OFFLOAD_ID})
# Official Ollama library tag (0.32.9+). The ggml-org hf.co Q4_K_M GGUF was
# deleted; pulling that tag 400s with "specified tag is not available".
LIGHTNING_OLLAMA_TARGET = "nemotron-3.5-lightning:30b"
LIGHTNING_MIN_OLLAMA = "0.32.9"

#: Gemma 4 library tags need Ollama 0.32.15 (HTTP 412 below that).
GEMMA_MIN_OLLAMA = "0.32.15"
GEMMA_OLLAMA_IDS: frozenset[str] = frozenset(
    {
        "gemma4:e2b",
        "gemma4:e4b",
        "gemma4:26b",
        "gemma4:31b",
        "gemma-4-12b-it-gguf",
    }
)

#: Official Ollama library tags added in the v2.1 develop catalog refresh.
#: Keep ids and pull URLs in lockstep so a stale hf.co path cannot ship.
POST_2025_OLLAMA_TARGETS: dict[str, str] = {
    "qwen3.5:4b": "ollama://qwen3.5:4b",
    "qwen3.5:9b": "ollama://qwen3.5:9b",
    "gpt-oss:20b": "ollama://gpt-oss:20b",
    "qwen3-coder:30b": "ollama://qwen3-coder:30b",
    "embeddinggemma": "ollama://embeddinggemma:300m",
    "qwen3-embedding:0.6b": "ollama://qwen3-embedding:0.6b",
}

#: Pre-2025 selectable models that stay as supported legacy alternatives,
#: recommended.json image/audio defaults, RapidOCR (CPU document pillar), or
#: SAM2 (Image Studio replace-the-X). 2024 coding specialists were replaced
#: by Qwen 3.5 / gpt-oss / Qwen3-Coder. Everything else 2024-or-earlier is
#: dropped.
PRE_2025_KEEP_IDS: frozenset[str] = frozenset(
    {
        "nomic-embed-text",
        "juggernaut-xl-v9",
        "realvisxl-v5",
        "faster-whisper-large-v3",
        "rapidocr-ppocrv4",
        "sam2:hiera-tiny",
    }
)


EMBEDDINGGEMMA_ID = "embeddinggemma"
REQUIRED_EMBEDDER_ID = EMBEDDINGGEMMA_ID


def validate_catalog(catalog: dict[str, Any]) -> list[str]:
    """Return a list of invariant violations in ``catalog`` (empty == valid)."""
    problems: list[str] = []

    models = catalog.get("models")
    if not isinstance(models, list) or not models:
        problems.append("catalog has no non-empty 'models' list")
        return problems

    seen_ids: set[str] = set()
    for index, model in enumerate(models):
        if not isinstance(model, dict):
            problems.append(f"models[{index}] is not an object")
            continue

        model_id = model.get("id")
        where = str(model_id) if model_id else f"models[{index}]"
        if not model_id:
            problems.append(f"{where}: missing 'id'")
        elif model_id in seen_ids:
            problems.append(f"{model_id}: duplicate id")
        else:
            seen_ids.add(str(model_id))

        if model.get("task") is not None:
            description = str(model.get("description") or "").strip()
            if not description or description[-1:] not in {".", "!", "?"}:
                problems.append(
                    f"{where}: selectable entry requires a complete-sentence "
                    "description"
                )

        source = model.get("source")
        if not isinstance(source, dict) or not source.get("protocol"):
            problems.append(f"{where}: missing 'source.protocol'")
            source = source if isinstance(source, dict) else {}

        # A) Gemma HTTP-400 regression: no Ollama pull target may reference a
        #    known-broken hf.co GGUF path.
        if source.get("protocol") == "ollama":
            url = str(source.get("url", ""))
            for broken in KNOWN_BROKEN_OLLAMA_REFS:
                if broken in url:
                    problems.append(
                        f"{where}: ollama source '{url}' uses the known-broken "
                        f"reference '{broken}' (Ollama manifest bug -> HTTP 400); "
                        f"route it to the Ollama-library tag instead"
                    )

        # B) Gated consistency: requiresLicense implies gated, and a gated model
        #    must carry a reason or license URL so the UX can explain the guided
        #    token step and offer a clean skip.
        gated = bool(model.get("gated"))
        if bool(model.get("requiresLicense")) and not gated:
            problems.append(f"{where}: requiresLicense is true but gated is not set")
        if gated and not (model.get("gatedReason") or model.get("licenseUrl")):
            problems.append(
                f"{where}: gated model has no gatedReason or licenseUrl to explain "
                f"the guided token step"
            )

    # C) Known-gated regression: a model known to be access-gated must stay
    #    flagged, or the installer would 401-loop on it again.
    by_id = {m.get("id"): m for m in models if isinstance(m, dict)}
    for gated_id in KNOWN_GATED_IDS:
        model = by_id.get(gated_id)
        if model is not None and not model.get("gated"):
            problems.append(
                f"{gated_id}: known access-gated model is not flagged 'gated' "
                f"(would re-trigger the unauthenticated HTTP 401 retry loop)"
            )

    # D) v1.19.0 Phase 1 -- when the LFM low-VRAM agentic entry is present,
    #    the license use-restriction label, ungated download, real pin, and
    #    no-vendor-benchmark copy must all hold.
    lfm = by_id.get(LFM_AGENTIC_ID)
    if isinstance(lfm, dict):
        problems.extend(_check_lfm_entry(lfm))

    for muse_id in MUSE_IDS:
        muse = by_id.get(muse_id)
        if isinstance(muse, dict):
            problems.extend(_check_muse_entry(muse, muse_id))
    if any(isinstance(by_id.get(i), dict) for i in MUSE_IDS) and not all(
        isinstance(by_id.get(i), dict) for i in MUSE_IDS
    ):
        problems.append(
            "muse-glimmer: both K-Quant-17GB and K-Quant-Dynamic "
            "entries must ship together"
        )

    for lightning_id in LIGHTNING_IDS:
        lightning = by_id.get(lightning_id)
        if isinstance(lightning, dict):
            problems.extend(_check_lightning_entry(lightning, lightning_id))
    if any(isinstance(by_id.get(i), dict) for i in LIGHTNING_IDS) and not all(
        isinstance(by_id.get(i), dict) for i in LIGHTNING_IDS
    ):
        problems.append(
            "nemotron-lightning: both native Q4_K_M and expert-offload "
            "entries must ship together"
        )

    sam2 = by_id.get("sam2:hiera-tiny")
    if isinstance(sam2, dict):
        problems.extend(_check_sam2_entry(sam2))

    for gemma_id in GEMMA_OLLAMA_IDS:
        gemma = by_id.get(gemma_id)
        if not isinstance(gemma, dict):
            continue
        if gemma.get("minOllamaVersion") != GEMMA_MIN_OLLAMA:
            problems.append(f"{gemma_id}: minOllamaVersion must be {GEMMA_MIN_OLLAMA}")

    for model_id, expected_url in POST_2025_OLLAMA_TARGETS.items():
        entry = by_id.get(model_id)
        if not isinstance(entry, dict):
            continue
        url = ""
        source = entry.get("source")
        if isinstance(source, dict):
            url = str(source.get("url") or "")
        if url != expected_url:
            problems.append(
                f"{model_id}: ollama source must be {expected_url} (got {url!r})"
            )
    qwen35_present = [
        i for i in ("qwen3.5:4b", "qwen3.5:9b") if isinstance(by_id.get(i), dict)
    ]
    if qwen35_present and len(qwen35_present) != 2:
        problems.append("qwen3.5: both 4b and 9b entries must ship together")

    problems.extend(_check_pre_2025_keep(by_id))
    problems.extend(_check_required_embedder(by_id))

    return problems


def _check_required_embedder(by_id: dict[str, Any]) -> list[str]:
    """Require EmbeddingGemma as the memory default and keep its 300M identity."""
    problems: list[str] = []
    required = by_id.get(REQUIRED_EMBEDDER_ID)
    if (
        isinstance(required, dict)
        and "task" in required
        and required.get("task") not in ("embed", "embeddings")
    ):
        problems.append(f"{REQUIRED_EMBEDDER_ID}: task must be embed")

    gemma = by_id.get(EMBEDDINGGEMMA_ID)
    if not isinstance(gemma, dict):
        return problems

    display = str(gemma.get("displayName") or "")
    if "300M" not in display:
        problems.append(f"{EMBEDDINGGEMMA_ID}: displayName must include 300M")
    copy = " ".join(
        [
            display,
            str(gemma.get("description") or ""),
            str(gemma.get("whyRecommended") or ""),
            str(gemma.get("differentiators") or ""),
        ]
    )
    if "300b" in copy.lower():
        problems.append(
            f"{EMBEDDINGGEMMA_ID}: copy must not say 300B (the model is 300M)"
        )
    return problems


def _check_lfm_entry(model: dict[str, Any]) -> list[str]:
    """Invariants that apply only when ``lfm2.5:2.6b`` is in the catalog."""
    problems: list[str] = []
    where = LFM_AGENTIC_ID
    if model.get("task") != "agentic":
        problems.append(f"{where}: task must be 'agentic'")
    if not model.get("agentic"):
        problems.append(f"{where}: agentic flag must be true")
    if model.get("license") != LFM_LICENSE:
        problems.append(f"{where}: license must be '{LFM_LICENSE}'")
    license_url = str(model.get("licenseUrl") or "")
    if not license_url.startswith("https://"):
        problems.append(f"{where}: licenseUrl must be an https:// first-party page")
    note = str(model.get("licenseNote") or "")
    note_l = note.lower()
    if "10m" not in note_l and "10 million" not in note_l:
        problems.append(f"{where}: licenseNote must state the USD 10M revenue cap")
    if "use restriction" not in note_l:
        problems.append(
            f"{where}: licenseNote must present the cap as a use restriction"
        )
    if model.get("requiresLicense") is True:
        problems.append(f"{where}: requiresLicense must be false (weights are ungated)")
    if model.get("gated"):
        problems.append(f"{where}: must not be gated (would fire the token flow)")
    source = model.get("source") if isinstance(model.get("source"), dict) else {}
    url = str(source.get("url") or "")
    if LFM_OLLAMA_TARGET not in url:
        problems.append(
            f"{where}: ollama source must pull the official {LFM_OLLAMA_TARGET} GGUF"
        )
    files = []
    weights = model.get("weights")
    if isinstance(weights, dict) and isinstance(weights.get("files"), list):
        files = weights["files"]
    pins = [str(f.get("sha256") or "") for f in files if isinstance(f, dict)]
    if not pins:
        problems.append(f"{where}: weights.files must record the Q4_K_M SHA-256 pin")
    elif any(p == PLACEHOLDER_SHA256 or not p for p in pins):
        problems.append(
            f"{where}: SHA-256 pins must be real (no all-zero placeholders)"
        )
    strengths = (
        [str(s) for s in model["strengths"]]
        if isinstance(model.get("strengths"), list)
        else []
    )
    copy_fields = [
        str(model.get("description") or ""),
        str(model.get("whyRecommended") or ""),
        str(model.get("differentiators") or ""),
        *strengths,
        note,
    ]
    blob = " ".join(copy_fields)
    for token in LFM_FORBIDDEN_BENCHMARK_TOKENS:
        if token in blob:
            problems.append(
                f"{where}: card copy must not assert unverified "
                f"vendor benchmark {token!r}"
            )
    return problems


def _card_copy(model: dict[str, Any]) -> str:
    strengths = (
        [str(s) for s in model["strengths"]]
        if isinstance(model.get("strengths"), list)
        else []
    )
    return " ".join(
        [
            str(model.get("description") or ""),
            str(model.get("whyRecommended") or ""),
            str(model.get("differentiators") or ""),
            *strengths,
        ]
    )


def _check_muse_entry(model: dict[str, Any], where: str) -> list[str]:
    """Invariants that apply when a Muse Glimmer entry is in the catalog."""
    problems: list[str] = []
    if model.get("family") != "muse-glimmer":
        problems.append(f"{where}: family must be 'muse-glimmer'")
    if not model.get("agentic"):
        problems.append(f"{where}: agentic flag must be true")
    if model.get("license") != "Apache-2.0":
        problems.append(f"{where}: license must be Apache-2.0")
    if model.get("minOllamaVersion") != MUSE_MIN_OLLAMA:
        problems.append(f"{where}: minOllamaVersion must be {MUSE_MIN_OLLAMA}")
    if model.get("hideBelowVramGB") != 16:
        problems.append(f"{where}: hideBelowVramGB must be 16")
    source = model.get("source") if isinstance(model.get("source"), dict) else {}
    url = str(source.get("url") or "")
    if MUSE_OLLAMA_TARGET not in url:
        problems.append(f"{where}: ollama source must pull {MUSE_OLLAMA_TARGET}")
    raw_vr = model.get("vendorReported")
    vr = raw_vr if isinstance(raw_vr, dict) else {}
    if vr.get("vendorReported") is not True:
        problems.append(f"{where}: vendorReported.vendorReported must be true")
    local = model.get("localEval") if isinstance(model.get("localEval"), dict) else {}
    if local.get("status") not in {"pass", "fail", "incomplete", "not_run"}:
        problems.append(f"{where}: localEval.status must be recorded")
    if local.get("status") == "pass" and not local.get("result"):
        problems.append(f"{where}: a passing localEval must record a result")
    if model.get("vision") is not False:
        problems.append(
            f"{where}: vision must be false until the hf.co GGUF pull is "
            "proven to ship mmproj"
        )
    blob = _card_copy(model)
    for token in MUSE_FORBIDDEN_COPY:
        if token in blob:
            problems.append(
                f"{where}: card copy must not assert unverified "
                f"vendor benchmark {token!r}"
            )
    if where == MUSE_K17_ID and model.get("requiredVramGB") != 24:
        problems.append(f"{where}: K-Quant-17GB must map to the 24 GB VRAM tier")
    if where == MUSE_DYNAMIC_ID and model.get("requiredVramGB") != 32:
        problems.append(f"{where}: K-Quant-Dynamic must map to the 32 GB VRAM tier")
    return problems


def _check_lightning_entry(model: dict[str, Any], where: str) -> list[str]:
    """Invariants that apply when a Nemotron Lightning entry is in the catalog."""
    problems: list[str] = []
    if model.get("family") != "nemotron-lightning":
        problems.append(f"{where}: family must be 'nemotron-lightning'")
    if not model.get("agentic"):
        problems.append(f"{where}: agentic flag must be true")
    if model.get("role") != "worker-candidate":
        problems.append(f"{where}: role must be worker-candidate")
    if model.get("license") != "OpenMDW-1.1":
        problems.append(f"{where}: license must be OpenMDW-1.1")
    if model.get("minOllamaVersion") != LIGHTNING_MIN_OLLAMA:
        problems.append(f"{where}: minOllamaVersion must be {LIGHTNING_MIN_OLLAMA}")
    if model.get("hideBelowVramGB") != 16:
        problems.append(f"{where}: hideBelowVramGB must be 16")
    source = model.get("source") if isinstance(model.get("source"), dict) else {}
    url = str(source.get("url") or "")
    if LIGHTNING_OLLAMA_TARGET not in url:
        problems.append(f"{where}: ollama source must pull {LIGHTNING_OLLAMA_TARGET}")
    if where == LIGHTNING_NATIVE_ID and model.get("requiredVramGB") != 24:
        problems.append(
            f"{where}: native library 30b build must map to the 24 GB VRAM tier"
        )
    if where == LIGHTNING_OFFLOAD_ID:
        tags = model.get("tags") if isinstance(model.get("tags"), list) else []
        if "expert-offload" not in tags:
            problems.append(f"{where}: offload entry must be tagged expert-offload")
        if model.get("requiredVramGB") != 16:
            problems.append(f"{where}: expert-offload must map to the 16 GB VRAM tier")
    local = model.get("localEval") if isinstance(model.get("localEval"), dict) else {}
    if local.get("status") not in {"pass", "fail", "incomplete", "not_run"}:
        problems.append(f"{where}: localEval.status must be recorded")
    return problems


def _check_sam2_entry(model: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    where = "sam2:hiera-tiny"
    if model.get("license") != "Apache-2.0":
        problems.append(f"{where}: license must be Apache-2.0")
    if model.get("codingEligible") is not False:
        problems.append(f"{where}: codingEligible must be false")
    if model.get("diffusion") is not False:
        problems.append(f"{where}: diffusion must be false")
    tags = model.get("tags") if isinstance(model.get("tags"), list) else []
    if "utility" not in tags or "sam2" not in tags:
        problems.append(f"{where}: must be tagged utility and sam2")
    return problems


def _check_pre_2025_keep(by_id: dict[str, Any]) -> list[str]:
    """Selectable models released before 2025 must be on the keep-list."""
    problems: list[str] = []
    for model_id, model in by_id.items():
        if not isinstance(model, dict):
            continue
        if model.get("task") is None:
            continue
        date = str(model.get("releaseDate") or "")
        if not date or date >= "2025-01-01":
            continue
        if str(model_id) not in PRE_2025_KEEP_IDS:
            problems.append(
                f"{model_id}: pre-2025 selectable model is not on the keep-list "
                "(required embed, recommended.json default, RapidOCR, or SAM2)"
            )
    return problems


__all__ = [
    "KNOWN_BROKEN_OLLAMA_REFS",
    "KNOWN_GATED_IDS",
    "LFM_AGENTIC_ID",
    "MUSE_IDS",
    "LIGHTNING_IDS",
    "LIGHTNING_OLLAMA_TARGET",
    "GEMMA_MIN_OLLAMA",
    "POST_2025_OLLAMA_TARGETS",
    "PRE_2025_KEEP_IDS",
    "REQUIRED_EMBEDDER_ID",
    "validate_catalog",
]
