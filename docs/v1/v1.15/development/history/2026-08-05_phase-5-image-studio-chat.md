# Session History - v1.15.0 Phase 5: Image Studio chat redesign

**Date**: 2026-08-05
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 5 of 8 - "Image Studio Chat Redesign (Issue 5, image)"
**Outcome**: Complete. Quality gate GO (desktop suite 76 files / 580 pass, 0 fail; eslint + tsc clean; coverage 92.28% lines / 84.55% branch, above the 80/70 gate).

## Goal

Fix Issue 5 for images: replace the parameter-heavy four-tab Image Studio (Text->Image / Image->Image / Inpaint / Outpaint, plus a full parameter sidebar) with an intuitive chat interface for non-technical users - a model selector, chat history, and a composer where the user pastes / drags / uploads image(s) (or none) and types a request. Intent (which of the four modes) is inferred from the attachments + prompt, not a tab.

## What was done

### Shared media-chat scaffold (reused by Phase 6)
- `shared/chat/types.ts`: `ChatMessage` gained optional `attachments`, `media` (`ChatMedia`), `pending`, `progress` - all optional, so the text-only Chat / Coding paths are unchanged.
- `shared/chat/MessageBubble.tsx`: renders attachment thumbnails, a generated image/video, and a pending/progress indicator when those fields are present (guarded).
- `shared/chat/MediaComposer.tsx` (new): attachment-capable composer - a "+" button (multi-file), drag-and-drop, clipboard paste, removable thumbnail chips, Enter-to-send. Emits `(text, attachments[])` as base64 data URLs; send is enabled with text OR >=1 attachment.

### Intent inference
- `modules/image/intent.ts`: `inferImageIntent({text, attachments, mask})` -> txt2img (no image) / inpaint (image + mask) / outpaint (image + "extend/expand" language, with a parsed direction) / img2img (image otherwise). Supplies a mode-specific default prompt for an image-only request (the protocol requires a non-empty prompt).

### Image Studio rebuilt as chat
- `modules/image/ImageStudioPage.tsx`: model selector (installed image models via the Phase 4 `installedModelsForType` feed + a "Get more models" entry that navigates to `SETTINGS_MODELS_PATH`), a message history with inline generated images, and the `MediaComposer`. Send -> intent -> the matching `diffusionClient` call -> reuse the `drainEvents` polling -> the assistant message's `media` fills in on complete. All parameters live behind a collapsed "Advanced settings" panel (reusing `ImagePromptForm` with per-tier defaults). Per-message Download / Copy Workflow / Use as Source. The four mode tabs are gone.
- `App.tsx`: passes `onGetMoreModels` (navigates to the Settings Models tab) to the page.

## Test results

- Full desktop suite: 76 files / 580 tests, 0 failures (+14 across `imageIntent`, `MediaComposer`, `mediaMessageBubble`, and the rewritten `ImageStudioPage` test). eslint + tsc clean. Coverage 92.28% lines / 84.55% branch (`intent.ts` 100%). The ImageStudioPage tests log benign React `act()` warnings from the async model-load effect (IRSC.P5.B).

## CI/CD

- No change: `shell-build.yml` already covers `desktop/**` (this phase is entirely desktop frontend + shared chat).

## Deviations / known gaps

- IRSC.P5.A (NI): inline inpaint mask-painting is not wired into the composer yet; txt2img / img2img / outpaint are fully reachable from chat, inpaint needs the mask affordance (MaskEditor + client already support it).
- IRSC.P5.B (WN): benign act() warnings in the page tests.
- IRSC.P5.C (DF): the selector falls back to the SANA default when no image model is installed (so generation still works) rather than hard-blocking.

## Next steps

- Phase 6: Video Lab chat redesign (Issue 5, video) - reuses this phase's `MediaComposer`, `ChatMedia` bubble, and the intent pattern for text2video / image2video.
