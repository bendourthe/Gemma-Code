# CI hardware gates -- v2.0.0

**Date**: 2026-08-20
**Plan**: [plans/v2.0.0-adoption-governed-autonomy-multimodal.md](plans/v2.0.0-adoption-governed-autonomy-multimodal.md) Phase 5.3

GitHub Actions does not install GPU weights, Chromium, or live STT/TTS engines. The jobs below stay green on a CPU runner. Local opt-in commands are how you prove the skipped path.

| Surface | CI behavior | Local hardware run |
|---|---|---|
| Coding `browser_*` | `InMemoryBrowser` HTML fixtures | `NEXUS_BROWSER_PLAYWRIGHT=1` after `npx playwright@1.55.0 install chromium` |
| Chat STT / TTS | Python `NEXUS_AUDIO_STUB=1`; TS in-memory audio runtime | Install catalog `faster-whisper-large-v3` and `kokoro-82m`, unset the stub |
| Video Lab Wan / LongCat DiT | Stub executor, no GPU | diffusion-pro host with pinned weights; avatar still DF-8 until a scanned import |
| Patient-tier determinism | skip-if-absent (`NEXUS_PATIENT_TIER_ADAPTER`) | Register an offload adapter; do not treat a skip as a pass |
| OS exec sandbox matrix | path-filtered `.github/workflows/sandbox.yml` | Three-OS job on sandbox path changes |

Optimization already in this repo: `concurrency` cancel-in-progress on CI, npm and pip caches, Node 24 desktop vitest skipped (Node 22 only), installer pytest path-filtered, Windows `init.ps1` not on PRs, macOS/Windows shell matrix gated to main.
