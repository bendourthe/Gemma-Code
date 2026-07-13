# v1.11.0 - Installer Overhaul: One-Shot Reliability + Mockup UI + Clean-Machine Test Harness

**Status:** PLANNED (no phase started)
**Cycle:** v1.11.0 (docs under `docs/v1/v1.11/`; product version continues on the semantic-release 2.x line)
**Branch:** `feat/v1.11.0-installer-overhaul` (branch off `main`)
**Driver:** A real end-to-end install run (2026-07-12, `NexusSetup.exe` SHA `521590EF`) surfaced systemic failures: 4/8 models failed, the desktop step 404'd, and the installing-page UX diverged from the intended design. Operator direction: the installer must be a one-file experience a non-technical user can run with zero terminal/browser use.

---

## 0. Goals, Definition of Done, and Constraints

### Problem

The installer's core promise ("no terminal required") fails in practice:

1. **Model downloads break.** `ollama pull` exits `-1` with *no output* from the frozen windowed app - for BOTH the resolved `hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL` target AND `nomic-embed-text:latest` (a certainly-valid registry model), so the cause is environmental (process-spawn context), not target names. The SANA models 401 (gated HF repos). HF pins are placeholders, so hash verification silently skips.
2. **The desktop step 404s.** The provisioner fetches `SHA256SUMS.txt` + bundles from the GitHub `v2.1.0` release, which has no binary assets (semantic-release cut the tag during the Actions freeze; nothing uploaded).
3. **No clean-machine verification exists.** Every failure above shipped because nothing exercises the installer on a machine without the developer's environment.
4. **UI diverges from the mockup.** No sidebar navigation, no per-model progress rows with speed/ETA, logs not resizable, no copy feedback, wordmark renders far smaller than intended, Models page does not walk the category tabs, no background-continue.

### Persona

A **non-technical end user** on a fresh Windows machine. They download one file, double-click it, pick what they want, and everything else - runtimes, dependencies, models, extension, desktop app - arrives without a browser, a terminal, or prior knowledge.

### Definition of done (observable)

On a **clean Windows Sandbox** with no prerequisites installed, `NexusSetup.exe` alone:

- [ ] installs every dependency it needs (Ollama, Python environment, CUDA-aware configuration) with no user terminal/browser action;
- [ ] downloads every default-selected model in every category, in parallel, with a per-model progress row (size, %, speed, ETA); any individual failure is isolated, explained in plain language on-screen, and exportable (View/Copy/Save log) - the run never hangs;
- [ ] installs the VS Code extension and the **embedded** desktop app (no network fetch for the desktop step);
- [ ] matches the mockup: left sidebar navigation usable during install, top stepper, per-phase main bar + distinct sub-bars (only when >1 sub-step), resizable log area, copy-with-feedback, help footer;
- [ ] supports full background continuation: closing the window offers "continue in background" (tray icon + progress), and relaunching reattaches to the running install;
- [ ] the whole flow is reproducible via the in-repo harness: one command resets + runs the installer in Windows Sandbox; a Docker harness covers the Linux path; a documented manual checklist covers macOS.

### Decisions locked (operator, 2026-07-12)

- **D1 - Gated models:** audit every catalog URL live; re-point gated/dead entries to open-access mirrors or swap for equivalent open models. No HF-token flow this cycle; every default model must install with zero auth.
- **D2 - Desktop app:** **embed** the desktop bundle inside `NexusSetup.exe` (no GitHub-release fetch at install time). Keep the `desktop_bundle_override` seam.
- **D3 - Test harness:** Windows Sandbox (primary iterate loop) + Docker for the Linux path + a manual macOS checklist. No macOS virtualization on the Windows host.
- **D4 - Background mode:** FULL background continuation is in scope (detached/persistent engine, tray icon with progress, reattach UI).

### Non-goals (this cycle)

- Code signing / notarization (SmartScreen click-through stays documented).
- macOS/Linux automated end-to-end runs (harness covers Linux headless path; macOS is a manual checklist).
- Desktop-app feature work beyond what the embedded-bundle step needs.
- The `~/.nexus` -> `~/.nexus-ai` app-data home migration (separate plan, `NHC.HOME.1`).

### Risks / coordination

| ID | Item |
|----|------|
| RISK.1 | `unsloth/gemma-4-12b-it-GGUF` may not exist publicly at the pinned quant; the T103 audit decides re-point vs replace. The catalog `sizeGB: 7.37` vs the observed `8.1 GB` pull also needs reconciling. |
| RISK.2 | Embedding the desktop bundle grows `NexusSetup.exe` by ~100-160 MB (to ~320-380 MB). Accepted per D2; document the size and keep the build fail-closed if the bundle is missing. |
| RISK.3 | Background continuation (P7) is the largest new surface: engine/state separation, tray lifecycle, reattach. It lands late so a slip cuts cleanly without hurting P1-P6 value. |
| RISK.4 | Windows Sandbox requires Win11 Pro virtualization enabled (present on the dev host); CI cannot run Sandbox - harness runs are operator actions until the Actions freeze lifts (2026-08-01). |
| COORD.1 | The UI mockup must live in-repo for implementation reference: save the operator's mockup as `docs/v1/v1.11/design/installer-mockup.png` before P5. |
| COORD.2 | Installer version coupling: the embedded desktop bundle version must equal the product version at build time; `build-windows.ps1` becomes the single point that enforces this. |

### Carry-ins from prior cycles

- Placeholder HF pins (`pin-hf-weights.py` rotation never run) - resolved by T104.
- `NAME.P1.A` VSIX filename still `gemma-code-*.vsix` - opportunistic rename in P4 (T403) while the build pipeline is open.
- Installer lint/type baseline (`NHC.P5.A`) - untouched except where a phase edits a file (fix-what-you-touch rule).

---

## Phases at a Glance

| Phase | Title | Depends on | Rec. model / effort |
|-------|-------|-----------|---------------------|
| 1 | Download engine: root-cause + parallel per-model progress | - | strong reasoning tier, high effort (claude-opus-4-8 / high) |
| 2 | Clean-machine test harness (Sandbox + Docker + macOS checklist) | 1 | standard tier (claude-sonnet-5 / medium) |
| 3 | Dependency self-sufficiency (Ollama, Python, CUDA, VS Code) | 2 | strong reasoning tier (claude-opus-4-8 / medium) |
| 4 | Embed the desktop app in the installer | 2 | standard tier (claude-sonnet-5 / medium) |
| 5 | Installing-page progress UX v2 (per-model bars, logs, copy feedback) | 1 | standard tier (claude-sonnet-5 / medium) |
| 6 | Mockup shell: sidebar navigation + Models category flow + header fix | 5 | standard tier (claude-sonnet-5 / medium) |
| 7 | Full background continuation (tray + persistent engine + reattach) | 5, 6 | strong reasoning tier, high effort (claude-opus-4-8 / high) |
| 8 | MANDATORY FINAL: architecture refactor + known-gaps reconciliation + CI/CD + docs | all | standard tier (claude-sonnet-5 / medium) |

Every phase ends with: installer suite green (`uv run pytest`), `ruff`/`mypy` no *new* findings, a rebuilt `NexusSetup.exe` passing `smoke-windows-exe.ps1`, and (from P2 on) a Windows Sandbox harness run of the affected steps. Each phase's testing sub-task also creates/updates CI for that phase's changes where CI can carry it.

---

## Phase 1 - Download engine: root-cause + parallel per-model progress

The blocker phase: make every model download succeed or fail fast with a clear reason, and emit the per-model telemetry the new UI needs.

- [ ] **T101** Root-cause the `ollama pull` exit `-1` no-output failure from the frozen windowed app. Build a minimal windowed-context repro (frozen or `pythonw`) that runs `ollama pull` via the current spawn path and captures stderr SEPARATELY (stop merging into stdout for diagnosis). Prime suspects, in order: (a) `model_puller.py`'s `Popen` lacks `stdin=subprocess.DEVNULL` (the `run_command` fix was not mirrored there - the Go CLI may fail on an invalid inherited stdin handle); (b) `CREATE_NO_WINDOW` interaction with the ollama CLI's terminal handling; (c) the Ollama server not running/reachable at pull time (the CLI cannot auto-start it under these flags). Document the finding in the phase history.
- [ ] **T102** Fix the spawn path per T101 (expected: `stdin=DEVNULL` + verified flag set), AND make the model step **server-aware**: health-check `ollama` API before the first pull; if down, start `ollama serve` as a managed child (no console) and wait for readiness with a bounded timeout; surface a plain-language error if it cannot start. Never rely on the CLI's implicit server auto-start.
- [ ] **T103** Catalog reachability audit (live): for all 38 models, HEAD/range-check every HF URL and verify every ollama target resolves (`ollama pull --dry-run`-equivalent or manifest check). Re-point the gated SANA repos (401) to open-access mirrors or swap for equivalent open models (D1); fix any other dead/renamed repo; reconcile `gemma-4-12b-it-gguf` (RISK.1) and its `sizeGB`. Deliverable: an audit table in the phase history + updated `core/registry/catalog.json` (+ `recommended.json` if defaults change).
- [ ] **T104** Rotate the placeholder HF pins: run `scripts/installer/build/pin-hf-weights.py` against the audited catalog so every HF download is hash-verified (no more "placeholder pin; verification skipped"). Make a missing/placeholder pin a build-time warning surfaced by `build-windows.ps1`.
- [ ] **T105** Parallel downloads with per-model progress events: rework `ModelStepRouter` to run downloads concurrently (bounded worker pool, default 3, configurable; ollama pulls and HF downloads share the pool), and extend the engine signal surface with per-model telemetry - `model_started(id)`, `model_progress(id, fraction, bytes_done, bytes_total, speed_bps, eta_s)`, `model_completed(id)`, `model_failed(id, reason)`. Per-model failure isolation and cancel must hold under concurrency (cancel stops the pool and all children).
- [ ] **T106** [tests] Unit tests: spawn-path regression (stdin/flags asserted on the Popen call), server-health gating, concurrent-pool ordering/failure isolation/cancel, per-model event emission, catalog audit fixtures. Update `test_model_puller.py` / `test_model_router.py`. Gate: installer suite green; a manual live pull of `nomic-embed-text` from a frozen windowed build succeeds.

**Acceptance:** on the dev machine, a frozen `NexusSetup.exe` run downloads every default model concurrently with live per-model progress in the logs, and a deliberately-bad model id fails in seconds with a clear reason while the rest complete.

**Recommended model**: strong reasoning tier, high effort (claude-opus-4-8, high) - process-spawn forensics + concurrency rework.

---

## Phase 2 - Clean-machine test harness (Windows Sandbox + Docker Linux + macOS checklist)

The verification vehicle for every later phase (D3).

- [ ] **T201** Windows Sandbox harness under `scripts/installer/testing/`: a generated `.wsb` config mapping `dist/` read-only, an in-sandbox bootstrap script that runs `NexusSetup.exe` (interactive mode by default; `--headless-smoke` mode for scripted assertions), and a host-side runner (`run-sandbox-test.ps1`) that launches the sandbox, collects the installer's log export to a mapped output folder, and prints a pass/fail summary. Sandbox = fresh Windows every run (no Ollama/Python/VS Code) - exactly the persona machine.
- [ ] **T202** Scriptable assertion mode: an installer CLI flag (`--headless-smoke <profile>`) that drives the engine without the wizard (select profile-defined components/models, run, exit non-zero on any step failure, write a machine-readable result JSON). This is what the sandbox runner and CI-later consume.
- [ ] **T203** Docker Linux harness: a container image with no preinstalled deps that exercises the Linux install path (`build-linux.sh` output or source-mode engine run) with the same result-JSON contract.
- [ ] **T204** macOS manual checklist: `docs/v1/v1.11/testing/macos-install-checklist.md` - step-by-step verification for a physical Mac, mirroring the sandbox assertions.
- [ ] **T205** [tests] Harness self-tests (result-JSON schema, runner arg handling) + a documented runbook (`scripts/installer/testing/README.md`). Gate: one full sandbox run of the CURRENT installer recorded in the phase history (expected: reproduces any still-open failures - that is the point).

**Acceptance:** `./run-sandbox-test.ps1 -Profile default` performs a full clean-machine install run and produces a pass/fail JSON + collected logs, repeatably.

**Recommended model**: standard tier (claude-sonnet-5, medium).

---

## Phase 3 - Dependency self-sufficiency (Ollama, Python, CUDA, VS Code, disk)

Prove and harden every prerequisite step on the clean machine - the "no browser, no terminal, ever" guarantee (uses the P2 harness for every item).

- [ ] **T301** Sandbox-audit each provisioning step from scratch: Ollama (download+silent install+server start), the Python environment step (must bootstrap from the bundled/frozen runtime or a fetched standalone build - never assume system Python), CUDA/GPU path (detection on a GPU-less sandbox must degrade to CPU cleanly with plain-language messaging; on-GPU host verify the CUDA-aware config), VS Code detection (absent VS Code = clear "skipped: VS Code not found" outcome with guidance, not an error), disk-space gates. Document each step's from-scratch behavior in an audit table.
- [ ] **T302** Fix every gap the T301 audit finds (each fix lands with its own regression test). Known candidates: dependency download URLs pinned + hash-verified + fail-soft with retry; every child process spawned with the no-console discipline (`CREATE_NO_WINDOW` + `stdin=DEVNULL` via ONE shared spawn helper - unify `run_command` / `run_command_streaming` / `model_puller` so this class of bug cannot recur per-call-site).
- [ ] **T303** Plain-language failure surfaces: every dependency step failure produces (a) a one-sentence user-facing explanation, (b) a suggested next action, (c) the View/Copy/Save log affordance (P5 UI renders these; this phase supplies the structured error data).
- [ ] **T304** [tests] Per-step unit tests + a full sandbox matrix run (default profile, minimal profile, GPU-less). Gate: default-profile sandbox run completes end-to-end with zero manual intervention.

**Acceptance:** a fresh sandbox with nothing preinstalled reaches "Installation Complete" (models per P1, desktop per P4 once landed) without the user leaving the wizard.

**Recommended model**: strong reasoning tier (claude-opus-4-8, medium).

---

## Phase 4 - Embed the desktop app in the installer (D2)

- [ ] **T401** Build pipeline: `build-windows.ps1` gains a desktop-bundle stage - locate (or build via `npm run build:shell`) the NSIS `Nexus AI Studio_<ver>_x64-setup.exe`, verify its version equals the product version (COORD.2, fail closed), hash it, and embed it in the PyInstaller payload alongside a build-time manifest (name, version, sha256).
- [ ] **T402** Rework `desktop_provisioner.py`: install from the embedded payload (extract to temp, verify the build-time hash, run the NSIS bundle silently, health-check first launch) - delete the GitHub-release fetch path (and its `SHA256SUMS.txt` contract); keep `desktop_bundle_override` for dev. Fail-soft with the T303 structured error if the embedded payload is missing/corrupt.
- [ ] **T403** Opportunistic while the pipeline is open: rename the VSIX artifact to `nexus-coding-<ver>.vsix` (`build-vsix.ps1` + the installer's already-preferring glob + docs) - closes the `NAME.P1.A` remnant for this artifact.
- [ ] **T404** [tests] Pipeline tests (version-mismatch fails the build; missing bundle fails the build), provisioner tests (hash verify, silent-install invocation, override seam), packaging smoke updated for the new size (~320-380 MB, RISK.2). Gate: sandbox run installs the desktop app fully offline-from-GitHub.

**Acceptance:** the desktop step succeeds on the sandbox with networking to GitHub blocked; `NexusSetup.exe` is the single artifact a user needs.

**Recommended model**: standard tier (claude-sonnet-5, medium).

---

## Phase 5 - Installing-page progress UX v2

Correcting the v1.10 interim redesign per operator feedback, wired to the P1 telemetry.

- [ ] **T501** Sub-step progress model: keep the phase's main accent bar; render sub-step bars ONLY when a phase covers >1 sub-step (single-step phases like VS Code Extension show no redundant sub-bar); style sub-bars visually distinct from the main bar (thinner + translucent/desaturated accent).
- [ ] **T502** Per-model progress rows (the mockup's Models pane): one row per selected model - name, distinct sub-bar, `X GB / Y GB (Z%) - S MB/s - ETA` and state text (`Waiting to start` / `Downloading...` / `Done` / `Failed: <reason>`), driven live by the P1 `model_*` events under parallel downloads; phase-level % indicator.
- [ ] **T503** Log area modernization: user-resizable via a visible drag handle on the bottom edge (grip affordance, min/max heights) - replacing the splitter that did not read as resizable; monospace rendering, level colors kept.
- [ ] **T504** Copy-button feedback: on click, swap the copy icon to a checkmark with a transient "Copied" label (~1.5 s) then revert - standard clipboard UX. Save keeps the download icon; both get tooltips.
- [ ] **T505** Failure surfacing: a failed step/model auto-expands its details, shows the T303 plain-language reason + suggested action inline, with View/Copy/Save log adjacent (operator requirement: failures must never require scrolling raw logs to understand).
- [ ] **T506** [tests] Widget tests for conditional sub-bars, per-model row updates from synthetic events, resize behavior, copy-feedback state machine, failure auto-expand. Gate: installer suite green + visual pass in the sandbox.

**Acceptance:** during a real install, each downloading model shows its own live row with speed/ETA; single-step phases show one clean bar; logs resize by dragging; copy shows "Copied"; a failed model reads as one plain sentence with log actions.

**Recommended model**: standard tier (claude-sonnet-5, medium).

---

## Phase 6 - Mockup shell: sidebar navigation + Models category flow + header fix

Adopt the mockup layout (COORD.1: mockup PNG must be in-repo first).

- [ ] **T601** Left sidebar navigation per the mockup: all wizard sections listed with state icons (done/current/pending); the top stepper is retained; "Need help? Visit our documentation" footer block. Sidebar is the primary navigation surface.
- [ ] **T602** Free navigation during install: while the Installing step runs, the user can click any sidebar section to review it (read-only for already-applied choices; Installing keeps running and its live state is intact on return). Guard rails: sections whose changes can no longer apply are visibly locked with an explanatory tooltip.
- [ ] **T603** Models page category flow: "Next" walks every model-category tab in order (Chat -> Agentic -> Image -> Video -> Audio -> ...) before leaving the page; each category requires an explicit selection or an explicit "skip this category" acknowledgment; the sidebar/stepper reflects intra-page category progress.
- [ ] **T604** Header sizing per operator feedback: logo -30% (120 -> 84 px) and the "Nexus AI Studio" wordmark rendered at the SAME effective size as the "Step X of Y" counter. Root-cause why the 44 px `QFont.setPixelSize` renders tiny (expected: the global QSS `QLabel` font-size overrides the widget `QFont` - move the wordmark size into the stylesheet) and normalize both texts through one mechanism.
- [ ] **T605** [tests] Navigation state-machine tests (during-install navigation, lock rules), category-flow tests (cannot pass Models without visiting every tab), header regression (wordmark px == step-counter px). Gate: side-by-side visual pass against `docs/v1/v1.11/design/installer-mockup.png` in the sandbox.

**Acceptance:** the installer visually matches the mockup; a user mid-install can revisit Prerequisites and return to a still-live Installing view; Models cannot be skipped past without per-category decisions.

**Recommended model**: standard tier (claude-sonnet-5, medium).

---

## Phase 7 - Full background continuation (D4)

The largest new capability; lands after the UI shell so it composes with it.

- [ ] **T701** Engine/UI separation: the install engine's progress state (per-step, per-model, logs) is continuously persisted to a state file (`%LOCALAPPDATA%/NexusInstaller/state.json` + rolling log) via the existing signal surface, making the UI a reattachable view.
- [ ] **T702** Tray mode: closing the window during an active install offers "Continue in background" (alongside Cancel install / Keep open); choosing it hides the window to a system-tray icon showing live progress (tooltip + percent), with a menu (Open installer, Cancel install). Install completion raises a tray notification.
- [ ] **T703** Reattach: relaunching `NexusSetup.exe` while an install is running (single-instance detection) reopens the wizard attached to the live engine at the Installing view, fully populated from T701 state. A completed background install relaunch shows the Complete page.
- [ ] **T704** Crash/exit safety: killed mid-install -> the state file records the interruption; next launch offers resume-or-restart per step idempotency (already-completed steps are detected and skipped where safe: extension present, model files verified).
- [ ] **T705** [tests] State-persistence round-trip, single-instance/reattach handshake, tray state machine, resume-detection logic; sandbox scenario scripts (close-to-tray mid-model-download, reattach, complete). Gate: sandbox run where the window is closed mid-download and the install completes from the tray, then reattaches.

**Acceptance:** the mockup's "close this window and we'll continue in the background" is literally true, including reattach and completion notification.

**Recommended model**: strong reasoning tier, high effort (claude-opus-4-8, high).

---

## Phase 8 (MANDATORY FINAL) - Architecture refactor, known-gaps reconciliation, and CI/CD

- [ ] **T801** Architecture refactor pass over the installer tree grown by P1-P7 (engine/UI boundaries, the unified spawn helper, dead code from the deleted release-fetch path); `project-refactor` detectors (empty dirs, duplicates, orphans).
- [ ] **T802** Known-gaps reconciliation: resolve/defer/transfer every v1.11.0 gap; fold the carried items (installer lint baseline `NHC.P5.A` disposition, any T103 models deferred as unavailable, macOS checklist outcomes).
- [ ] **T803** CI/CD: wire the headless-smoke (T202) result-JSON into CI where runnable (Linux container path now; Windows Sandbox stays an operator action until the Actions freeze lifts, then add a scheduled Windows job); ensure the installer pytest/ruff/mypy gates and the packaging smoke run in CI; optimize for minutes (path filters, concurrency).
- [ ] **T804** [tests + docs] Whole-repo final gate: root + desktop + installer suites green, `tsc`/lint/ruff clean, all new CI gates green; docs canonical (`check:docs-layout`), DEVLOG/todos/README updated; release-readiness handoff to `/update release` (never auto-tag/push).

**Acceptance:** the plan's DoD checklist in Section 0 is fully checked, gaps reconciled, CI enforcing the new invariants.

**Recommended model**: standard tier (claude-sonnet-5, medium).

---

## Sequencing rationale

P1 (downloads) is the user-visible blocker and needs no new infrastructure. P2 (harness) immediately becomes the gate vehicle for everything after - P3 (dependencies) and P4 (embedded desktop) are correctness phases proven in the sandbox. P5 -> P6 build the UI in dependency order (progress model first, shell around it). P7 (background) is deliberately late: it is the largest new surface (RISK.3) and cutting it does not diminish P1-P6. P8 is the standing final-phase contract.
