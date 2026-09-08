"""Byte-level model load progress (v2.4.8 follow-up, 2026-09-07).

Operator report: the Images bubble read "Loading model..." for more than
twenty minutes with the GPU at 0%. When the runtime actually runs, RealVisXL
loads in about ten seconds, so a bare stage label cannot tell "loading
slowly" from "not loading at all". This module makes loading measurable: it
knows how many weight bytes a pipeline will read and reports how many have
been read so far, as `progress` notifications the shell renders as a bar with
an estimate of the remaining time.

How the bytes are counted. Diffusers and Transformers read safetensors files
through two entry points: `safetensors.torch.load_file` (whole file) and
`safetensors.safe_open` (lazy handles whose tensors are materialised with
`get_tensor` or `get_slice(...)[...]`). `track_model_load` swaps both for
counting wrappers for the duration of one load and restores them afterwards.
Transformers binds both names into its own module namespace at import time,
so its copies are swapped too. Nothing here needs torch or safetensors to be
importable: the wrappers are only installed when the libraries are present,
and the accounting is unit-tested without them.
"""

from __future__ import annotations

import contextlib
import importlib
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

from . import base

#: File suffixes counted as weights when sizing a load.
WEIGHT_SUFFIXES: frozenset[str] = frozenset(
    {".safetensors", ".bin", ".pth", ".pt", ".ckpt"}
)

#: The variant `real_execute._pipeline_load_kwargs` selects when present.
FP16_VARIANT_SUFFIX = ".fp16.safetensors"

#: Minimum gap between two byte-progress notifications.
MIN_EMIT_INTERVAL_S = 0.25

#: No ETA until this share of the bytes has been read; earlier rates are noise.
ETA_MIN_FRACTION = 0.02


def weight_bytes(weights: Path) -> int:
    """Total bytes the loader will read from `weights`.

    Mirrors the loader's own choices: a layout with component folders wins
    over a stray single-file checkpoint beside it (RealVisXL ships both), and
    within each folder the fp16 variant is read when one exists, so the
    non-variant twin is not counted.
    """
    files = [
        path
        for path in weights.rglob("*")
        if path.is_file() and path.suffix.lower() in WEIGHT_SUFFIXES
    ]
    if not files:
        return 0
    nested = [path for path in files if path.parent != weights]
    chosen = nested or files
    if any(path.name.endswith(FP16_VARIANT_SUFFIX) for path in chosen):
        by_folder: dict[Path, list[Path]] = {}
        for path in chosen:
            by_folder.setdefault(path.parent, []).append(path)
        picked: list[Path] = []
        for members in by_folder.values():
            variant = [m for m in members if m.name.endswith(FP16_VARIANT_SUFFIX)]
            picked.extend(variant or members)
        chosen = picked
    return sum(path.stat().st_size for path in chosen)


class LoadProgress:
    """Thread-safe byte counter that emits throttled `loading` notifications.

    `emit` receives `(job_id, "loading", loadedBytes=..., totalBytes=...,
    etaS=...)`; it defaults to `base.emit_stage`, which is a no-op without a
    sink and never raises.
    """

    def __init__(
        self,
        job_id: str,
        total_bytes: int,
        *,
        emit: Callable[..., None] = base.emit_stage,
        now: Callable[[], float] = time.monotonic,
        min_interval_s: float = MIN_EMIT_INTERVAL_S,
    ) -> None:
        self.job_id = job_id
        self.total = max(0, int(total_bytes))
        self.loaded = 0
        self._emit = emit
        self._now = now
        self._min_interval = min_interval_s
        self._lock = threading.Lock()
        self._started_at: Optional[float] = None
        self._last_emit_at: Optional[float] = None

    def add(self, nbytes: int) -> None:
        """Count `nbytes` as read and emit if the throttle window has passed."""
        if nbytes <= 0:
            return
        with self._lock:
            now = self._now()
            if self._started_at is None:
                self._started_at = now
            self.loaded += int(nbytes)
            if (
                self._last_emit_at is not None
                and now - self._last_emit_at < self._min_interval
            ):
                return
            self._last_emit_at = now
            payload = self._snapshot(now)
        self._emit(self.job_id, "loading", **payload)

    def finish(self) -> None:
        """Emit the completed state. Called only after the load returned."""
        with self._lock:
            if self.total > 0:
                self.loaded = self.total
            payload = self._snapshot(self._now())
            payload["etaS"] = 0.0
        self._emit(self.job_id, "loading", **payload)

    def _snapshot(self, now: float) -> dict[str, Any]:
        loaded = min(self.loaded, self.total) if self.total > 0 else self.loaded
        return {
            "loadedBytes": loaded,
            "totalBytes": self.total,
            "etaS": self._eta(loaded, now),
        }

    def _eta(self, loaded: int, now: float) -> Optional[float]:
        if self.total <= 0 or self._started_at is None or loaded <= 0:
            return None
        if loaded < self.total * ETA_MIN_FRACTION:
            return None
        elapsed = now - self._started_at
        if elapsed <= 0:
            return None
        rate = loaded / elapsed
        remaining = max(0, self.total - loaded)
        return round(remaining / rate, 1)


def _tensor_bytes(tensor: Any) -> int:
    try:
        return int(tensor.numel()) * int(tensor.element_size())
    except Exception:  # noqa: BLE001 - counting must never break a load
        return 0


class _CountingSlice:
    """Wraps a `PySafeSlice`; the read happens in `__getitem__`."""

    def __init__(self, inner: Any, progress: LoadProgress) -> None:
        self._inner = inner
        self._progress = progress

    def __getitem__(self, item: Any) -> Any:
        tensor = self._inner[item]
        self._progress.add(_tensor_bytes(tensor))
        return tensor

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class _CountingHandle:
    """Wraps a `safe_open` handle; counts `get_tensor` and slice reads."""

    def __init__(self, inner: Any, progress: LoadProgress) -> None:
        self._inner = inner
        self._progress = progress

    def __enter__(self) -> "_CountingHandle":
        self._inner.__enter__()
        return self

    def __exit__(self, *exc: Any) -> Any:
        return self._inner.__exit__(*exc)

    def get_tensor(self, name: str) -> Any:
        tensor = self._inner.get_tensor(name)
        self._progress.add(_tensor_bytes(tensor))
        return tensor

    def get_slice(self, name: str) -> _CountingSlice:
        return _CountingSlice(self._inner.get_slice(name), self._progress)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def counting_safe_open(real_open: Callable[..., Any], progress: LoadProgress):
    """A `safe_open` replacement whose handles count what they read."""

    def safe_open(*args: Any, **kwargs: Any) -> _CountingHandle:
        return _CountingHandle(real_open(*args, **kwargs), progress)

    return safe_open


def counting_load_file(real_open: Callable[..., Any], progress: LoadProgress):
    """A `safetensors.torch.load_file` replacement (same loop, counted)."""

    def load_file(filename: Any, device: Any = "cpu") -> dict[str, Any]:
        result: dict[str, Any] = {}
        with real_open(filename, framework="pt", device=device) as handle:
            for key in handle.keys():
                tensor = handle.get_tensor(key)
                progress.add(_tensor_bytes(tensor))
                result[key] = tensor
        return result

    return load_file


#: Modules that bind the safetensors readers by name at import time.
_REBOUND_READER_MODULES: tuple[str, ...] = ("transformers.modeling_utils",)


def install_counting_readers(
    progress: LoadProgress,
) -> list[tuple[Any, str, Any]]:
    """Swap the safetensors readers for counting ones; return the undo list."""
    patches: list[tuple[Any, str, Any]] = []
    try:
        safetensors = importlib.import_module("safetensors")
        st_torch = importlib.import_module("safetensors.torch")
    except Exception:  # noqa: BLE001 - no safetensors, nothing to count
        return patches
    real_open = safetensors.safe_open
    real_load = st_torch.load_file
    new_open = counting_safe_open(real_open, progress)
    new_load = counting_load_file(real_open, progress)

    def swap(module: Any, name: str, value: Any) -> None:
        patches.append((module, name, getattr(module, name)))
        setattr(module, name, value)

    swap(safetensors, "safe_open", new_open)
    swap(st_torch, "load_file", new_load)
    for module_name in _REBOUND_READER_MODULES:
        try:
            module = importlib.import_module(module_name)
        except Exception:  # noqa: BLE001 - optional consumer
            continue
        if getattr(module, "safe_open", None) is real_open:
            swap(module, "safe_open", new_open)
        if getattr(module, "safe_load_file", None) is real_load:
            swap(module, "safe_load_file", new_load)
    return patches


def restore_readers(patches: list[tuple[Any, str, Any]]) -> None:
    for module, name, original in reversed(patches):
        with contextlib.suppress(Exception):
            setattr(module, name, original)


@contextlib.contextmanager
def track_model_load(job_id: str, weights: Path) -> Iterator[LoadProgress]:
    """Count the bytes a pipeline load reads and report them as `loading`.

    Usage::

        with load_progress.track_model_load(ctx.job_id, weights):
            pipe = _load_text_pipe(weights, model_id)

    The completed state is emitted only when the body returns; a failing load
    leaves the last honest count in place.
    """
    try:
        total = weight_bytes(weights)
    except Exception:  # noqa: BLE001 - sizing is best-effort
        total = 0
    progress = LoadProgress(job_id, total)
    patches = install_counting_readers(progress)
    try:
        yield progress
    finally:
        restore_readers(patches)
    progress.finish()
