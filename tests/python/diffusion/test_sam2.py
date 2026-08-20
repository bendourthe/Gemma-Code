"""SAM2 stub: missing weights, stub path, and ambiguous phrases."""

from __future__ import annotations

from runtimes.diffusion.pipelines import sam2


def test_missing_weights_returns_structured_code(monkeypatch):
    monkeypatch.delenv("NEXUS_SAM2_STUB", raising=False)
    monkeypatch.delenv("NEXUS_SAM2_WEIGHTS", raising=False)
    out = sam2.segment({"phrase": "car"})
    assert out["ok"] is False
    assert out["code"] == "weights_missing"
    assert "sam2:hiera-tiny" in out["message"]


def test_stub_returns_one_candidate(monkeypatch):
    monkeypatch.delenv("NEXUS_SAM2_WEIGHTS", raising=False)
    out = sam2.segment({"phrase": "car", "stub": True})
    assert out["ok"] is True
    assert len(out["candidates"]) == 1
    assert out["candidates"][0]["label"] == "car"


def test_ambiguous_phrase_returns_two_candidates():
    out = sam2.segment({"phrase": "the cars", "stub": True})
    assert out["ok"] is True
    assert len(out["candidates"]) == 2


def test_weights_dir_with_checkpoint(tmp_path):
    (tmp_path / "sam2_hiera_tiny.pt").write_bytes(b"stub")
    out = sam2.segment({"phrase": "dog", "weightsDir": str(tmp_path)})
    assert out["ok"] is True
    assert len(out["candidates"]) == 1


def test_register_installs_segment_handler():
    handlers = {}
    sam2.register(handlers)
    assert "segment" in handlers
    assert handlers["segment"]({"stub": True, "phrase": "x"})["ok"] is True
