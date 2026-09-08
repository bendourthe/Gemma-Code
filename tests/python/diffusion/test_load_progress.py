"""Tests for byte-level model load progress (no torch or safetensors needed)."""

from __future__ import annotations

import sys
import types
from pathlib import Path

from runtimes.diffusion.pipelines import base, load_progress


def _write(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\0" * size)


def test_weight_bytes_prefers_component_folders_and_fp16_variants(tmp_path: Path):
    # RealVisXL on disk: a legacy single-file checkpoint beside a full layout.
    _write(tmp_path / "RealVisXL_V5.0_fp16.safetensors", 900)
    (tmp_path / "model_index.json").write_text("{}", encoding="utf-8")
    _write(tmp_path / "unet" / "diffusion_pytorch_model.fp16.safetensors", 500)
    _write(tmp_path / "unet" / "diffusion_pytorch_model.safetensors", 1000)
    _write(tmp_path / "vae" / "diffusion_pytorch_model.fp16.safetensors", 50)
    _write(tmp_path / "text_encoder" / "model.safetensors", 30)
    (tmp_path / "unet" / "config.json").write_text("{}", encoding="utf-8")
    # unet fp16 + vae fp16 + text_encoder (no variant twin); never the stray file.
    assert load_progress.weight_bytes(tmp_path) == 500 + 50 + 30


def test_weight_bytes_counts_a_single_file_checkpoint(tmp_path: Path):
    _write(tmp_path / "Juggernaut.safetensors", 700)
    assert load_progress.weight_bytes(tmp_path) == 700


def test_weight_bytes_is_zero_for_an_empty_dir(tmp_path: Path):
    assert load_progress.weight_bytes(tmp_path) == 0


def test_progress_throttles_emits_and_reports_eta():
    emitted: list[dict] = []
    clock = {"t": 100.0}

    def emit(job_id: str, stage: str, **extra):
        emitted.append({"job_id": job_id, "stage": stage, **extra})

    progress = load_progress.LoadProgress(
        "job-1", 1000, emit=emit, now=lambda: clock["t"], min_interval_s=0.25
    )
    progress.add(100)  # first add always emits; too early for an ETA rate
    clock["t"] += 0.1
    progress.add(100)  # inside the throttle window: no emit
    clock["t"] += 0.4
    progress.add(300)  # 500 of 1000 after 0.5 s -> 1000 B/s -> 0.5 s left
    assert [e["loadedBytes"] for e in emitted] == [100, 500]
    assert emitted[0]["stage"] == "loading" and emitted[0]["job_id"] == "job-1"
    assert emitted[0]["totalBytes"] == 1000
    assert emitted[0]["etaS"] is None
    assert emitted[1]["etaS"] == 0.5
    progress.finish()
    assert emitted[-1] == {
        "job_id": "job-1",
        "stage": "loading",
        "loadedBytes": 1000,
        "totalBytes": 1000,
        "etaS": 0.0,
    }


def test_progress_clamps_overcount_to_total():
    emitted: list[dict] = []
    progress = load_progress.LoadProgress(
        "j", 100, emit=lambda *_a, **kw: emitted.append(kw), now=lambda: 0.0
    )
    progress.add(150)
    assert emitted[0]["loadedBytes"] == 100


def test_progress_without_total_reports_raw_bytes_and_no_eta():
    emitted: list[dict] = []
    progress = load_progress.LoadProgress(
        "j", 0, emit=lambda *_a, **kw: emitted.append(kw), now=lambda: 0.0
    )
    progress.add(42)
    assert emitted[0] == {"loadedBytes": 42, "totalBytes": 0, "etaS": None}


class _FakeTensor:
    def __init__(self, nbytes: int) -> None:
        self._n = nbytes

    def numel(self) -> int:
        return self._n

    def element_size(self) -> int:
        return 1


class _FakeSlice:
    def __init__(self, nbytes: int) -> None:
        self._n = nbytes

    def get_shape(self):
        return [self._n]

    def __getitem__(self, item):
        return _FakeTensor(self._n)


class _FakeHandle:
    def __init__(self, sizes: dict[str, int]) -> None:
        self._sizes = sizes

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def keys(self):
        return list(self._sizes)

    def metadata(self):
        return {"format": "pt"}

    def get_tensor(self, name: str):
        return _FakeTensor(self._sizes[name])

    def get_slice(self, name: str):
        return _FakeSlice(self._sizes[name])


def _fake_open(sizes: dict[str, int]):
    def safe_open(filename, framework="pt", device="cpu"):
        return _FakeHandle(sizes)

    return safe_open


def test_counting_load_file_counts_every_tensor():
    progress = load_progress.LoadProgress("j", 0, emit=lambda *a, **k: None)
    load_file = load_progress.counting_load_file(
        _fake_open({"a": 10, "b": 20}), progress
    )
    result = load_file("weights.safetensors")
    assert set(result) == {"a", "b"}
    assert progress.loaded == 30


def test_counting_safe_open_counts_tensors_and_materialised_slices_only():
    progress = load_progress.LoadProgress("j", 0, emit=lambda *a, **k: None)
    safe_open = load_progress.counting_safe_open(
        _fake_open({"a": 10, "b": 20}), progress
    )
    with safe_open("weights.safetensors", framework="pt") as handle:
        assert handle.metadata() == {"format": "pt"}
        handle.get_tensor("a")
        sliced = handle.get_slice("b")
        assert sliced.get_shape() == [20]  # inspecting a slice reads nothing
        assert progress.loaded == 10
        sliced[...]
    assert progress.loaded == 30


def test_install_and_restore_swaps_rebound_names(monkeypatch):
    """The fake `safetensors` stands in for the real package; `transformers`
    binds the readers by name, so its copies must be swapped and restored."""
    real_open = _fake_open({"x": 5})

    def real_load(filename, device="cpu"):
        return {}

    st = types.ModuleType("safetensors")
    st.safe_open = real_open  # type: ignore[attr-defined]
    st_torch = types.ModuleType("safetensors.torch")
    st_torch.load_file = real_load  # type: ignore[attr-defined]
    st.torch = st_torch  # type: ignore[attr-defined]
    tf = types.ModuleType("transformers.modeling_utils")
    tf.safe_open = real_open  # type: ignore[attr-defined]
    tf.safe_load_file = real_load  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "safetensors", st)
    monkeypatch.setitem(sys.modules, "safetensors.torch", st_torch)
    monkeypatch.setitem(sys.modules, "transformers.modeling_utils", tf)

    progress = load_progress.LoadProgress("j", 0, emit=lambda *a, **k: None)
    patches = load_progress.install_counting_readers(progress)
    assert len(patches) == 4
    assert st.safe_open is not real_open and tf.safe_open is st.safe_open
    assert (
        st_torch.load_file is not real_load and tf.safe_load_file is st_torch.load_file
    )
    st_torch.load_file("f")
    assert progress.loaded == 5
    load_progress.restore_readers(patches)
    assert st.safe_open is real_open and tf.safe_open is real_open
    assert st_torch.load_file is real_load and tf.safe_load_file is real_load


def test_track_model_load_emits_completed_state_through_the_stage_sink(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setitem(sys.modules, "safetensors", None)  # import fails -> no patches
    _write(tmp_path / "unet" / "diffusion_pytorch_model.safetensors", 64)
    seen: list[dict] = []
    base.set_progress_sink(seen.append)
    try:
        with load_progress.track_model_load("job-9", tmp_path) as progress:
            assert progress.total == 64
            progress.add(16)
    finally:
        base.set_progress_sink(None)
    assert seen[0]["stage"] == "loading" and seen[0]["loadedBytes"] == 16
    assert seen[-1] == {
        "kind": "progress",
        "jobId": "job-9",
        "stage": "loading",
        "loadedBytes": 64,
        "totalBytes": 64,
        "etaS": 0.0,
    }


def test_track_model_load_does_not_claim_completion_on_failure(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setitem(sys.modules, "safetensors", None)
    _write(tmp_path / "a.safetensors", 10)
    seen: list[dict] = []
    base.set_progress_sink(seen.append)
    try:
        try:
            with load_progress.track_model_load("job-9", tmp_path):
                raise RuntimeError("boom")
        except RuntimeError:
            pass
    finally:
        base.set_progress_sink(None)
    assert seen == []

def test_step_callback_reports_one_based_steps():
    """v2.4.8 follow-up: sampling was invisible, so a 20-minute Wan job looked
    identical to a hung one. Steps are the honest signal."""
    seen: list[dict] = []
    base.set_progress_sink(seen.append)
    try:
        callback = base.step_progress_callback("job-1", 30)
        passthrough = callback(None, 0, None, {"latents": 1})
        assert passthrough == {"latents": 1}
        callback(None, 29, None, {})
    finally:
        base.set_progress_sink(None)
    assert seen[0] == {
        "kind": "progress",
        "jobId": "job-1",
        "stage": "generating",
        "step": 1,
        "totalSteps": 30,
    }
    assert seen[-1]["step"] == 30


def test_step_callback_kwargs_only_for_pipelines_that_accept_it():
    class Supported:
        def __call__(self, prompt, callback_on_step_end=None):
            return prompt

    class Legacy:
        def __call__(self, prompt):
            return prompt

    assert "callback_on_step_end" in base.step_callback_kwargs(Supported(), "j", 4)
    # Passing it to a pipeline that does not take it would fail the whole job.
    assert base.step_callback_kwargs(Legacy(), "j", 4) == {}
    assert base.step_callback_kwargs(Supported(), "", 4) == {}
    assert base.step_callback_kwargs(Supported(), "j", 0) == {}
