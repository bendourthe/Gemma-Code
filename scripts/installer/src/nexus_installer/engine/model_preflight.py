"""v1.13.0 Phase 2 -- default-model preflight harness.

Two checks that catch the class of failure behind the fresh-install
half-failure -- a default model that downloads but cannot register/load, or a
gated repo that 401s -- BEFORE a user hits it:

* **Reachability probe (no download).** Classify every catalog model's source
  as OK / GATED / DEAD / UNKNOWN via a lightweight HEAD request (Hugging Face
  `resolve` URL) or a registry manifest check (Ollama). Fast and safe to run on
  every installer change; a catalog entry flagged ``gated`` is reported GATED
  without a network call.
* **Pull + load preflight (network, opt-in).** For a hardware tier's default
  models, pull each and then LOAD it: for Ollama models a one-token generation
  (this is what catches the Gemma 4 runtime-load failure a pull-only check
  misses), for Hugging Face weight models a manifest-file existence check.
  Reports pass/fail per model and fails when any default fails.

The live pull+load run needs a real Ollama plus multi-GB downloads, so it is
gated behind ``NEXUS_MODEL_PREFLIGHT=1`` and its CI job is deferred under the
GitHub Actions budget freeze (see docs/v1/v1.13/known-gaps.md IR.P1.E). The
reachability probe and all the logic here are unit-tested with mocked network.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import httpx

from nexus_installer import registry_paths
from nexus_installer.engine.hf_weights_puller import (
    HFWeightsPuller,
    hf_token_from_env,
    load_weights_manifest,
)
from nexus_installer.engine.model_puller import ModelPuller
from nexus_installer.engine.model_router import (
    ModelStepRouter,
    load_catalog_index,
    ollama_target_for,
    protocol_for,
)
from nexus_installer.installer_state import InstallerState

LogFn = Callable[[str, str], None]

HF_RESOLVE_URL = "https://huggingface.co/{repo}/resolve/main/{path}"
OLLAMA_REGISTRY_MANIFEST = (
    "https://registry.ollama.ai/v2/library/{name}/manifests/{tag}"
)
_PERMANENT_GATED = frozenset({401, 403})


class Reachability(Enum):
    """Source-reachability classification for a catalog model."""

    OK = "ok"
    GATED = "gated"
    DEAD = "dead"
    UNKNOWN = "unknown"


def default_recommended_path() -> Path:
    """Locate `core/registry/recommended.json` next to the catalog."""
    return registry_paths.default_catalog_path().parent / "recommended.json"


def default_model_ids(
    tier: str | None = None, recommended_path: Path | None = None
) -> list[str]:
    """Ordered, de-duplicated default model ids from `recommended.json`.

    `tier` selects one hardware tier (e.g. "16", "cpu"); None spans every tier.
    """
    path = recommended_path or default_recommended_path()
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    tiers = data.get("tiers", {})
    selected = [tiers[tier]] if tier is not None else list(tiers.values())
    ids: list[str] = []
    seen: set[str] = set()
    for tier_map in selected:
        if not isinstance(tier_map, dict):
            continue
        for section in tier_map.values():
            if not isinstance(section, list):
                continue
            for mid in section:
                if isinstance(mid, str) and mid and mid not in seen:
                    seen.add(mid)
                    ids.append(mid)
    return ids


def _classify_status(status_code: int) -> Reachability:
    if status_code == 200:
        return Reachability.OK
    if status_code in _PERMANENT_GATED:
        return Reachability.GATED
    if status_code == 404:
        return Reachability.DEAD
    return Reachability.UNKNOWN


def _hf_probe_url(entry: dict[str, object]) -> str | None:
    """Resolve URL for a HF entry's first weights file (or None if not derivable)."""
    try:
        manifest = load_weights_manifest(entry)
    except ValueError:
        return None
    if not manifest.files:
        return None
    return HF_RESOLVE_URL.format(repo=manifest.repo, path=manifest.files[0].path)


def _ollama_manifest_url(entry: dict[str, object] | None, model_id: str) -> str | None:
    """Registry manifest URL for an Ollama `library/<name>:<tag>` reference."""
    target = ollama_target_for(entry, model_id)
    # Only library models (no host/namespace) are probeable this way.
    if "/" in target:
        return None
    name, _, tag = target.partition(":")
    if not name:
        return None
    return OLLAMA_REGISTRY_MANIFEST.format(name=name, tag=tag or "latest")


def probe_entry(
    entry: dict[str, object] | None,
    model_id: str,
    head: Callable[..., httpx.Response] | None = None,
) -> Reachability:
    """Classify one model's source reachability without downloading it."""
    if entry is None:
        return Reachability.UNKNOWN
    if entry.get("gated"):
        return Reachability.GATED
    head = head or (lambda url, **kw: httpx.head(url, **kw))
    if protocol_for(entry) == "huggingface":
        url = _hf_probe_url(entry)
    else:
        url = _ollama_manifest_url(entry, model_id)
    if url is None:
        return Reachability.UNKNOWN
    token = hf_token_from_env()
    headers = (
        {"Authorization": f"Bearer {token}"} if token and "huggingface" in url else {}
    )
    try:
        resp = head(url, follow_redirects=True, timeout=15, headers=headers)
    except httpx.HTTPError:
        return Reachability.UNKNOWN
    return _classify_status(resp.status_code)


def probe_catalog(
    catalog: dict[str, dict[str, object]] | None = None,
    head: Callable[..., httpx.Response] | None = None,
) -> dict[str, Reachability]:
    """Classify every catalog model's reachability (id -> Reachability)."""
    catalog = catalog or load_catalog_index(registry_paths.default_catalog_path())
    return {mid: probe_entry(entry, mid, head) for mid, entry in catalog.items()}


@dataclass
class PreflightResult:
    """Per-model pull+load outcome."""

    model_id: str
    protocol: str
    pulled: bool
    loaded: bool
    reason: str = ""

    @property
    def ok(self) -> bool:
        return self.pulled and self.loaded


def _ollama_load_smoke(ref: str, state: InstallerState) -> tuple[bool, str]:
    """Prove a pulled Ollama model actually LOADS via a one-token generation.

    A pull-only check passes for a model the installed Ollama can fetch but
    cannot load at runtime (the Gemma 4 architecture on a too-old build); this
    generation forces the load path.
    """
    url = getattr(state, "ollama_url", "http://127.0.0.1:11434")
    try:
        resp = httpx.post(
            f"{url}/api/generate",
            json={
                "model": ref,
                "prompt": "ok",
                "stream": False,
                "options": {"num_predict": 1},
            },
            timeout=180,
        )
    except httpx.HTTPError as exc:
        return False, f"load failed: {exc}"
    if resp.status_code == 200:
        return True, ""
    return False, f"load failed: HTTP {resp.status_code}"


def run_preflight(
    model_ids: list[str],
    state: InstallerState,
    log: LogFn,
    catalog: dict[str, dict[str, object]] | None = None,
) -> list[PreflightResult]:
    """Pull AND load each model id; return a per-model result list.

    Ollama models are pulled then load-smoke-tested; Hugging Face weight models
    are downloaded + integrity-checked (the download IS the load contract).
    """
    catalog = catalog or load_catalog_index(registry_paths.default_catalog_path())
    results: list[PreflightResult] = []

    has_ollama = any(protocol_for(catalog.get(mid)) == "ollama" for mid in model_ids)
    if has_ollama:
        ModelStepRouter().ensure_ollama_server(state, log)

    for mid in model_ids:
        entry = catalog.get(mid)
        if protocol_for(entry) == "ollama":
            target = ollama_target_for(entry, mid)
            puller = ModelPuller()
            pulled = puller.pull_model(target, log, lambda _p: None)
            if pulled:
                loaded, reason = _ollama_load_smoke(target, state)
            else:
                loaded, reason = False, puller.last_error or "pull failed"
            results.append(PreflightResult(mid, "ollama", pulled, loaded, reason))
        else:
            hf = HFWeightsPuller()
            pulled = hf.install_model(entry, state, log)
            results.append(
                PreflightResult(
                    mid,
                    "huggingface",
                    pulled,
                    pulled,
                    "" if pulled else "download or verification failed",
                )
            )
    return results
