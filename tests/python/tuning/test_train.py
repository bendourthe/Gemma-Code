"""Stub trainer entry for CI."""

from __future__ import annotations

from pathlib import Path

from runtimes.tuning import train


def test_stub_writes_gguf(tmp_path: Path) -> None:
    code = train.main(
        [
            "--job-id",
            "j1",
            "--dataset",
            str(tmp_path / "d.jsonl"),
            "--base-model",
            "tiny",
            "--out",
            str(tmp_path / "out"),
            "--stub",
        ]
    )
    assert code == 0
    assert (tmp_path / "out" / "adapter.gguf").is_file()


def test_live_without_unsloth_exits_2(monkeypatch, tmp_path: Path) -> None:
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "unsloth":
            raise ImportError("missing")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    code = train.main(
        [
            "--job-id",
            "j2",
            "--dataset",
            str(tmp_path / "d.jsonl"),
            "--base-model",
            "tiny",
            "--out",
            str(tmp_path / "out"),
        ]
    )
    assert code == 2
