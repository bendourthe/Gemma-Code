"""v1.8.0 Phase 3 -- protocol-routed model installation step.

Replaces the engine's direct `ModelPuller` call. Each selected model id is
resolved against the repo's `core/registry/catalog.json` and routed by its
`source.protocol`:

    ollama       -> `ollama pull` (ModelPuller, unchanged behavior)
    huggingface  -> HFWeightsPuller (per-file resume + SHA-256 verify)

Ids missing from the catalog keep the historical behavior and go to
`ollama pull` (the pre-Phase-3 `selected_model` values were passed to
ollama verbatim).

Progress across a mixed selection is aggregated with per-model weights
proportional to the catalog `sizeGB` (unknown sizes weigh 1.0), so a
23 GB FLUX download does not appear to stall behind a 1.4 GB SANA pull.
One failed model does not abort the rest (per-model failure isolation):
failures are recorded on `InstallerState.failed_models` and summarized on
the complete page; the step reports failure when any model failed.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from nexus_installer import registry_paths
from nexus_installer.engine.hf_weights_puller import HFWeightsPuller
from nexus_installer.engine.model_puller import ModelPuller
from nexus_installer.installer_state import InstallerState

LogFn = Callable[[str, str], None]
ProgressFn = Callable[[float], None]

CatalogEntry = dict[str, object]


def default_catalog_path() -> Path:
    """Locate `core/registry/catalog.json` (bundle, source tree, or editable).

    Delegates to the shared `registry_paths` resolver (v1.8.0 Phase 6), which
    checks the PyInstaller bundle (`sys._MEIPASS`) before walking up the
    source tree; a missing catalog is handled gracefully by
    `load_catalog_index` (all models then route to ollama).
    """
    return registry_paths.default_catalog_path()


def load_catalog_index(catalog_path: Path) -> dict[str, CatalogEntry]:
    """Read catalog.json into an id -> entry mapping ({} when unreadable)."""
    try:
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    index: dict[str, CatalogEntry] = {}
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list):
        return {}
    for entry in models:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str):
            index[entry["id"]] = entry
    return index


def protocol_for(entry: CatalogEntry | None) -> str:
    """Return the install protocol for a catalog entry (default: ollama)."""
    if entry is None:
        return "ollama"
    source = entry.get("source")
    if isinstance(source, dict) and source.get("protocol") == "huggingface":
        return "huggingface"
    return "ollama"


def resolve_selected_models(state: InstallerState) -> list[str]:
    """The model ids the step should install, de-duplicated in order.

    `selected_model_ids` (the Phase 3 multi-selection surface) wins when
    non-empty; otherwise the wired single-model `selected_model` is used.
    """
    raw = state.selected_model_ids or (
        [state.selected_model] if state.selected_model else []
    )
    seen: set[str] = set()
    ordered: list[str] = []
    for model_id in raw:
        if model_id and model_id not in seen:
            seen.add(model_id)
            ordered.append(model_id)
    return ordered


def _entry_weight(entry: CatalogEntry | None) -> float:
    if entry is not None:
        size = entry.get("sizeGB")
        if isinstance(size, (int, float)) and float(size) > 0:
            return float(size)
    return 1.0


class ModelStepRouter:
    """Runs the engine's model step across a protocol-mixed selection."""

    def __init__(self, catalog_path: Path | None = None) -> None:
        self._catalog_path = catalog_path or default_catalog_path()
        self._cancelled = False
        self._active: ModelPuller | HFWeightsPuller | None = None

    def cancel(self) -> None:
        """Cancel the in-flight download and stop routing further models."""
        self._cancelled = True
        if self._active:
            self._active.cancel()

    def install(
        self,
        state: InstallerState,
        log: LogFn,
        progress: ProgressFn,
    ) -> bool:
        """Install every selected model. Returns True when all succeeded."""
        selected = resolve_selected_models(state)
        if not selected:
            log("No model selected. Skipping model downloads.", "warn")
            return True

        catalog = load_catalog_index(self._catalog_path)
        if not catalog:
            log(
                f"Model catalog not readable at {self._catalog_path}; "
                "routing every model to ollama.",
                "warn",
            )

        weights = [_entry_weight(catalog.get(model_id)) for model_id in selected]
        total_weight = sum(weights)
        done_weight = 0.0
        failed: list[str] = []

        for model_id, weight in zip(selected, weights, strict=True):
            if self._cancelled:
                log("Model step cancelled by user.", "warn")
                return False

            def model_progress(
                fraction: float, _done: float = done_weight, _weight: float = weight
            ) -> None:
                clamped = min(max(fraction, 0.0), 1.0)
                progress((_done + _weight * clamped) / total_weight)

            entry = catalog.get(model_id)
            if entry is not None and protocol_for(entry) == "huggingface":
                puller = HFWeightsPuller()
                self._active = puller
                ok = puller.install_model(entry, state, log, model_progress)
            else:
                ollama_puller = ModelPuller()
                self._active = ollama_puller
                ok = ollama_puller.pull_model(model_id, log, model_progress)
            self._active = None

            if self._cancelled:
                log("Model step cancelled by user.", "warn")
                return False
            if not ok:
                failed.append(model_id)
                log(
                    f"Model {model_id} failed; continuing with the "
                    "remaining models.",
                    "warn",
                )
            done_weight += weight
            progress(done_weight / total_weight)

        if failed:
            state.failed_models.extend(failed)
            log(
                f"{len(failed)} of {len(selected)} model(s) failed: "
                f"{', '.join(failed)}.",
                "error",
            )
            return False
        log(f"All {len(selected)} model(s) installed.", "success")
        return True
