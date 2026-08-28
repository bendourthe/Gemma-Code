# Qwen3.8-Flash-Next Catalog Admission Record

**Release**: v2.3.0
**Decision date**: 2026-08-28
**Status**: Rejected for v2.3.0 catalog admission; deferred watchlist candidate
**Support tier**: Candidate only
**Seed comparison**: [Qwen3.8-Flash-Next, Video2X, and OpenWorker](../comparisons/v2.3.0-comparison-qwen-video2x-openworker.md)

## Decision

Qwen3.8-Flash-Next is not admitted to Nexus v2.3.0. This release adds no entry to `core/registry/catalog.json`, installer model data, desktop Settings, or a recommended model tier. Future reconsideration is fail-closed: all six gates below must pass for the exact artifact, runtime, quantization, and tool parser proposed for admission.

This is a release-specific product and evidence decision, not a legal conclusion and not a permanent rejection of the model family.

## Corrected model identity

The seed comparison described the model as 125B total parameters with 6B active. Current official Qwen material is more precise: the main model has 125B parameters with 6B activated per token, plus 51B n-gram embeddings and 4B multi-token-prediction parameters. Runtime and artifact surfaces may therefore report roughly 176B to 180B overall. Nexus must not present the name as an 8B-class or consumer-laptop model.

Qwen released the open-weight `Qwen/Qwen3.8-Flash-Next` experimental preview on 2026-08-26. It is distinct from the hosted production derivative named `qwen3.8-flash`; catalog or benchmark evidence for one identifier does not transfer to the other.

Primary sources:

- Qwen repository and runtime matrix: https://github.com/QwenLM/Qwen3.8-Flash-Next
- Official model card: https://huggingface.co/Qwen/Qwen3.8-Flash-Next
- Official Qwen Community License 1.0 text: https://huggingface.co/Qwen/Qwen3.8-Flash-Next/blob/main/LICENSE

## Artifact and runtime evidence

| Surface            | Observed artifact or claim | Admission implication                                                                                               |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Official Qwen BF16 | Approximately 360 GB       | Outside the current consumer-device envelope before runtime and cache overhead                                      |
| Official Qwen FP8  | Approximately 186 GB       | Still lacks an enforceable consumer hardware contract                                                               |
| ggml-org Q8 GGUF   | Approximately 163 GB       | Cross-platform packaging now exists, but support is new and its license metadata does not match the base repository |
| Ollama MLX NVFP4   | Approximately 105 GB       | Smallest observed listing, still too large for an unmeasured consumer recommendation                                |
| Ollama MLX BF16    | Approximately 360 GB       | All current Ollama tags remain MLX-labeled                                                                          |

Artifact sources:

- Official BF16 files: https://huggingface.co/Qwen/Qwen3.8-Flash-Next/tree/main
- Official FP8 files: https://huggingface.co/Qwen/Qwen3.8-Flash-Next-FP8/tree/main
- ggml-org GGUF files: https://huggingface.co/ggml-org/Qwen3.8-Flash-Next-GGUF/tree/main
- Ollama tags: https://ollama.com/library/qwen3.8-flash-next/tags

The 105 GB to 360 GB artifact-size envelope is a storage observation, not a RAM or VRAM requirement. No reviewed official source publishes a consumer RAM/VRAM minimum that the Nexus installer can truthfully enforce. The current vLLM recipe instead demonstrates datacenter configurations and substantial host-memory requirements: https://recipes.vllm.ai/Qwen/Qwen3.8-Flash-Next

Cross-platform llama.cpp support merged on 2026-08-27 and appears in release `b10660`, but one day of availability is not stability evidence. Current primary-project issues include GPU corruption, context-depth performance problems, native-context aborts, and sustained-load failures. The Ollama path remains MLX-labeled, and SGLang support and parser behavior are not yet a stable tagged contract.

Runtime sources:

- Ollama 0.33.1 release: https://github.com/ollama/ollama/releases/tag/v0.33.1
- llama.cpp support change: https://github.com/ggml-org/llama.cpp/pull/27742
- llama.cpp release `b10660`: https://github.com/ggml-org/llama.cpp/releases/tag/b10660
- llama.cpp GPU corruption report: https://github.com/ggml-org/llama.cpp/issues/27763
- llama.cpp AMD context-depth report: https://github.com/ggml-org/llama.cpp/issues/27856
- llama.cpp native-context abort report: https://github.com/ggml-org/llama.cpp/issues/27871
- llama.cpp sustained-load abort report: https://github.com/ggml-org/llama.cpp/issues/27780
- SGLang tool-parser loop report: https://github.com/sgl-project/sglang/issues/36537

## Six admission gates

| Gate                                             | v2.3.0 result                           | Evidence required to pass                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Project-specific license review               | **Fail: unresolved**                    | A documented review of Qwen Community License 1.0 for Nexus distribution and AI Work Assistant use, without relying on this engineering record as legal advice             |
| 2. Consistent artifact-license provenance        | **Fail: inconsistent**                  | The exact selected artifact and every distribution surface identify a compatible, consistent license; current base, Ollama, and ggml metadata disagree                     |
| 3. Stable released cross-platform runtime        | **Fail: newly available, not stable**   | A pinned released Ollama or llama.cpp path for Windows, Linux, and macOS passes Nexus validation without relying on an open pull request or platform-specific MLX-only tag |
| 4. Explicit enforceable hardware requirements    | **Fail: not proven**                    | Measured minimum disk, RAM, VRAM, accelerator, and context limits that installer capability checks can enforce before download or launch                                   |
| 5. Nexus tool-calling benchmark                  | **Fail: not run**                       | The exact runtime, artifact, quantization, chat template, and parser pass Nexus tool-calling tests without loops, malformed calls, or silent parser substitution           |
| 6. Experimental opt-in policy and field evidence | **Policy-satisfiable; evidence absent** | The entry remains experimental and opt-in, is never recommended by default, and accumulates enough field evidence for any later promotion                                  |

Gates 1 through 5 currently fail or remain unproven. Gate 6 cannot override them.

## Future re-evaluation checklist

A future release may reopen admission only when one proposal supplies all of the following:

- Official upstream identity, architecture, release, and license sources refreshed on the evaluation date.
- The exact artifact digest, size, format, quantization, license metadata, and provenance chain.
- A pinned, released, cross-platform runtime with no required unmerged patch.
- A measured Windows, Linux, and macOS hardware matrix with installer-enforceable failure thresholds.
- Disk, RAM, VRAM, context, startup, throughput, and sustained-load measurements for the proposed artifact.
- A Nexus tool-calling benchmark using the exact runtime, template, and parser, including parallel calls, malformed-input recovery, long-context behavior, and multi-turn loops.
- An explicit experimental and opt-in catalog classification with no default recommendation.
- Independent confirmation that every gate passed; a single successful upstream benchmark is insufficient.

Until that checklist is complete, catalog, installer, Settings, and recommendation surfaces must continue to omit Qwen3.8-Flash-Next.
