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

    return problems


__all__ = ["KNOWN_BROKEN_OLLAMA_REFS", "KNOWN_GATED_IDS", "validate_catalog"]
