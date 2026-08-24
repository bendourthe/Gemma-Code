# CI hardware gates -- v2.1.0

**Date**: 2026-08-20
**Plan**: [plans/v2.1.0-adoption-open-local-ai-wave.md](plans/v2.1.0-adoption-open-local-ai-wave.md) Phase 5.5 / 6.4

Extends [v2.0 hardware gates](../v2.0/ci-hardware-gates.md). GitHub Actions still does not install GPU weights or CUDA. Fine-tuning live Unsloth is a local-only path. Diffusion layer-streaming OOM rescue is CPU-mocked in pytest.

| Surface | CI behavior | Local hardware run |
|---|---|---|
| Unsloth QLoRA | `runtimes/tuning/train.py --stub`; TS `stubTrainer`; installer provisioner mocked | Settings > Fine-tuning provision on NVIDIA (any OS) or AMD Linux, >= 16 GB; `NEXUS_TUNING_LIVE=1` |
| Live golden-task eval of adapters | Injected `EvalPort` with equal stub scores | Wire `GoldenTaskRunner` on a 16 GB+ host; quarantine still uses `decideEvalGate` |
| GGUF to Ollama import | Skipped unless an `OllamaImportPort` is injected | `NEXUS_TUNING_OLLAMA=1` after `ollama create` on the exported adapter |
| Diffusion layer streaming | Python `choose_offload(..., layer_streaming=True)` upgrades `insufficient_vram` without loading weights | 8-12 GB GPU: cap VRAM below model min with streaming on; record complete vs OOM |

Manual re-run of the stub trainer: [`.github/workflows/tuning-live.yml`](../../../.github/workflows/tuning-live.yml) (`workflow_dispatch` only).
