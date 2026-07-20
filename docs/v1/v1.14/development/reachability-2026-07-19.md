# Live reachability evidence - v1.14.0 Phase 2.3 (2026-07-19)

Output of the catalog reachability probe (`nexus_installer.engine.model_preflight.probe_catalog`) run LIVE against Hugging Face + the Ollama registry after the Phase 1 curation. This is the cheap, no-download live proof that the offered set has no dead references; the full multi-GB pull+load run is an operator step (see ICR.P2.A / IR.P2.A).

## Result

- **DEAD: 0** - no offered model points at a withdrawn/404 source. In particular `sd1.5` is now `OK` (HTTP 200), confirming the Phase 1 re-point off the withdrawn `runwayml` repo to the public `stable-diffusion-v1-5` mirror.
- **UNKNOWN: 0**.
- **OK (32)**: dc-ae-f32c32-sana-1.1, deepseek-coder-v2:16b, faster-whisper-large-v3, flux-schnell, gemma-4-12b-it-gguf, gemma4:26b, gemma4:31b, gemma4:e2b, gemma4:e4b, juggernaut-xl-v9, kokoro-82m, llama3.1:70b, llama3.1:8b, ltx-video, musicgen-medium, nomic-embed-text, piper-en-us-lessac, qwen2.5-coder:14b, qwen2.5-coder:7b, qwen2.5:14b, qwen2.5:7b, realvisxl-v5, sana-1.6b-1024, sana-1.6b-2k, sana-1.6b-4k, sana-sprint-1024, sana-video-2b-720p, sd1.5, sdxl-base-1.0, sdxl-turbo, wan2.1-t2v-1.3b, wan2.2-ti2v-5b.
- **GATED (6)**: sana-1.6b-int4, stable-audio-open-1.0, svd (the three offered gated opt-ins, correctly flagged and unlockable via the guided auth flow), plus sana-controlnet-canny / -depth / -pose (auxiliary, NOT offered in the picker; their gated repos affect only the diffusion runtime's ControlNet auto-pull, tracked below).

## Interpretation

Every OFFERED model is reachable: 32 OK plus the 3 offered gated opt-ins that the Phase 2 guided HF-auth flow unlocks. No dead references. The 3 gated ControlNet repos are auxiliary (excluded from the picker by the loader) and do not affect the offered set.

## Not run here (operator step)

The live pull+load preflight for the 12 GB / 16 GB tier defaults (`--preflight 16`) downloads ~43 GB and writes models into the user's Ollama / models root, so it is an operator action on a target box, not an automated phase step (consistent with the GitHub Actions freeze and IR.P2.A). Command: `nexus-installer --preflight 16` (or `NEXUS_MODEL_PREFLIGHT=1`).
