"""v1.12.0 Phase 3 (Q1) -- the installer's extreme-low-bit (BitNet-class) tier gate.

A sub-4-bit ternary/1-bit catalog entry is HIDDEN from the picker unless the
operator opts in (NEXUS_EXTREME_LOW_BIT=1) AND the entry carries an independent
benchmark; the uncorroborated Bonsai/PrismML vendor is never surfaced. Exercises
the data-layer loader directly (no Qt).
"""

from __future__ import annotations

import json
from pathlib import Path

from nexus_installer.pages.typed_catalog import load_catalog_models

_BITNET = {
    "id": "bitnet/b1.58",
    "displayName": "BitNet b1.58",
    "type": "llm",
    "task": "chat",
    "family": "bitnet",
    "quant": "TQ1_0",
}
_STANDARD = {
    "id": "gemma4:e4b",
    "displayName": "Gemma 4",
    "type": "llm",
    "task": "chat",
    "family": "gemma",
    "quant": "Q4_K_M",
}


def _write(tmp_path: Path, models: list[dict]) -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"models": models}), encoding="utf-8")
    return path


class TestExtremeLowBitGate:
    def test_hidden_by_default(self, tmp_path, monkeypatch) -> None:
        monkeypatch.delenv("NEXUS_EXTREME_LOW_BIT", raising=False)
        ids = {m.id for m in load_catalog_models(_write(tmp_path, [_BITNET, _STANDARD]))}
        assert "bitnet/b1.58" not in ids  # extreme-low-bit hidden
        assert "gemma4:e4b" in ids  # ordinary 4-bit entry unaffected

    def test_hidden_without_benchmark_even_when_opted_in(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("NEXUS_EXTREME_LOW_BIT", "1")
        assert load_catalog_models(_write(tmp_path, [_BITNET])) == []

    def test_surfaced_when_opted_in_and_benchmarked(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("NEXUS_EXTREME_LOW_BIT", "1")
        entry = {**_BITNET, "benchmark": "https://example.org/bitnet-bench"}
        models = load_catalog_models(_write(tmp_path, [entry]))
        assert [m.id for m in models] == ["bitnet/b1.58"]
        assert models[0].quant == "TQ1_0"

    def test_blocked_vendor_never_surfaced(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("NEXUS_EXTREME_LOW_BIT", "1")
        entry = {
            "id": "bonsai-27b",
            "displayName": "Bonsai 27B",
            "type": "llm",
            "task": "chat",
            "family": "bonsai",
            "quant": "1bit",
            "benchmark": "https://prismml.example/claim",
        }
        assert load_catalog_models(_write(tmp_path, [entry])) == []
