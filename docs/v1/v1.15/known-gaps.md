# Known Gaps - v1.15.0 (Installer, Registry, Window, and Studio-Chat Fixes)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)

## v1.15.0

### Open Items (Phase 1)

_No open items._ Phase 1 (desktop shell: window controls + open maximized) introduced no deviations, skipped tests, coverage gaps, suppressed warnings, or bypassed gates.

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| (none) | | Phase 1 | | | |

### Open Items (Phase 2)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P2.A | WN | Phase 2 | `pages/complete.py:203` trips mypy strict (`Item "None" of "QWidget | None" has no attribute "deleteLater"`) in the services-list rebuild loop | Pre-existing on HEAD (verified by stashing this phase's edits and re-running mypy -- the error is at the same untouched loop); out of scope per the change-scope rule (my edits only added an import and the `on_finish` state-clear call, both type-clean) | Guard with `w = item.widget()` + `if w is not None: w.deleteLater()` in a dedicated cleanup pass |
| IRSC.P2.B | MT | Phase 2 | The two `state_store.clear_state` call sites -- `CompletePage.on_finish()` and the `main.py` SHOW_COMPLETE branch -- have no direct unit test | Both are thin one-line Qt / entry-point glue over the fully-unit-tested `clear_state` helper; the pure behaviour (clear -> reload None -> `interpret_startup` FRESH) is covered by `TestClearState` | Add a Qt offscreen test asserting `on_finish` clears the state file during the next Qt/on-device test pass |
| IRSC.P2.C | DF | Phase 2 | The NSIS uninstaller additions (`RMDir /r "$LOCALAPPDATA\NexusInstaller"`) are verified by inspection, not by a NSIS build | No NSIS compiler in this environment; the change is a one-line addition mirrored in both `legacy/nexus-setup.nsi` and `legacy/setup.nsi` | Confirm during the next on-device installer/uninstaller QA pass |

### Open Items (Phase 3)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P3.A | MT | Phase 3 | The model-only retry re-entry (`InstallingPage.retry_models` + the `main.py` `_retry_failed_models` wiring) has no end-to-end Qt/thread integration test | The pure retry-state prep (`prepare_model_retry`) and the Complete-page button surface (visibility rules + `retry_requested` emission) are unit-tested; a real retry needs a running engine thread + a failed download to reproduce | Exercise a live retry (fail a model, click "Retry failed downloads", confirm only that model re-downloads) during the next on-device installer QA pass |
| IRSC.P3.B | WN | Phase 3 | Pre-existing mypy-strict violations surfaced while editing (confirmed present at HEAD via a stash baseline, out of scope): `widgets/gated_auth_dialog.py` `entry: dict` bare type-args, `pages/installing.py` `request_cancel` QMessageBox StandardButton, `main.py:244/272/434` | Not on any line this phase changed; the change-scope rule keeps them out. This phase added 0 new mypy errors (new modules are strict-clean) | A dedicated installer strict-typing cleanup pass (fold in the Phase 2 `complete.py:203` item IRSC.P2.A) |
| IRSC.P3.C | DF | Phase 3 | The spec fail-closed assertion + catalog guard are verified by the pytest invariant test and `check-catalog.py`, not by an actual PyInstaller build in this environment | Building the frozen exe needs the Windows build toolchain / desktop payload; the invariant logic itself is fully unit-tested and runs in the installer pytest CI job | Confirm the fail-closed build behaviour on the next CI / on-device build |

Deviation note (Phase 3): the plan's 3.1 "hash compare the bundled catalog against the repo" was implemented as a **content-invariant regression guard** instead. The PyInstaller spec bundles `catalog.json` straight from the repo, so a literal bundle-vs-repo hash compare is a no-op; the invariant guard is higher-value (it fails when the catalog *regresses* to a broken shape, which is what actually shipped the v1.13/v1.14 defects).

### Open Items (Phase 4)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P4.A | MT | Phase 4 | `modelsService.createModelsRuntime` (the composition root: `ModelStorage` + `NexusModelRegistry` construction, `resolveCatalog`, the `diskUsage` `statfs` branch) is integration-only, not unit-tested (`modelsService.ts` 73.55% lines) | It wires real disk + catalog + an Ollama pull client; the reconcile / list / remove / diskUsage logic and the install job manager ARE unit-tested. Global coverage stays 92.23% lines / 84.69% branch, above the 80/70 gate | Add an integration test that builds a real runtime against a temp `~/.nexus/models` + a fake catalog during the next test pass |
| IRSC.P4.B | BG | Phase 4 | In-app install works for Ollama-protocol models (LLM / embed) but an HTTP / diffusers model whose catalog `source.sha256` is the all-zero placeholder will fail verification in the core `Downloader` (it verifies against the pin, unlike the installer's tolerant HF puller) | Most catalog HF entries still carry placeholder pins (v1.14 IRSC.P1.C / P2.C). The reflect + Ollama-install paths -- the common "get more models" case -- are unaffected | Rotate the HF `sha256` pins (`scripts/installer/build/pin-hf-weights.py`) or teach the core `Downloader` the installer's skip-on-placeholder behaviour before relying on in-app HF install |
| IRSC.P4.C | DF | Phase 4 | Runtime catalog resolution for the PACKAGED sidecar: `resolveCatalog` falls back to the core loader's `__dirname`-relative default, which may not sit beside `catalog.json` in the esbuild bundle. In that case `list()` still surfaces Ollama / weights-probed installs but shows no catalog-only "Available" rows | Dev + tests resolve the catalog fine (repo tree / `NEXUS_CATALOG_PATH`); the packaged-bundle path needs the desktop packaging build to stage `catalog.json` or set the override | Stage `catalog.json` for the packaged sidecar (or set `NEXUS_CATALOG_PATH`) during the Tauri packaging build and verify on-device |

Note (Phase 4): the studios' Settings deep-link (`SETTINGS_MODELS_PATH = /settings?tab=models`) relies on Models being the default Settings tab; the `?tab=` query is not read live for an already-mounted Settings page. Acceptable since the studios (Phases 5-6) navigate fresh to `/settings`.

### Open Items (Phase 5)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P5.A | NI | Phase 5 | Inline inpaint mask-painting is not wired into the chat composer. From chat, txt2img / img2img / outpaint are fully reachable; inpaint fires only when a mask is supplied | The intent layer + diffusion client + `MaskEditor` all support inpaint, but the chat composer has no "paint a mask on this attachment" affordance yet | Add an "Add mask" action on an attachment that opens `MaskEditor` and feeds the painted mask into the next send, so inpaint is reachable from chat |
| IRSC.P5.B | WN | Phase 5 | The ImageStudioPage tests log React `act(...)` warnings from the async installed-models load effect | Benign: the effect is cancel-guarded and settles to the fallback model; the assertions pass deterministically | Wrap the model-load settle in `act` (or await it) in the affected tests during a test-polish pass |
| IRSC.P5.C | DF | Phase 5 | When no image model is installed, the selector shows a single fallback (the SANA default) + a "Get more models" prompt rather than hard-blocking generation | Keeps generation working in dev / on a fresh install where the bundled runtime may still have a default; the plan's "installed-only" is honored when real models are present | Confirm the desired non-technical behavior on-device (fallback vs. block-until-installed) |

### Open Items (Phase 6)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P6.A | NI | Phase 6 | The per-second latent thumbnail strip and the `TimelinePreviewer` frame-stepper are not rendered in the chat surface; a completed clip plays in a plain `<video>` inside the message bubble | The chat bubble renders the finished clip with native controls, which covers the non-technical flow; the strip/scrubber were tied to the retired sidebar layout. `TimelinePreviewer.tsx` is retained and still unit-tested | Render `TimelinePreviewer` inside the assistant bubble (or on click-to-expand) if frame-accurate review is wanted back |
| IRSC.P6.B | DF | Phase 6 | `resolveMp4Url` still defaults to the identity function, so a real clip plays only once the Tauri filesystem allow-list resolves sidecar mp4 paths | Carried over from the pre-redesign page (the same default was there); tests inject a mock resolver | Wire the `file://`/asset-protocol resolver when the Tauri fs allow-list lands, then verify playback on-device |
| IRSC.P6.C | WN | Phase 6 | Same benign React `act(...)` warnings as Phase 5, from the async installed-models load effect | Effect is cancel-guarded and settles deterministically; assertions pass | Fold into the same test-polish pass as IRSC.P5.B |

### Summary

- Open: Phase 1 = 0; Phase 2 = 3 (IRSC.P2.A pre-existing mypy WN, IRSC.P2.B two call-site MT, IRSC.P2.C NSI verify-by-inspection); Phase 3 = 3 (IRSC.P3.A retry integration-test MT, IRSC.P3.B pre-existing mypy WN, IRSC.P3.C build-verify DF); Phase 4 = 3 (IRSC.P4.A composition-root MT, IRSC.P4.B HF-install sha-placeholder BG, IRSC.P4.C packaged-catalog DF); Phase 5 = 3 (IRSC.P5.A inpaint-mask NI, IRSC.P5.B act-warning WN, IRSC.P5.C fallback-model DF); Phase 6 = 3 (IRSC.P6.A timeline/strip NI, IRSC.P6.B mp4 URL resolver DF, IRSC.P6.C act-warning WN).
- Resolved so far:
  - Phase 1 (Issue 4) -- the custom title bar's window controls are un-buried (gave `.nexus-titlebar` its own stacking context above the opaque backdrop) and the window opens maximized while staying resizable.
  - Phase 2 (Issue 1) -- a normally completed/failed run no longer redirects a cold relaunch to the Complete page: `interpret_startup` routes cold terminal states to `DECISION_FRESH` (Welcome); `CompletePage.on_finish()` and the one-time SHOW_COMPLETE reopen both clear the persisted state via `state_store.clear_state`; and both NSIS uninstallers now remove `%LOCALAPPDATA%\NexusInstaller`. The crash-recovery "interrupted-but-all-done -> show-complete" promotion is preserved.
  - Phase 3 (Issue 2) -- a catalog content-invariant guard (`catalog_invariants` + `check-catalog.py` + fail-closed spec + `test_catalog_invariants`) stops a stale/regressed catalog shipping; the gated-model dialog gained plain-language copy + a direct token-settings link; and the Complete page now shows a plain-language per-model summary (succeeded / skipped-needs-token / failed-with-reason) plus a "Retry failed downloads" button that re-runs only the failed model ids via the engine resume path.
  - Phase 4 (Issue 3) -- the Settings > Models page now reflects the REAL installed set: the sidecar `models.list` runs `NexusModelRegistry.list()` reconciled against Ollama's `/api/tags` and the installer's `~/.nexus/models/weights/<id>/` tree (`installedProbe.markInstalledFromProbe`), so installer-downloaded models show as Installed instead of catalog-only. `models.remove` / `models.diskUsage` are real, in-app install is a streaming job (`models.install` accept -> `models.install.drainEvents` -> `models.install.cancel`), the app renders the real `createIpcModelsClient` (mock retired to tests), and a shared `installedModelsForType` + `SETTINGS_MODELS_PATH` feed the Phase 5-6 studio selectors. Resolves the long-tracked gap 5.P1.BB.
  - Phase 6 (Issue 5, video) -- Video Lab is now a chat too, reusing the Phase 5 scaffold: the mode `<select>` is gone (`inferVideoIntent` picks text2video with no attachment, image2video with one), the selector lists installed video models + "Get more models", generated clips play inline in the assistant bubble, parameters sit behind "Advanced settings" (with `VideoPromptForm hideMode`), and Copy Workflow / Use as Source are per-message.
  - Phase 5 (Issue 5, image) -- Image Studio is now a chat: the four mode tabs + parameter sidebar are gone, replaced by a model selector (installed image models from Phase 4 + "Get more models"), a message history with inline generated images, and an attachment-capable composer (`MediaComposer`: + button, drag-drop, paste, removable thumbnails). `inferImageIntent` maps (prompt + attachments + mask) to txt2img / img2img / outpaint / inpaint; parameters live behind an "Advanced settings" panel; per-message Download / Copy Workflow / Use as Source. `ChatMessage` + `MessageBubble` gained optional media/attachment fields (text-only Chat / Coding paths unchanged).
- Note: on-device confirmation of the maximized window/controls (Phase 1), the uninstaller state-dir removal (Phase 2, IRSC.P2.C), a live retry (Phase 3, IRSC.P3.A), the fail-closed build (Phase 3, IRSC.P3.C), and the packaged-sidecar catalog resolution + a live in-app install (Phase 4, IRSC.P4.B/C) fold into the standard on-device QA pass; the pure logic is unit-tested (`desktopBranding.test.ts`, `test_background_resume.py`, `test_catalog_invariants.py`, `test_install_summary.py`, `test_gated_auth_dialog.py`, `test_pages_qt.py`, `installedProbe.test.ts`, `modelsService.test.ts`, `installManager.test.ts`, `ipcModelsClient.test.ts`, `installedFeed.test.ts`).

_Last updated: 2026-08-05 (Phase 6)._
