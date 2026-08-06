# Session History - v1.15.0 Phase 6: Video Lab chat redesign

**Date**: 2026-08-05
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 6 of 8 - "Video Lab Chat Redesign (Issue 5, video)"
**Outcome**: Complete. Quality gate GO (desktop suite 77 files / 581 pass, 0 fail; eslint + tsc clean; coverage 92.29% lines / 84.49% branch, above the 80/70 gate).

## Goal

Fix Issue 5 for video: apply the Phase 5 chat treatment to the Video Lab so a non-technical user drops an image (or nothing), types a request, and gets a clip back - with no mode select and no parameter sidebar.

## What was done

### Video intent inference
- `modules/video/intent.ts`: `inferVideoIntent({text, attachments})` -> `text2video` (no image) or `image2video` (first attachment animates), with a mode-specific default prompt for an image-only request (the protocol requires a non-empty prompt). Mirrors the image intent module.

### Video Lab rebuilt as chat
- `modules/video/VideoLabPage.tsx`: rebuilt on the Phase 5 scaffold - a `ModelSelector` fed by the Phase 4 `installedModelsForType(models, "video")` feed plus a "Get more models" entry, a message history whose assistant bubbles play the finished clip inline (`ChatMedia kind: "video"` via `resolveMp4Url`), and the shared `MediaComposer` for the prompt + image attachment. Send -> intent -> `videoClient.text2video` / `image2video` -> the existing `drainEvents` polling fills the message's media on complete. Parameters (duration, fps, resolution, steps, CFG, seed, sampler, presets) live behind "Advanced settings"; Copy Workflow / Use as Source are per-message.
- `modules/video/VideoPromptForm.tsx`: new `hideMode` prop (default false, so other consumers are unchanged) - the chat page hides the vestigial Mode select since intent is attachment-inferred.
- `App.tsx`: passes `onGetMoreModels` (navigates to the Settings Models tab) to the page.

## Test results

- Full desktop suite: 77 files / 581 tests, 0 failures. `VideoLabPage.test.tsx` rewritten for the chat flow (7 tests: selector/empty/composer/Advanced render, mode select gone, text2video end-to-end with inline clip, image2video with the source image, error surfaced in the bubble, Copy Workflow, Get-more-models callback); new `videoIntent.test.ts` (5). The existing `VideoPromptForm` test still passes unchanged (hideMode defaults false). eslint + tsc clean; coverage 92.29% lines / 84.49% branch.

## CI/CD

- No change: `shell-build.yml` already covers `desktop/**`.

## Deviations / known gaps

- IRSC.P6.A (NI): the per-second thumbnail strip + `TimelinePreviewer` frame-stepper are not rendered in the chat surface (a completed clip plays with native controls in the bubble). `TimelinePreviewer.tsx` is retained and still unit-tested, so it can be reinstated inside the bubble if frame-accurate review is wanted.
- IRSC.P6.B (DF): `resolveMp4Url` still defaults to identity pending the Tauri fs allow-list (carried over from the previous page).
- IRSC.P6.C (WN): the same benign act() warnings as Phase 5.

## Next steps

- Phase 7: VS Code extension - "Nexus Code" activation fix + Claude Code-style UX (Issue 6).
