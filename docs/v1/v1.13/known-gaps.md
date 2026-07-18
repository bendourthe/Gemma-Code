# Known Gaps - v1.13.0 (Installer Reliability and UX Polish)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/installer-reliability-and-ux.md](plans/installer-reliability-and-ux.md)

## v1.13.0

### Open Items

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IR.P1.A | DF | Phase 1 | Live pull **and** load verification of the corrected Gemma 4 routing (`gemma4:12b`) and the Ollama `MIN_OLLAMA_VERSION` floor | The live proof needs a real Ollama + a multi-GB pull; the routing + version-gate logic are unit-tested, and the `gemma4:12b` tag + the Ollama 0.22+ Gemma-4 support were web-confirmed against the Ollama registry | Run the Phase 2 preflight harness (pull + load smoke) once it lands; its CI leg is itself freeze-deferred (see IR.P1.E) |
| IR.P1.B | MT | Phase 1 | Real SHA-256 pins for the placeholder-pinned default `wan2.1-t2v-1.3b` (and the gated opt-ins) | Computing a real digest requires downloading the multi-GB weights, which is out of scope for an offline code phase | Rotate pins via `scripts/installer/build/pin-hf-weights.py` during / after the Phase 2 preflight run; Ollama-path defaults already rely on Ollama's own digest verification |
| IR.P1.C | DF | Phase 1 | Gated opt-ins (`sana-1.6b-int4`, `sd1.5`, `svd`, `stable-audio-open-1.0`) are flagged `gated: true` and skipped fast, but not re-pointed to working public sources | Re-pointing `sana-1.6b-int4` to the public `mit-han-lab/nunchaku-sana` INT4 layout needs the `nunchaku` runtime + a verified single-file path + a real SHA; the public `sana-1.6b-1024` / `realvisxl-v5` / `juggernaut-xl-v9` already cover the image tier | Re-point on demand with a verified nunchaku path, or leave gated behind an HF token (the puller now supports `HF_TOKEN`) |
| IR.P1.D | NI | Phase 1 | No Gemma-4-specific hint on the Ollama `Error: 400` manifest-registration failure in `model_puller.py` | The catalog routing fix (1.1) removes the actual failure, and the router already surfaces `last_error`; a version-upgrade hint is low value now | Add an "upgrade Ollama" hint if the 400-class recurs on another Ollama-GGUF entry |
| IR.P1.E | DF | Phase 1 | The Phase 2 preflight's live pull+load CI job (and any full clean-machine model run) | GitHub Actions budget is frozen ($0) until ~2026-08-01; continues v1.11 `IO.P2.A` / v1.8 `OSI006` | Enable the freeze-gated CI job after the budget is restored |

### Summary

- Open: 5 (1 DF verification, 1 MT pin-rotation, 1 DF gated re-point, 1 NI low-priority, 1 DF freeze-blocked CI).
- Resolved this cycle: the fresh-install half-failure (recommended Gemma 4 12B chat model) via catalog routing to the Ollama registry; closes the v1.11 `D1` gated-model-audit gap for default models.
- No release-blockers: every default model now routes to a reachable source; the two remaining verification items (IR.P1.A / IR.P1.E) are gated by the Actions freeze, not by code.

_Last updated: 2026-07-17 (Phase 1)._
