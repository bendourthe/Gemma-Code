"""Model-catalog content invariants -- the regression guard that keeps the
shipped catalog free of the install-reliability defects fixed in v1.13.0 /
v1.14.0 (v1.15.0 Phase 3 / Issue 2).

The PyInstaller spec bundles ``core/registry/catalog.json`` straight from the
repo, so a *fresh* build always ships the current catalog. The failure the user
hit was a *stale* catalog: an older build whose Gemma entry still pointed at the
Unsloth ``hf.co`` GGUF pull target (Ollama manifest bug -> the blobs download
fully, then the manifest commit errors HTTP 400) and whose access-gated SANA
INT4 entry was not flagged ``gated`` (an unauthenticated fetch -> HTTP 401 retry
loop). This module encodes those two fixes as invariants so CI and the build
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
KNOWN_GATED_IDS: frozenset[str] = frozenset({"sana-1.6b-int4"})

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
    pins = [
        str(f.get("sha256") or "")
        for f in files
        if isinstance(f, dict)
    ]
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


__all__ = [
    "KNOWN_BROKEN_OLLAMA_REFS",
    "KNOWN_GATED_IDS",
    "LFM_AGENTIC_ID",
    "validate_catalog",
]
