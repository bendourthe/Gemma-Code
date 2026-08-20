---
name: training-recipe
description: Local QLoRA training-recipe presets (chat-template JSONL, hyperparameters, dataset formats from PDF/CSV/JSON) for the fine-tuning pillar. No Unsloth UI; Nexus-owned orchestration only.
argument-hint: "[dataset format or base-model size]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [fine-tuning, qlora, dataset]
metadata.related_skills: []
---

You are assembling a local fine-tuning recipe for Nexus. Stay on the host. Do not call hosted training APIs.

## Formats

- Prefer chat-template JSONL (`messages: [{role, content}, ...]`) for instruction tuning.
- Accept PDF, CSV, and JSON drops as sources. Extract to JSONL. Skip unreadable or oversized files with a per-file report; never abort the whole dataset.
- Every record must pass `redactSecrets` before it is written. Show redacted preview text, never the raw secret.

## Hyperparameter starting points (single consumer GPU)

These are starting presets, not measured optima. Adjust after a smoke run.

| VRAM tier | Base size | LoRA rank | LoRA alpha | Seq len | Batch x accum |
|-----------|-----------|-----------|------------|---------|----------------|
| 16 GB     | 3B-8B     | 16        | 16         | 2048    | 1 x 8          |
| 24 GB     | 8B-14B    | 32        | 32         | 2048    | 1 x 8          |
| 32 GB     | 14B-32B   | 32        | 32         | 4096    | 1 x 4          |

QLoRA 4-bit is the default. Full fine-tune is out of scope.

## After training

1. Run the golden-task eval gate against the adapter vs the base model.
2. Quarantine on regression. Do not import a failed adapter into Ollama.
3. On pass, export GGUF and re-import through the existing registry reconciliation path.

$ARGUMENTS
