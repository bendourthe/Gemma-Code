# M-series Tier Guide (v0.8.0 Phase 6.7)

**Status**: schema published; live captures deferred to operator with Apple Silicon hardware.

This guide maps Apple Silicon unified-memory tiers to recommended Gemma 4 model + quantization combinations. The source-of-truth is [tests/benchmarks/baselines/m-series.json](../../../../tests/benchmarks/baselines/m-series.json); this document is the human-readable companion.

## Recommendation table

| Unified memory | Recommended model | Quant   | Rationale                                                                 |
|----------------|-------------------|---------|---------------------------------------------------------------------------|
| 16 GB          | gemma4:e4b        | Q4_K_S  | 4-bit quant fits comfortably with overhead for the editor + VSCode.       |
| 24 GB          | gemma4:e4b        | Q4_K_M  | 4-bit medium quant balances throughput and quality (~40 tok/s anchor).    |
| 36 GB          | gemma4:e4b        | Q5_K_M  | 5-bit quant gives a measurable quality bump with editor headroom.         |
| 64+ GB         | gemma4:e4b (or e8b) | Q6_K  | 6-bit quant approaches FP16 quality; e8b checkpoint also viable.          |

The anchor row for 24 GB / ~40 tok/s comes from the jola.dev M4 multi-source comparison ([docs/archive/versions/v0/v0.7.0/comparison-multi-source-v2.md](../v0.7.0/comparison-multi-source-v2.md) item F6).

## Capturing a measurement

On a **quiescent dev workstation** with `ollama serve` running and the target model pulled:

```sh
npm run bench -- --m-series --machine="M3 Pro 18GB" --quant="Q4_K_S"
```

The capture appends a row to `tests/benchmarks/baselines/m-series.json` with:

- `machine` -- human-readable identifier (e.g. "M3 Pro 18GB")
- `unifiedMemoryGB` -- integer GB
- `tier` -- one of `constrained` | `balanced` | `full` (derived from memory tier)
- `model`, `quant` -- the inference target
- `tokensPerSecond` -- measured streaming throughput
- `promptLatencyMs` -- time-to-first-token
- `outputLatencyMs` -- end-to-end completion latency
- `capturedAt` -- ISO-8601 timestamp

## Installer integration

The PyQt installer's macOS post-install flow (`scripts/installer/pyqt/macos_postinstall.py`) reads `recommendations` from this file and pre-selects the starting model + quant based on the detected hardware tier. Operators can override via the installer's "Advanced" panel.

## Performance on Apple Silicon (README excerpt)

See the README "Performance on Apple Silicon" section for the latest summary; this guide is the canonical detail page.
