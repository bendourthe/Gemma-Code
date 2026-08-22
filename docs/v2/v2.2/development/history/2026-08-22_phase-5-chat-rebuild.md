# Session History - Phase 5: Local Chatbot Rebuild

**Date**: 2026-08-22
**Plan**: [v2.2.0-runtime-repair-and-ux-overhaul.md](../../plans/v2.2.0-runtime-repair-and-ux-overhaul.md) - Phase 5 of 8
**Outcome**: 5.1, 5.3, and 5.4 delivered; 5.2 (the chat-first rail) NOT delivered and carried as DF-12. All gates green.

## Context

The user's report on this surface was the most detailed of the whole session: the chatbot "doesn't look like a chatbot", it "only starts a chat when we create a folder", the buttons are "poor design choices", and the `+` button "is poorly designed... the text input box should be the only box". Underneath the appearance problem, nothing persisted: every message lived in a React `Map`.

## What was delivered

### 5.1 Persistence (closes 3.P1.N)

- `chat_chat_messages` table, plus `persona` and `user_renamed` columns on `chat_chats`.
- The migration is additive and idempotent: SQLite has no `ADD COLUMN IF NOT EXISTS`, so the store probes `PRAGMA table_info` and adds only what is missing. Re-opening an already-migrated database does nothing.
- `appendMessage` writes the row AND bumps the chat's counter in one transaction. Splitting them would let the rail's message count disagree with the conversation.
- 13 `chat.explorer.*` IPC methods, an `IpcChatExplorerClient`, and `ChatPage` using it inside Tauri with the in-memory client retained for tests and the dev server.
- Discovered while working: the store already supported root-level chats (`folder_id` nullable) and nested folders. A "project" is therefore just a top-level folder, and no new table was needed. The hierarchy the plan asked for existed; only the UI required a folder.

### 5.3 Auto-titling

- `chat.generateTitle` asks the already-resident model for a short title, with `fallbackTitle` (first six words) used immediately and on every failure: no model, timeout, empty answer, or an answer that sanitizes to nothing.
- It never triggers a model switch. Titling is a convenience; evicting the model a user is mid-conversation with to produce a label would be indefensible.
- `sanitizeTitle` strips what small models habitually add: surrounding quotes, a `Title:` prefix, trailing punctuation, markdown bold, extra lines.
- `renameChat` split into a machine path and a `byUser` path, so a generated title can never overwrite one the user chose (`user_renamed`).

### 5.4 Composer

- One rounded surface: `+` inside-left, mic/chevron/send inside-right, all absolutely positioned, with textarea padding reserved to match so text can never render underneath them. Grows to about six lines, then scrolls internally.
- The five-button voice row and the always-on Persona textarea are gone. Voice loop, push-to-talk, and VAD moved into the mic dropdown, driving the SAME `voiceLoop` state machine; the persona became a persisted per-chat setting behind a header gear.
- The mic-open indicator was deliberately kept. Knowing whether the microphone is live is feedback, not chrome.

## What was NOT delivered

**5.2, the chat-first rail.** `FolderTree` still shows "Create your first folder", and the page still wants a selected chat before the composer is useful. The user's most concrete complaint about this module is therefore still visible. The storage it needs is wired and tested; the remaining work is UI. Carried as DF-12, with DF-13 (call titling on first send) and DF-14 (share the composer with `CodingInput`).

## Problems hit

1. **Two import-graph traps.** Importing `HandlerContext` into the title generator, and importing the store statically into `handlers.ts`, each pulled a vscode-coupled logger (via `src/storage/dbPermissions`) into every consumer, breaking ~30 handler test files at collection. The store import is now dynamic, which additionally keeps `better-sqlite3` out of the graph until a chat op actually runs.
2. **A truncation off-by-error**, caught by its own test: slicing a title to the 60-character cap and then appending a 3-character ellipsis produced 62.
3. **Test relocation.** `ChatExplorerStore` cannot load in the desktop (browser-ish) test environment for the same vscode reason, so its tests live in the root suite.

## Gates

| Gate | Result |
|---|---|
| Root vitest | 5410 passed / 12 skipped / 0 failed |
| Desktop vitest | 1201 passed / 0 failed (145 files) |
| Desktop coverage | 88.72% lines / 82.61% branches (gate: 80%) |
| tsc -b / eslint | clean |
| Installer pytest | not re-run: no installer file touched |

New tests: 14 store cases (messages, persona, rename pin, migration idempotence), 20 IPC-ops and titling cases, 10 composer-surface and mic-menu cases. Four existing tests were updated to the new contracts (persona popover, mic-menu voice control, handler registry).

## Next steps

Phase 6 - Shell UI Modernization. DF-12 is the highest-value follow-up in this area and is squarely UI work now that the storage beneath it is real.
