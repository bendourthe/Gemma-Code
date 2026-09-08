"""v2.4.5 Phase 1 -- detect which selected models are already on disk.

The wizard used to size an install from the catalog alone: `total_gb` summed
every selected model and the pre-install guard compared that against free
disk. On a host that had already downloaded those models the guard refused an
install that would have fetched almost nothing -- the field report was
`need 204.4 GB free, have 201.0 GB` against 176 GB of already-present weights.

This module answers the missing question, "which of these are already here",
so the picker, the Review page, and the guard can all size the REMAINING
download instead.

Two properties are deliberate and load-bearing:

* **Presence, not verification.** A model counts as downloaded when its files
  are on disk; nothing is hashed here. Verifying 176 GB would take minutes on
  the picker's load path and would duplicate `hf_weights_puller._install_file`,
  which already hashes each file during the install and re-downloads on a
  mismatch. Being wrong here costs a slightly optimistic estimate, never a
  broken install.
* **Fail open.** Every probe failure -- unreachable Ollama, unreadable models
  root, malformed manifest -- degrades that model to "not downloaded" and
  appends a line to `probe_errors`. That reproduces the old, over-cautious
  behavior, which is safe. A probe that could raise on the picker's load path
  would turn a convenience feature into a wizard that will not open.

Pure logic: no Qt import, so it is unit-testable without an event loop.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from nexus_installer.engine.hf_weights_puller import model_weights_dir
from nexus_installer.engine.model_router import (
    CatalogEntry,
    ollama_target_for,
    protocol_for,
)

#: Short, so a stopped Ollama costs the picker a blink rather than a stall.
#: `main.py` uses the same 2s budget for its own liveness probe.
OLLAMA_PROBE_TIMEOUT_S = 2.0

#: Ollama stores a manifest per model at
#: `manifests/<registry>/<namespace>/<name>/<tag>`. A bare `name:tag` target
#: lives under the default registry; a `hf.co/...` target carries its own.
_DEFAULT_OLLAMA_REGISTRY = "registry.ollama.ai/library"


@dataclass(frozen=True)
class InstalledReport:
    """Which selected models are already on disk, and what remains to fetch.

    `downloaded_gb + pending_gb` equals the selection total, because both are
    summed from the same catalog sizes; the split is what is new.
    """

    downloaded: frozenset[str] = frozenset()
    pending: frozenset[str] = frozenset()
    downloaded_gb: float = 0.0
    pending_gb: float = 0.0
    probe_errors: tuple[str, ...] = field(default=())

    def is_downloaded(self, model_id: str) -> bool:
        return model_id in self.downloaded

    @property
    def total_gb(self) -> float:
        return self.downloaded_gb + self.pending_gb


def _has_any_file(directory: Path) -> bool:
    """True when `directory` holds at least one regular file, at any depth."""
    try:
        if not directory.is_dir():
            return False
        for entry in directory.rglob("*"):
            try:
                if entry.is_file():
                    return True
            except OSError:
                # A single unreadable entry must not abort the whole scan.
                continue
        return False
    except OSError:
        return False


def huggingface_model_present(models_root: Path, model_id: str) -> bool:
    """True when a huggingface-protocol model's weights directory has content.

    The directory name is `safe_dir_name(model_id)`, which is lossy for ids
    containing ":" or "/", so the puller writes a `.nexus-model-id` marker
    into each directory. Prefer that marker over the directory name, the way
    the app's own probe does; fall back to the path when the marker is absent
    (a tree downloaded before the marker existed).
    """
    directory = model_weights_dir(models_root, model_id)
    marker = directory / ".nexus-model-id"
    try:
        if marker.is_file():
            recorded = marker.read_text(encoding="utf-8").strip()
            if recorded and recorded != model_id:
                # The directory belongs to a different id that collided on
                # safe_dir_name. Treat this model as absent rather than
                # claiming someone else's weights.
                return False
    except OSError:
        return False
    return _has_any_file(directory)


def ollama_manifest_path(models_root: Path, target: str) -> Path:
    """Local manifest path Ollama would write for a pull target.

    `embeddinggemma:300m`     -> manifests/<default>/embeddinggemma/300m
    `hf.co/Owner/Repo:Q4_K_M` -> manifests/hf.co/Owner/Repo/Q4_K_M
    `gemma4` (no tag)         -> manifests/<default>/gemma4/latest
    """
    name, _, tag = target.rpartition(":")
    if not name:
        # No ":" in the target, so rpartition put everything in `tag`.
        name, tag = tag, "latest"
    if not tag:
        tag = "latest"
    if "/" not in name:
        name = f"{_DEFAULT_OLLAMA_REGISTRY}/{name}"
    return models_root.joinpath("manifests", *name.split("/"), tag)


def _normalize_ollama_name(name: str) -> str:
    """Compare pull targets ignoring the implicit default registry and tag."""
    if name.startswith(f"{_DEFAULT_OLLAMA_REGISTRY}/"):
        name = name[len(_DEFAULT_OLLAMA_REGISTRY) + 1 :]
    if ":" not in name:
        name = f"{name}:latest"
    return name.lower()


def fetch_ollama_tags(
    ollama_url: str, *, timeout: float = OLLAMA_PROBE_TIMEOUT_S
) -> set[str]:
    """Model names Ollama reports as installed, or an empty set on any failure.

    Raises nothing: the caller treats an empty set as "ask the filesystem".
    """
    try:
        import httpx
    except Exception:  # noqa: BLE001 - probing is best-effort
        return set()
    try:
        response = httpx.get(f"{ollama_url.rstrip('/')}/api/tags", timeout=timeout)
        response.raise_for_status()
        payload = response.json()
    except Exception:  # noqa: BLE001 - unreachable, slow, or malformed
        return set()
    models = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(models, list):
        return set()
    names: set[str] = set()
    for item in models:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            names.add(_normalize_ollama_name(item["name"]))
    return names


def default_ollama_root() -> Path:
    """Ollama's model store: `OLLAMA_MODELS` when set, else `~/.ollama/models`.

    The manifest fallback runs whenever the API probe fails (Ollama stopped, or
    `localhost` resolving to IPv6 first on Windows). A user who relocated the
    store via `OLLAMA_MODELS` would otherwise see none of their pulled models
    pre-selected.
    """
    override = os.environ.get("OLLAMA_MODELS", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".ollama" / "models"


def probe_installed_models(
    *,
    selection: Iterable[str],
    catalog: Mapping[str, CatalogEntry],
    sizes_gb: Mapping[str, float],
    models_root: Path,
    ollama_url: str | None = None,
    ollama_root: Path | None = None,
) -> InstalledReport:
    """Split `selection` into already-downloaded and pending, with sizes.

    `sizes_gb` is passed separately rather than read from `catalog` so the
    caller can supply the same numbers the picker already displays, keeping
    one source of truth for what a model "costs".
    """
    ollama_root = ollama_root or default_ollama_root()
    errors: list[str] = []
    # Materialize once: `selection` is an Iterable and is walked twice below,
    # so a generator would be exhausted by the protocol scan and the main loop
    # would silently see an empty selection.
    ids = list(selection)

    # One API call for the whole selection, not one per model.
    ollama_names: set[str] = set()
    wants_ollama = any(protocol_for(catalog.get(mid)) == "ollama" for mid in ids)
    if wants_ollama and ollama_url:
        ollama_names = fetch_ollama_tags(ollama_url)
        if not ollama_names:
            errors.append(
                "Ollama did not answer /api/tags; falling back to on-disk "
                "manifests to detect installed chat models."
            )

    downloaded: set[str] = set()
    pending: set[str] = set()
    downloaded_gb = 0.0
    pending_gb = 0.0

    for model_id in ids:
        entry = catalog.get(model_id)
        size = float(sizes_gb.get(model_id, 0.0) or 0.0)
        try:
            if protocol_for(entry) == "huggingface":
                present = huggingface_model_present(models_root, model_id)
            else:
                target = ollama_target_for(entry, model_id)
                if ollama_names:
                    present = _normalize_ollama_name(target) in ollama_names
                else:
                    present = ollama_manifest_path(ollama_root, target).is_file()
        except Exception as exc:  # noqa: BLE001 - fail open, never block the wizard
            errors.append(f"Could not check {model_id}: {type(exc).__name__}")
            present = False
        if present:
            downloaded.add(model_id)
            downloaded_gb += size
        else:
            pending.add(model_id)
            pending_gb += size

    return InstalledReport(
        downloaded=frozenset(downloaded),
        pending=frozenset(pending),
        downloaded_gb=downloaded_gb,
        pending_gb=pending_gb,
        probe_errors=tuple(errors),
    )


def pending_download_gb(state: object) -> float:
    """GB the install still has to fetch, given what is already on disk.

    One helper so the install guard, the picker footer, and per-model
    affordability cannot disagree about the size of a selection.

    Reads `state.pending_models_gb`, which the picker computes over the
    selection. An installed-report with neither downloaded nor pending entries
    means the probe never ran (a headless `--model` override, or a page order that skips
    the picker). Unknown falls back to the full selection total -- the
    pre-v2.4.5 behavior -- because the safe reading of unknown is "assume
    nothing is present", never "assume nothing to download".
    """
    total = float(getattr(state, "selected_models_gb", 0.0) or 0.0)
    report = getattr(state, "installed_report", None)
    if report is None:
        return total
    if not report.downloaded and not report.pending:
        return total
    # v2.4.7 Phase 1.2 (T002): read the SELECTION-scoped figure the picker
    # publishes, not the report's own `pending_gb`. The report is probed over
    # the entire catalog so every card can show a Downloaded pill, so its
    # `pending_gb` is "every un-downloaded catalog model" -- a number that has
    # nothing to do with what the user selected. Returning it here made the
    # guard demand headroom for models nobody asked for.
    return float(getattr(state, "pending_models_gb", 0.0) or 0.0)


__all__ = [
    "InstalledReport",
    "OLLAMA_PROBE_TIMEOUT_S",
    "default_ollama_root",
    "fetch_ollama_tags",
    "huggingface_model_present",
    "ollama_manifest_path",
    "pending_download_gb",
    "probe_installed_models",
]
