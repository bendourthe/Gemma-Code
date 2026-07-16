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

## 1c. Phase 3 -- dependency self-sufficiency (landed 2026-07-14)

**T301 audit table (live engine steps, from-scratch behavior):**

| Step | From-scratch behavior found | Fixed by |
|---|---|---|
| ollama | ALWAYS aborted: v0.3.6 pin + all-zero sha256 could never verify (IO.P1.B); `_verify_ollama` start-then-killed its own server (fixed in P1) | T302: pin v0.32.0 + GitHub-published digests (Win exe + Linux tar.zst); Authenticode kept fail-closed; Linux moved off unpinnable install.sh to the immutable release asset, user-local (no sudo), PATH-prepended |
| extension | Absent VS Code = step FAILURE ("VS Code CLI not found") on a normal user machine | T302: clean SKIP with guidance + `state.skipped_steps`; real failures carry structured reasons |
| venv | No-op stub since v0.4.0 (ADR-0001) -- no system-Python assumption exists in the live path | none needed (audit finding) |
| model | Fixed in P1 (decode bomb, server-awareness, parallel) | -- |
| desktop | 404s on missing release assets | P4 (embedding) |
| GPU detection | `_run_cmd` returns None on missing nvidia-smi -> clean "none" vendor -> CPU path; CUDA provisioner has explicit cpu-fallback/missing-payload modes | none needed (code-verified; GPU-less empirical run = sandbox/operator) |
| disk gates | `can_select_model` reserve-floor logic + HF puller disk precheck present | none needed |

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.P3.A | P2 | NI | **The payload provisioner chain is UNWIRED scaffolding**: `provisioner_dispatch.run_chain/chain_for` (cuda/python/node/ffmpeg/per-OS-ollama with bundled payloads) has ZERO callers outside its own tests, and no payload is bundled (the exe is 220 MB; the wheels would be GBs). The desktop app owns its own diffusion runtime (sidecar `diffusion/runtimeFactory.ts` et al.), so Image/Video provisioning does not depend on this chain. | Product decision beyond this cycle: either wire + bundle (huge artifact) or retire the chain. Recorded for the P8 refactor pass; the audit's spawn-discipline fixes were applied to its provisioners anyway (IO.P1.C closed). |
| IO.P3.B | P2 | QG | **T304's "default-profile sandbox run completes end-to-end" gate is pending**: Windows Sandbox is still an operator action (IO.P2.A), and end-to-end completion is structurally impossible before P4 lands the embedded desktop step. The phase's unit gates all ran (full suite, live headless-smoke regression green). | Run `testing/run-sandbox-test.ps1 -ProfileName sandbox-default` after enabling Sandbox; re-run after P4 for the full-completion assertion. |
| IO.P3.C | P3 | NI | The Ollama pin (v0.32.0) means a ~1.4 GB dependency download on both platforms at install time (upstream's size, not ours); the pinned tag will drift behind upstream over time. | `build/check-ollama-pin.py` (advisory; `--strict` for CI) prints the current digests for one-command rotation. |

## 1d. Phase 4 -- embed the desktop app (landed 2026-07-14)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.P4.A | P2 | NI | **Only the Windows build embeds a desktop payload.** build-windows.ps1 stages the NSIS bundle fail-closed; build-macos.sh / build-linux.sh do not stage their DMG/AppImage yet, so frozen mac/linux installers fail the desktop step with the structured "missing from this installer build" reason (the override seam still works). | Extend the mac/linux build scripts with the same staging stage when those platforms get their packaging pass (macOS checklist covers the manual path meanwhile). |
| IO.P4.B | P3 | NI | The Tauri NSIS bundle is only ~1.7 MB (a web-bootstrapping stub) -- RISK.2's feared +100-160 MB growth did not materialize, but it means the desktop app's own installer may fetch WebView2/runtime pieces from the network at ITS install time (Tauri's default bootstrapper behavior). | Verify in the operator sandbox run what the NSIS stub downloads on a clean machine; if it breaks the offline-from-GitHub goal, switch the Tauri bundler to the embedBootstrapper/offline installer option in the desktop workspace. |
| IO.P4.C | P3 | NI | The engine's desktop-step progress is now coarse (verify 0.3 -> install 0.9 -> health 1.0); the old download-driven progress curve is gone with the fetch path. | P5's per-step UI renders step status + reasons; a finer NSIS-install progress signal is not available from a silent /S run. |

## 1e. Phase 5 -- installing-page progress UX v2 (landed 2026-07-16)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.P5.A | P3 | NI | Per-model bytes/speed/ETA remain sizeGB-derived estimates (IO.P1.D unchanged); the rows render whatever the telemetry carries, so refining the engine estimates automatically improves the rows. | Engine-side refinement stays tracked as IO.P1.D. |
| IO.P5.B | P3 | QG | The visual pass (side-by-side with the mockup, real download rows under parallel pulls, grip drag feel) is an operator check on the rebuilt exe; the widget behavior is unit-tested but pixels are not. | Operator: run dist/NexusSetup.exe through an install and compare against docs/v1/v1.11/design/installer-mockup.png; P6 does the surrounding shell. |
| IO.P5.C | P3 | NI | The IO.P1.A gated-models UI decision (flag-or-remove) was deferred to P6's Models-page work -- the P5 failure rows now at least surface gated 401s per-model with the reason inline. | Decide with T603's category-tab rework. |

## 1f. Phase 6 -- mockup shell: sidebar + category flow + header fix (landed 2026-07-16)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.P6.A | P3 | NI | The T602 read-only lock (`set_interactive`) is implemented on the Models page (the one page with live inputs); the other choice pages show the sidebar lock icon + tooltip and stay viewable, but their inner controls are not individually disabled (they are informational or already-committed). | If a later page grows editable inputs, add `set_interactive` there; the window already calls it by duck-type. |
| IO.P6.B | P3 | QG | The pixel-level pass against the mockup (sidebar proportions, nav-icon legibility incl. the padlock glyph rendering under Segoe UI, brand hero size, step-counter placement top-right) is an operator sandbox check; the shell behavior is unit-tested but pixels are not. | Operator: run dist/NexusSetup.exe and compare against docs/v1/v1.11/design/installer-mockup.png. |
| IO.P6.C | P3 | NI | The category flow's "walk every tab" stops only on categories with NO decision -- a category satisfied by a pre-ticked default counts as decided and is not forced to be re-acknowledged. | Matches the "explicit select-or-skip" intent (a default IS a selection); revisit only if the operator wants a hard stop on every tab. |
| IO.P6.D | P3 | NI | The sidebar "Need help?" block and docs link open the repo URL (`DOCS_URL = github.com/bendourthe/Nexus-AI`) via QDesktopServices; there is no dedicated docs site yet. | Swap `DOCS_URL` in constants.py when a docs site exists. |
| IO.P6.E | P3 | NI | The IO.P1.A/IO.P5.C gated-models UI decision (flag-or-remove in the picker) was NOT taken in P6 -- the category flow surfaces categories, not per-model auth state. Gated 401s still only surface at install time (the P5 inline failure rows). | Carry to P8 known-gaps reconciliation, or a follow-up Models-page pass. |

## 2. Cross-cutting

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| IO.CC.1 | P2 | NI | `catalog.json` is shared app+installer data: the T103 re-points (flux-schnell -> Comfy-Org mirror; sana-sprint/video -> public diffusers repos; 2K/4K/dc-ae file-path fixes) and the T104 pin rotation (26 files pinned) change what the desktop app's registry serves too. Root registry suite green (114 tests). | Note for the app side: the diffusion runtime loads from the same per-model dirs; repo swaps preserved the transformer-file convention. |
