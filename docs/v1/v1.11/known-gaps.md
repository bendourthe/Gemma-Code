# v1.11.0 Known Gaps -- `installer-overhaul`

Tracks unfinished work, deferrals, and coordination for the v1.11.0 installer overhaul ([plan](plans/installer-overhaul.md)). One row per gap.

**Severity:** P0 (blocker) / P1 (high) / P2 (medium) / P3 (low).
**Category:** NI (note/info) / DF (deferred) / BG (bug) / MT (migration) / WN (warning) / QG (quality-gate) / CO (coordination).

---

## 1. Phase 1 -- download engine root-cause + parallel per-model progress (landed 2026-07-13)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.P1.A | P2 | DF | **6 gated models remain in the catalog with no public equivalent** (verified by the T103 live audit + candidate probes): `svd`, `stable-audio-open-1.0`, `sana-1.6b-int4`, `sana-controlnet-pose/depth/canny`. All 6 are HF-license-gated (401 anonymously) and are NOT in the `recommended.json` defaults, so a zero-auth default install is unaffected. Post-T101/T105 they fail fast with a per-model "401 Unauthorized" reason instead of hanging. Their pins also stay placeholders (the same 6 drive the T104 build warning). | Decide in P5/P6: either surface a "requires a HuggingFace account" state in the catalog UI (a `gated` catalog flag + Models-page treatment) or remove the entries. Do not silently ship entries that always fail. |
| IO.P1.B | P1 | BG | **Clean-machine Ollama install is broken by construction** (found during T101 forensics, out of P1 scope): `ollama_installer.py` pins `OLLAMA_PINNED_TAG = v0.3.6` (ancient; current 0.24.x) with an ALL-ZERO `OLLAMA_WINDOWS_SHA256`, and `_verify_sha256` can never match an all-zero pin -> on a machine without Ollama the install aborts at "Checksum mismatch". It only worked in the field because Ollama pre-existed. The Linux script pin is all-zero too. | P3 (T301/T302) target, verified in the P2 sandbox: bump the pinned tag, record real checksums, and make pin freshness a build-time check. |
| IO.P1.C | P3 | NI | The no-console spawn sweep covered every Windows-relevant call site via `no_window_kwargs()`; pure non-Windows paths (`metal/rocm/linux` provisioners' `bash` calls, macOS `open`) were left as-is (no console concept to fix). | P3's unified-spawn-helper task (T302) folds the remaining sites for uniformity. |
| IO.P1.D | P3 | NI | Per-model telemetry (bytes/speed/ETA) is derived from the catalog `sizeGB` estimate, not real byte counts; the HF puller knows real bytes but the ollama path does not expose them uniformly. | Refine when P5 consumes the events (parse ollama's "X GB/Y GB" progress text; use content-length on the HF path). |
| IO.P1.E | P2 | QG | The fix is proven at the exact code path (`ModelPuller.pull_model` pulling the field-failure model `nomic-embed-text` from windowed pythonw: success, 77 progress samples), but a full frozen-`NexusSetup.exe` end-to-end install has not been re-run yet. | The P2 sandbox harness makes this a one-command check; the next operator install run also covers it. |
| IO.P1.F | P3 | NI | Ollama's spinner rewrites can concatenate into one long "pulling manifest ⠋ pulling manifest ⠙ ..." log line (cosmetic; fragments carrying text are all logged). | P5's log rendering collapses/dedupes progress rewrites. |

## 1b. Phase 2 -- clean-machine test harness (landed 2026-07-14)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.P2.A | P2 | QG | **The first REAL clean-machine harness runs are operator actions**: Windows Sandbox is not enabled on the dev host (needs the optional feature + a reboot) and Docker is not installed, so the full sandbox/docker runs could not execute this phase. What WAS validated: the runner's graceful degradation (exit 2 with enable instructions), the full headless-smoke contract from source (exit 0, valid result JSON), and the FROZEN exe honoring the same contract (windowed-detached run wrote `nexus-smoke-result/v1`, success). | Operator: enable "Windows Sandbox" (Turn Windows features on/off, reboot) then `testing/run-sandbox-test.ps1`; install Docker Desktop then `testing/run-docker-test.sh`. Expected first result: FAIL at the Ollama step (`IO.P1.B`) -- the harness catching exactly what it was built to catch. |
| IO.P2.B | P3 | NI | The sandbox runner cannot programmatically close the sandbox window (no stable CLI across Win11 builds); it is left open for inspection with a printed note. | Revisit when the `wsb.exe` CLI (Win11 22H2+) can be feature-detected; low value until then. |
| IO.P2.C | P3 | NI | Smoke profiles are BOM-tolerant (`utf-8-sig`) after the local validation caught PowerShell's `Out-File -Encoding utf8` BOM breaking profile loads (regression-tested). | Fixed in-phase; recorded for the P3 audit's attention to operator-authored config robustness. |

## 2. Cross-cutting

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.CC.1 | P2 | NI | `catalog.json` is shared app+installer data: the T103 re-points (flux-schnell -> Comfy-Org mirror; sana-sprint/video -> public diffusers repos; 2K/4K/dc-ae file-path fixes) and the T104 pin rotation (26 files pinned) change what the desktop app's registry serves too. Root registry suite green (114 tests). | Note for the app side: the diffusion runtime loads from the same per-model dirs; repo swaps preserved the transformer-file convention. |
