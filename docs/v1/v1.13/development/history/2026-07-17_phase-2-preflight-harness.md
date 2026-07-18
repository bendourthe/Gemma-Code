# Session History - v1.13.0 Phase 2: Default-model preflight harness

**Date**: 2026-07-17
**Plan**: [../../plans/installer-reliability-and-ux.md](../../plans/installer-reliability-and-ux.md) - Phase 2
**Branch**: `feat/v1.13.0-installer-reliability`

## Goal

Catch the class of failure behind the fresh-install half-failure - a default model that downloads but cannot register/load, or a gated repo that 401s - before a user hits it, by verifying every default model pulls **and** loads.

## Subtasks

- **2.1 - Pull+load preflight runner.** New `engine/model_preflight.py`: `run_preflight(model_ids, ...)` pulls each default (via `ModelPuller` / `HFWeightsPuller` routed by protocol) then LOADS Ollama models with a one-token `/api/generate` (`_ollama_load_smoke`) - the check that catches the Gemma 4 runtime-load failure a pull-only test misses. `default_model_ids(tier)` reads `recommended.json`. Returns a per-model `PreflightResult` (pulled / loaded / ok / reason).
- **2.2 - Whole-catalog reachability probe (no download).** `probe_entry` / `probe_catalog` classify each source OK / GATED / DEAD / UNKNOWN via a HEAD on the HF `resolve` URL or the Ollama registry manifest; a `gated`-flagged entry resolves GATED without a network call; an `HF_TOKEN`, when set, is sent on HF probes.
- **2.3 - Local wiring + freeze-deferred CI.** `main.py` gained Qt-free `--reachability` (exit 1 if any default is gated/dead) and `--preflight [TIER]` (pull+load) flags + a `_run_preflight` handler. A `preflight-reachability` job was added to `installer-smoke.yml` (dispatch + monthly cron, no push trigger, so no minutes under the freeze); the multi-GB pull+load run stays a local `NEXUS_MODEL_PREFLIGHT=1` / `nexus-installer --preflight` command.

## Tests

`tests/test_model_preflight.py`: `default_model_ids` (all-tier ordered-dedup, tier filter, real recommended.json), `probe_entry` (HF 200/401/404/5xx/network + gated-short-circuit + Ollama registry URL), `probe_catalog` (incl. the real catalog's defaults are all reachable offline), `_ollama_load_smoke` (200/500/network), `run_preflight` (ollama pull+load ok, pull-ok-but-load-fails, pull-fails-reason, HF-only-no-server), and a `NEXUS_MODEL_PREFLIGHT=1`-gated live smoke. Full installer suite green; ruff clean; `nexus-installer --help` shows the flags.

## Deviations

- No dedicated installer README existed; the two modes are self-documented via `--help` (a standalone usage doc is deferred - IR.P2.B).
- The live pull+load reachability job is intentionally NOT wired to CI (multi-GB, needs a GPU-class Ollama); only the cheap reachability probe is.

## CI/CD

Added `preflight-reachability` to `installer-smoke.yml` (already dispatch/monthly-cron, freeze-safe). The reachability unit tests run in the standard installer pytest job.

## Next steps

Phase 3: the brand wordmark (gradient "AI Studio" + truncation fix) on the installer and the desktop app. Live pull+load verification of Phase 1's routing (IR.P2.A / IR.P1.A) awaits an operator run + the Actions freeze lift. Gaps in [../../known-gaps.md](../../known-gaps.md).
