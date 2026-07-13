"""v1.8.0 Phase 3 -- protocol-routed model installation step.

Each selected model id is resolved against the repo's
`core/registry/catalog.json` and routed by its `source.protocol`:

    ollama       -> `ollama pull` (ModelPuller)
    huggingface  -> HFWeightsPuller (per-file resume + SHA-256 verify)

Ids missing from the catalog keep the historical behavior and go to
`ollama pull` (the pre-Phase-3 `selected_model` values were passed to
ollama verbatim).

v1.11.0 Phase 1 (T102/T105):

* **Server-aware**: when the selection contains any ollama-protocol model,
  the router health-checks the Ollama API first and, if it is down, starts a
  managed `ollama serve` child (hidden, streams to DEVNULL so it can never
  inherit -- and hold open -- our pipes) and waits for readiness. Without
  this, pulls depended on the CLI's implicit server behavior, which the
  installed tray app's `/AUTOSTART=0` makes unreliable on a clean machine.
* **Parallel**: models download concurrently on a bounded worker pool
  (default 3), with per-model failure isolation and a cancel that stops the
  pool and every in-flight puller.
* **Per-model telemetry**: `ModelStepEvents` callbacks emit started /
  progress (fraction, bytes, speed, ETA) / completed / failed(reason) per
  model id -- the data source for the per-model progress rows (P5 UI).

Aggregate progress across a mixed selection is weighted by catalog `sizeGB`
(unknown sizes weigh 1.0), so a 23 GB FLUX download does not appear to stall
behind a 1.4 GB SANA pull. One failed model does not abort the rest: failures
are recorded on `InstallerState.failed_models` and the step reports failure
when any model failed.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from nexus_installer import registry_paths
from nexus_installer.engine.hf_weights_puller import HFWeightsPuller
from nexus_installer.engine.model_puller import ModelPuller
from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.installer_state import InstallerState

LogFn = Callable[[str, str], None]
ProgressFn = Callable[[float], None]

CatalogEntry = dict[str, object]

DEFAULT_MAX_WORKERS = 3
SERVER_READY_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class ModelProgress:
    """One per-model progress sample (the P5 UI's row data)."""

    model_id: str
    fraction: float
    bytes_done: int
    bytes_total: int
    speed_bps: float
    eta_s: float


def _noop(*_args: object) -> None:
    return None


@dataclass
class ModelStepEvents:
    """Per-model lifecycle callbacks; every field defaults to a no-op."""

    started: Callable[[str], None] = field(default=_noop)
    progress: Callable[[ModelProgress], None] = field(default=_noop)
    completed: Callable[[str], None] = field(default=_noop)
    failed: Callable[[str, str], None] = field(default=_noop)


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


def ollama_target_for(entry: CatalogEntry | None, model_id: str) -> str:
    """Resolve the `ollama pull` argument for an ollama-protocol model.

    Prefer the catalog `source.url` (an `ollama://` URI) over the display id: a
    HuggingFace-GGUF-via-ollama entry must pull `hf.co/<repo>:<quant>` (the
    `source.url` host/path plus the `tag`), not the bare id -- pulling the id
    (e.g. `gemma-4-12b-it-gguf`) yields "pull model manifest: file does not
    exist". Falls back to the id when the entry, source, or url is absent
    (the historical behavior for uncatalogued ids).
    """
    if entry is None:
        return model_id
    source = entry.get("source")
    if not isinstance(source, dict):
        return model_id
    url = source.get("url")
    if not isinstance(url, str) or not url.startswith("ollama://"):
        return model_id
    target = url[len("ollama://") :]
    if not target:
        return model_id
    tag = entry.get("tag")
    last_segment = target.rsplit("/", 1)[-1]
    if isinstance(tag, str) and tag and ":" not in last_segment:
        target = f"{target}:{tag}"
    return target


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


class _Telemetry:
    """Compute bytes/speed/ETA from fraction samples for one model.

    Called only from that model's worker thread, so it needs no lock. Bytes
    are estimated from the catalog `sizeGB` (uniform across both protocols);
    speed is an EMA over sample deltas.
    """

    def __init__(self, model_id: str, size_gb: float) -> None:
        self._id = model_id
        self._total = int(size_gb * 2**30) if size_gb > 0 else 0
        self._last_t = time.monotonic()
        self._last_bytes = 0
        self._speed = 0.0

    def sample(self, fraction: float) -> ModelProgress:
        fraction = min(max(fraction, 0.0), 1.0)
        done = int(fraction * self._total)
        now = time.monotonic()
        dt = now - self._last_t
        if dt > 0.5 and done > self._last_bytes:
            inst = (done - self._last_bytes) / dt
            self._speed = inst if self._speed == 0 else 0.7 * self._speed + 0.3 * inst
            self._last_t = now
            self._last_bytes = done
        remaining = max(self._total - done, 0)
        eta = remaining / self._speed if self._speed > 0 else 0.0
        return ModelProgress(
            model_id=self._id,
            fraction=fraction,
            bytes_done=done,
            bytes_total=self._total,
            speed_bps=self._speed,
            eta_s=eta,
        )


class ModelStepRouter:
    """Runs the engine's model step across a protocol-mixed selection."""

    def __init__(
        self,
        catalog_path: Path | None = None,
        max_workers: int = DEFAULT_MAX_WORKERS,
    ) -> None:
        self._catalog_path = catalog_path or default_catalog_path()
        self._max_workers = max(1, max_workers)
        self._cancelled = False
        self._active: list[ModelPuller | HFWeightsPuller] = []
        self._lock = threading.Lock()
        self._server_proc: subprocess.Popen[bytes] | None = None

    def cancel(self) -> None:
        """Cancel every in-flight download and stop routing further models."""
        self._cancelled = True
        with self._lock:
            for puller in self._active:
                puller.cancel()

    # -- server awareness (T102) -------------------------------------------

    def ensure_ollama_server(self, state: InstallerState, log: LogFn) -> bool:
        """Health-check the Ollama API; start a managed server if it is down.

        The managed child is spawned hidden with BOTH streams to DEVNULL so it
        can never inherit (and hold open) the installer's pipes -- the failure
        class behind the v1.0.0 "server logs bleed into the pull log" noise.
        It is deliberately left running: the product needs it after install.
        """
        url = getattr(state, "ollama_url", "http://127.0.0.1:11434")
        if self._server_healthy(url):
            return True
        log("Ollama server is not running; starting it...", "info")
        try:
            self._server_proc = subprocess.Popen(
                ["ollama", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **no_window_kwargs(),
            )
        except FileNotFoundError:
            log(
                "ollama command not found; cannot start the model server. "
                "Ensure the Ollama step completed.",
                "error",
            )
            return False
        except OSError as exc:
            log(f"Could not start the Ollama server: {exc}", "error")
            return False
        deadline = time.monotonic() + SERVER_READY_TIMEOUT_S
        while time.monotonic() < deadline:
            if self._cancelled:
                return False
            if self._server_healthy(url):
                log("Ollama server is up.", "success")
                return True
            time.sleep(1.0)
        log(
            f"The Ollama server did not become ready within "
            f"{SERVER_READY_TIMEOUT_S:.0f}s; model downloads that need it "
            "will fail.",
            "error",
        )
        return False

    @staticmethod
    def _server_healthy(url: str) -> bool:
        try:
            return httpx.get(f"{url}/api/version", timeout=3).status_code == 200
        except httpx.HTTPError:
            return False

    # -- the step ------------------------------------------------------------

    def install(
        self,
        state: InstallerState,
        log: LogFn,
        progress: ProgressFn,
        events: ModelStepEvents | None = None,
    ) -> bool:
        """Install every selected model. Returns True when all succeeded."""
        events = events or ModelStepEvents()
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

        entries = {mid: catalog.get(mid) for mid in selected}
        ollama_ids = [
            mid for mid in selected if protocol_for(entries[mid]) == "ollama"
        ]
        server_ok = True
        if ollama_ids:
            server_ok = self.ensure_ollama_server(state, log)

        weights = {mid: _entry_weight(entries[mid]) for mid in selected}
        total_weight = sum(weights.values())
        fractions = {mid: 0.0 for mid in selected}
        failed: dict[str, str] = {}
        agg_lock = threading.Lock()

        def emit_aggregate() -> None:
            overall = sum(weights[m] * fractions[m] for m in selected) / total_weight
            progress(min(overall, 1.0))

        def run_one(model_id: str) -> None:
            entry = entries[model_id]
            size_gb = float(weights[model_id]) if entry is not None else 0.0
            telemetry = _Telemetry(model_id, size_gb)

            def mlog(msg: str, level: str = "info") -> None:
                log(f"[{model_id}] {msg}" if len(selected) > 1 else msg, level)

            def mprogress(fraction: float) -> None:
                with agg_lock:
                    fractions[model_id] = min(max(fraction, 0.0), 1.0)
                    emit_aggregate()
                events.progress(telemetry.sample(fraction))

            if self._cancelled:
                return

            events.started(model_id)
            reason = ""
            if entry is not None and protocol_for(entry) == "huggingface":
                hf = HFWeightsPuller()
                with self._lock:
                    self._active.append(hf)
                ok = hf.install_model(entry, state, mlog, mprogress)
                if not ok:
                    reason = "download or verification failed (see log)"
            else:
                if not server_ok:
                    ok = False
                    reason = "Ollama server unavailable"
                    mlog(
                        "Skipped: the Ollama server is unavailable.",
                        "error",
                    )
                else:
                    puller = ModelPuller()
                    with self._lock:
                        self._active.append(puller)
                    target = ollama_target_for(entry, model_id)
                    ok = puller.pull_model(target, mlog, mprogress)
                    if not ok:
                        reason = puller.last_error or "ollama pull failed"

            if self._cancelled and not ok:
                return  # a user cancel is not a per-model failure
            with agg_lock:
                fractions[model_id] = 1.0
                emit_aggregate()
            if ok:
                events.completed(model_id)
            else:
                with agg_lock:
                    failed[model_id] = reason or "failed"
                events.failed(model_id, failed[model_id])
                mlog(
                    f"Model {model_id} failed; continuing with the "
                    "remaining models.",
                    "warn",
                )

        workers = min(self._max_workers, len(selected))
        if workers == 1:
            for model_id in selected:
                if self._cancelled:
                    break
                run_one(model_id)
        else:
            log(
                f"Downloading {len(selected)} model(s) with up to "
                f"{workers} in parallel...",
                "info",
            )
            with ThreadPoolExecutor(max_workers=workers) as pool:
                list(pool.map(run_one, selected))

        if self._cancelled:
            log("Model step cancelled by user.", "warn")
            return False
        if failed:
            # Report in selection order so the summary is deterministic under
            # parallel completion.
            ordered_failed = [m for m in selected if m in failed]
            state.failed_models.extend(ordered_failed)
            log(
                f"{len(ordered_failed)} of {len(selected)} model(s) failed: "
                f"{', '.join(ordered_failed)}.",
                "error",
            )
            return False
        log(f"All {len(selected)} model(s) installed.", "success")
        return True
