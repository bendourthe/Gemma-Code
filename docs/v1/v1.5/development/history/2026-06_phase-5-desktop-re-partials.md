# Session history: v1.5.0 Phase 5 -- Model-layer & Desktop Re-partials

**Date**: 2026-06-14
**Cycle**: v1.5.0 (Local Agent Maturity)
**Phase**: 5 (Model-layer & desktop re-partials -- Bucket 4 `re-partial`: items 33, 24, 25, 26; item 38 demand-gated)
**Plan reference**: [docs/versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md](../../plans/adoption-ecosystem-2026-06.md)
**Source comparison**: [docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md](../../comparison-ecosystem-2026-06.md)
**Branch (Nexus-AI)**: `feat/v1.5.0-phase-3-inbound-security` (continued; v1.5.0 not yet merged to `main`)
**Acceptance scope**: ship the Bucket 4 re-partials -- multimodal input via Gemma 4 (item 33), the side-by-side preview pane (item 24), the provider/credential management UI (item 25, credential half vault-only), and cross-surface session resume (item 26); decide item 38 (local cron) on the demand gate. Stability gate: `npm run test`, `npm run test:shell`, `npm run lint`, `npm run lint:shell` clean; the credential UI writes credentials only through the Phase 1 vault.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T015 (item 33) | Multimodal image input. Optional `images?: readonly string[]` added to `LLMMessage` ([modules/coding/llm/types.ts](../../../../modules/coding/llm/types.ts), maps to Ollama `/api/chat` `images`) and `Message` ([modules/coding/chat/types.ts](../../../../modules/coding/chat/types.ts)). New pure `isVisionCapableModel` ([modules/coding/config/ModelCapabilities.ts](../../../../modules/coding/config/ModelCapabilities.ts)) + shared `toLlmMessages` mapper ([modules/coding/chat/llmMessages.ts](../../../../modules/coding/chat/llmMessages.ts)) gate image forwarding at BOTH assembly sites (`StreamingPipeline._attemptStream`, `AgentLoop._streamOneTurn`): a vision-capable model receives `images`, a text-only model gets a clean text-only request. `ConversationManager.addUserMessage`/`StreamingPipeline.send` accept images. Catalog `multimodal` flag surfaced on `ListedModel` ([core/registry/NexusModelRegistry.ts](../../../../core/registry/NexusModelRegistry.ts)). | Closed |
| T016 (item 24) | Side-by-side preview pane. New [desktop/src/components/PreviewPane.tsx](../../../../desktop/src/components/PreviewPane.tsx) renders an HTML artifact through the existing `InteractiveArtifact` (sanitised; no live iframe) or text/file content through a `<pre>`, with a header (title + optional source URL + close). Wired beside the chat in [desktop/src/modules/chat/ChatPage.tsx](../../../../desktop/src/modules/chat/ChatPage.tsx) via a horizontal flex; opened by an additive `onSelectMessage` threaded through the shared `MessageList`/`MessageBubble` (selectable bubble, keyboard-accessible). UI only; no new outbound dep. | Closed |
| T017 (item 25) | Credential management UI (vault-only). New `credentials.status/list/set/delete` IPC methods + zod schemas ([desktop/sidecar/src/protocol.ts](../../../../desktop/sidecar/src/protocol.ts)) and handlers ([desktop/sidecar/src/handlers.ts](../../../../desktop/sidecar/src/handlers.ts)) over the Phase 1 `CredentialVault` (added to `HandlerContext`, default `createCredentialVault()`). New [desktop/src/pages/settings/CredentialsSettings.tsx](../../../../desktop/src/pages/settings/CredentialsSettings.tsx) (injectable client, ipc-backed + mock) added as a third Settings tab. Secrets route to the OS keychain ONLY; values are write-only in the UI (only key names listed); a clear disabled state when the keychain is unavailable. | Closed |
| T018 (item 26) | Cross-surface session resume. New persistent [desktop/sidecar/src/coding/sessionStore.ts](../../../../desktop/sidecar/src/coding/sessionStore.ts) (`JsonFileSessionStore` at `<nexusHome>/sessions.json`, atomic temp+rename, corruption-tolerant) injected into `CodingSessionManager` ([desktop/sidecar/src/coding/sessionManager.ts](../../../../desktop/sidecar/src/coding/sessionManager.ts)): the manager hydrates from the store on construction and persists on `start`/`sendMessage`. `coding.session.resume` extended with the full `messages` history so a resuming surface restores intact state. | Closed |
| T019 (item 38) | Local cron scheduler -- DEFERRED on the demand gate (no concrete recurring-task need confirmed this cycle). Recorded as `T019.P3.A` in known-gaps; nothing built. | Deferred |
| T020 | Tests + stabilization. +37 tests (root +14, desktop +23). Root suite 4035 passed / 5 skipped / 0 failed; desktop suite 445 passed / 0 failed; `tsc -b`, desktop `tsc --noEmit`, `lint`, `lint:shell`, `check-architecture` (0 errors), `security:check`, `check:prompts` (0 errors), `check:tampering` all clean. No outbound call introduced. | Closed |

## 2. Design decisions & deviations from the plan text

| # | Decision / deviation | Resolution |
|---|---|---|
| D1 | The plan title says "image/audio input", but Ollama's `/api/chat` accepts a per-message `images` array and no audio field. | Implemented IMAGE input end-to-end (the wire-supported path) and gated it on vision capability. Audio input has no local-serving wire path today; recorded as `future` in `T015.P3.A` rather than shipped half-working. The acceptance test ("an image is passed to a vision-capable model; a text-only model ignores it cleanly") is image-specific and is met. |
| D2 | How does the hot model-call path (which only holds the runtime model tag string) know a model is vision-capable? | A pure name-matcher (`isVisionCapableModel`, `gemma[-_]?4`) mirrors the authoritative catalog `multimodal: true` flag, with a guard unit test asserting the matcher agrees with every catalog entry flagged multimodal -- so the two sources cannot drift. The catalog flag is also surfaced on `ListedModel` for registry consumers. |
| D3 | `CredentialVault` is core-only with no IPC seam; the desktop reaches the backend only through the sidecar. | Added a thin `credentials.*` IPC surface that routes to `ctx.credentials` (the vault) ONLY -- no filesystem/config path -- so a credential set via the UI lands in the keychain, never a plaintext file. The OS-keychain write guarantee itself is covered by the Phase 1 vault suite; this phase tests the routing + UI. |
| D4 | Scope of the "provider/model/tool/credential" UI. | Models are already managed by `ModelsSettings` (v1.0.0). The new, vault-backed capability is credential management, which is the item-25 CRITICAL constraint; built that as the new tab. Provider/tool management beyond models + credentials, and auto-populating integrations from the (still-unimplemented) `mcp.list`, are recorded as `T017.P3.A` (future) rather than stubbed. |
| D5 | "CLI path" for cross-surface resume -- the sidecar is currently Tauri-spawned and no live CLI client connects yet. | Implemented the root-cause persistence layer (a shared `SessionStore`) and proved the cross-surface contract with two `CodingSessionManager` instances over the same store file (CLI-start -> desktop-resume parity, intact history). The live two-process daemon handshake + active-session auto-resume is recorded as `T018.P3.C` (candidate). |
| D6 | Touching shared `MessageList`/`MessageBubble` for the preview affordance. | Added an OPTIONAL `onSelect`/`onSelectMessage` prop; when absent (e.g. the Coding pillar) the bubble renders exactly as before. Backward compatible; no behavior change for non-preview hosts. |

## 3. Open items added to known-gaps

Four forward-tier follow-ups recorded in [docs/versions/v1/v1.5.0/known-gaps.md](../../known-gaps.md) (not defects), and one partial closure:

- `T019.P3.A` (P3/DF, `future`) -- local cron scheduler deferred (no confirmed demand; autonomy-surface caution).
- `T015.P3.A` (P3/DF) -- image wiring + vision gate `supported`; live vision-model behavior `candidate` (opt-in `OLLAMA_URL` smoke test); audio input `future` (no Ollama chat wire path); image attachments are in-memory only (not persisted to `ChatHistoryStore`).
- `T017.P3.A` (P3/DF) -- vault-only credential routing `supported`; MCP integration auto-discovery + provider/tool surfaces `future`.
- `T018.P3.C` (P3/DF) -- persistent store + resume-with-history contract `supported`; live two-process CLI<->desktop handshake + auto-resume `candidate`. (ID distinct from the v1.4.0 carryforward `T018.P3.A/B`.)
- `T001.P3.A` partially closed: the T001 `multimodal` flag now has a production consumer (the item-33 vision gate); the `selectGemma4GgufQuant` VRAM-picker-in-UI half remains open.

## 4. Verification evidence

- New suites (root): `npx vitest run` ModelCapabilities (5) + llmMessages (4) + StreamingPipeline.multimodal (4) + NexusModelRegistry multimodal assertion (1).
- New suites (desktop): PreviewPane (6) + ChatPage.preview (3) + CredentialsSettings (4) + credentials-handlers (5) + coding-session-resume (5).
- `npm run test` (root) -> **4035 passed / 5 skipped / 0 failed**.
- `npm run test:shell` (desktop) -> **445 passed / 0 failed**.
- `npx tsc -b` (root) + `tsc --noEmit` (desktop) -> **exit 0**.
- `npm run lint` (`eslint src modules`) + `npm run lint:shell` (`eslint src sidecar/src tests --max-warnings=0`) -> **0**.
- `npm run check-architecture` -> **0 errors** (10 pre-existing orphan/circular warnings, none involving the new files; the sidecar->core imports are sidecar-local and not cruised by `src core modules`).
- `npm run security:check` -> **"All safety surfaces in sync"** (the credential IPC routes to the existing vault; no new tool-permission surface).
- `npm run check:prompts` -> **0 errors** (1 pre-existing oversized-prompt warning, unrelated). `npm run check:tampering` -> **0 findings**.
- No outbound call introduced: image input reuses the local model call; credentials use the local OS keychain; the session store is a local JSON file.

## 5. Next phase

Phase 6 -- carryforward closure: bundle the Tree-sitter grammar `.wasm` into the packaged app (closes v1.4.0 `T022.P3.A`), with a packaged-app readiness test.
