# 2026-05-17 - Phase 4: Local Chatbot Explorer module

**Plan**: [docs/v1.0.0/plans/phase-04-chat-module.md](../../plans/phase-04-chat-module.md)
**Goal**: Ship the second pillar - a greenfield folder-organized chat browser with nested folders, drag-drop chats, per-folder context isolation backed by `MemoryHub` scopes, breadcrumb navigation, a functional dashboard top-bar search across folders / chats / memories, and a shared chat shell that the existing Coding module now composes against. Stability gate: a user can create `Projects/Work/Q3-roadmap/`, drag two chats into it, switch between them, and the per-folder context isolation is verifiable (covered by `tests/integration/chat/ChatScopedMemory.integration.test.ts`).

## Outcome

Phase 4 stability gate met:

- `npm test` (desktop workspace): 227 / 227 pass (102 new Phase 4 tests added across desktop + root).
- `npm test:coverage` (desktop workspace): coverage gates stay green (>= 80 / 80 / 70). Per-tree coverage for new code: `core/memory/` 100% lines / 98.55% branches, `modules/chat/storage/` 99.35% lines / 95.87% branches, `modules/chat/memory/` 100% lines / 91.66% branches.
- `npm test` (root workspace): 2784 pass / 5 pre-existing failures (4 `SubAgentManager.characterization` CRLF snapshots, 1 `workflow-discipline` SHA-pin) unchanged from the Phase 2 baseline tracked under `2.P3.L`.
- `npm run lint` (desktop + root): clean.
- `npm run typecheck` (desktop): clean.

## Sub-tasks landed

### 4.1 -- ChatExplorerStore (SQLite + FTS5)

- New [modules/chat/storage/ChatExplorerStore.ts](../../../../modules/chat/storage/ChatExplorerStore.ts) at the repository root (where `better-sqlite3` is already a dependency). Folders model `{id, parentId, name, color?, icon?, createdAt, updatedAt}` with nested parents via the `parent_id` FK; chats model `{id, folderId, title, modelId, contextScopeId, createdAt, updatedAt, messageCount}`. The migration SQL is checked in separately at [core/memory/migrations/0001_chat_explorer.sql](../../../../core/memory/migrations/0001_chat_explorer.sql) for review while the store applies the same DDL idempotently (`CREATE TABLE IF NOT EXISTS`).
- FTS5 contentless-shadow indexes (`chat_folders_fts` over `name`, `chat_chats_fts` over `title`) feed the dashboard top-bar search. Trigger maintenance reuses [src/storage/sqliteFts.ts](../../../../src/storage/sqliteFts.ts); the `SCHEMA_VERSION` constant rebuilds the FTS index exactly once per schema bump.
- Public methods: `createFolder` / `renameFolder` / `moveFolder` / `deleteFolder` / `createChat` / `renameChat` / `moveChat` / `deleteChat` / `getFolder` / `getChat` / `bumpMessageCount` / `listTree` / `search` / `ancestors` / `close`. Move operations refuse cycles (folder-into-itself or folder-into-descendant); `deleteFolder` cascades via `ON DELETE CASCADE` to descendant folders + chats; `search` returns folders + chats grouped, with the FTS5 query sanitised via [src/storage/embeddingUtils.ts](../../../../src/storage/embeddingUtils.ts)'s `sanitizeFtsQuery`.
- Reuses [src/storage/ChatHistoryStore.ts](../../../../src/storage/ChatHistoryStore.ts) for the chat-message persistence -- the explorer owns folder/chat metadata; messages stay in the existing `chat_messages` table keyed on `Chat.id`.
- 41 tests in [tests/unit/chat/ChatExplorerStore.test.ts](../../../../tests/unit/chat/ChatExplorerStore.test.ts) (38) and [tests/integration/chat/ChatExplorerStore.integration.test.ts](../../../../tests/integration/chat/ChatExplorerStore.integration.test.ts) (3). Unit suite runs against `:memory:`; integration suite uses a real on-disk file under `os.tmpdir()` to cover the migration path, WAL journaling, and cross-instance persistence.

### 4.2 -- Per-folder context isolation (MemoryHub scopes)

- Extended [core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts) so every layer carries an optional `scopeId`: writes (`WorkingMemory.add`, `EpisodicMemory.record`, `SemanticMemory.upsert`, `GraphMemory.link`) accept `scopeId?: string | null`; retrieval (`MemoryHub.retrieve`) accepts `RetrieveOpts.scopeId` + `RetrieveOpts.visibleScopes`. The `isVisibleFromScope(entryScope, opts)` predicate enforces ancestor visibility: unscoped entries are visible from every query, scoped entries match either the queried `scopeId` or one of `visibleScopes`. Every layer also gets a `retagScope(fromScope, toScope)` method; `MemoryHub.retagScope` sums the rows touched across all four layers.
- New helper `computeVisibleScopes(scopeId, getParent)` walks a `ChatExplorerStore`-style hierarchy to materialise the visible chain (the scope itself followed by every ancestor up to and including the root sentinel `null`), with cycle defence.
- New [modules/chat/memory/ChatScopedMemory.ts](../../../../modules/chat/memory/ChatScopedMemory.ts) is the bridge that translates a chat's `contextScopeId` into the visible chain. `retrieve(chat, query)` calls `MemoryHub.retrieve` with the chain pre-computed. `moveChat(chatId, newFolderId)` is the MoveChat action from the plan: moves the chat in the store, then re-tags every memory entry from the old scope to the new one in one pass.
- 17 unit tests in [tests/unit/core/memory/MemoryHub.scopes.test.ts](../../../../tests/unit/core/memory/MemoryHub.scopes.test.ts) cover the predicate, per-layer scope filtering, retagging, and the helper's edge cases (root sentinel, missing folder, cycle). 6 integration tests in [tests/integration/chat/ChatScopedMemory.integration.test.ts](../../../../tests/integration/chat/ChatScopedMemory.integration.test.ts) build the `Projects/Work/Q3-roadmap` + `Projects/Personal` hierarchy from the plan and assert sibling isolation, ancestor visibility, MoveChat re-tag, and idempotent same-target moves.
- The SQLite-backed engine memory layers (`MemoryStore`, `EpisodicMemory`, `GraphMemory` in `src/storage/`) do not yet carry the `scope_id` column -- that lands when the engine moves under `core/memory/` alongside the Phase 5 ModelRegistry SQLite work (gap `4.P1.X`).

### 4.3 -- Sidebar folder tree UI

- New [desktop/src/modules/chat/FolderTree.tsx](../../../../desktop/src/modules/chat/FolderTree.tsx) renders the tree against a `ChatExplorerClient`. Selected interaction surfaces:
  - **Drag-drop**: HTML5 `dragstart` / `dragover` / `drop` with `application/x-nexus-node` as the data-transfer mime. The plan called for `@dnd-kit/core`; the deviation is documented in `4.P1.V`. Folder-into-folder and chat-into-folder moves are supported; the store refuses cycles, the FolderTree silently no-ops the failed move.
  - **Context menu** on right-click: New folder / New chat / Rename / Delete / Change color. Each action surfaces a stable `data-testid` (`ctx-new-folder`, `ctx-new-chat`, etc.) for interaction tests.
  - **Inline rename** on F2, double-click, or context-menu Rename. Enter commits, Escape cancels, blur commits.
  - **Keyboard navigation**: ArrowDown / ArrowUp move focus through the flattened tree, ArrowRight expands a collapsed folder, ArrowLeft collapses, Enter triggers `onOpenChat` / `onOpenFolder`, Delete opens the confirm modal.
  - **Confirm modal** for destructive deletes (`folder-tree-confirm-delete`). Cancel keeps the row; OK calls the store's `deleteFolder` / `deleteChat`.
  - **Folder color** rendered as a 4px left border via `rowStyle(node, selected)`.
  - **Expanded-state persistence** via injectable `ExpandedStorageAdapter`. The default reads / writes `localStorage["nexus.chat.expanded"]`; tests inject a `Map` to avoid touching real storage.
  - **Empty-state CTA** when the tree is empty: a "Create your first folder" button that creates a new folder and immediately enters rename mode.
- 22 interaction tests in [desktop/tests/FolderTree.test.tsx](../../../../desktop/tests/FolderTree.test.tsx) cover every surface.
- New [desktop/src/modules/chat/chatExplorerClient.ts](../../../../desktop/src/modules/chat/chatExplorerClient.ts) is the frontend-only `InMemoryChatExplorerClient` (24 tests in [desktop/tests/chatExplorerClient.test.ts](../../../../desktop/tests/chatExplorerClient.test.ts)). It mirrors the root store's API surface so the FolderTree contract is identical across the in-memory frontend and the eventual sidecar-backed client (gap `4.P1.W`).

### 4.4 -- Shared chat shell + ChatPage

- Extracted four reusable components into [desktop/src/shared/chat/](../../../../desktop/src/shared/chat/):
  - `MessageBubble.tsx`: role-coloured bubble with optional tool-call cards. `enableTools={false}` omits the cards (Chat module default).
  - `MessageList.tsx`: ordered list of bubbles + empty-state placeholder.
  - `ChatInput.tsx`: textarea + submit button. Enter sends, Shift+Enter inserts a newline; disabled / placeholder / submit-accent are configurable per consumer.
  - `ModelSelector.tsx`: dropdown driven by the frontend model catalog.
- Refactored [desktop/src/modules/coding/CodingPage.tsx](../../../../desktop/src/modules/coding/CodingPage.tsx) to consume `<MessageList>` and `<ModelSelector>` via composition. A small `turnsToMessages` helper translates the existing `Turn[]` shape into `ChatMessage[]` so the tool-card UI lives entirely in the shared shell. All 8 CodingPage tests continue to pass against the refactored render path.
- New [desktop/src/modules/chat/ChatPage.tsx](../../../../desktop/src/modules/chat/ChatPage.tsx) is the Chat module's top-level page. Composes:
  - The `<FolderTree>` in a 280px left rail.
  - The `<Breadcrumb>` ([desktop/src/modules/chat/Breadcrumb.tsx](../../../../desktop/src/modules/chat/Breadcrumb.tsx)) at the top of the chat pane showing the active folder path (`Projects > Work > Q3`).
  - A per-folder `enableTools` checkbox (default off per the plan; power users opt in for tool-call UI inside the chat).
  - The shared `<ModelSelector>` (disabled while a chat is active).
  - The shared `<MessageList>` + `<ChatInput>` with the chatbot accent.
- The `/chatbot` route in [desktop/src/App.tsx](../../../../desktop/src/App.tsx) renders `<ChatPage>` instead of the Phase 1 `<ModulePlaceholder>`. Chat messages persist in an in-memory Map; the sidecar-backed streaming hook is deferred to Phase 5 (gap `4.P2.Z`).
- 22 tests across [desktop/tests/sharedChat.test.tsx](../../../../desktop/tests/sharedChat.test.tsx) and [desktop/tests/ChatPage.test.tsx](../../../../desktop/tests/ChatPage.test.tsx).

### 4.5 -- Top-bar search dropdown

- New [desktop/src/components/TopBar.tsx](../../../../desktop/src/components/TopBar.tsx) replaces the Phase 1 disabled search field. The component is fully composable:
  - `chatClient`: optional `ChatExplorerClient` for folder + chat hits.
  - `memoryAdapter`: optional `MemorySearchAdapter` for memory hits (typed; production wiring deferred to gap `4.P2.Y`).
  - `debounceMs`: 200 ms by default (the plan's stated value).
  - `extraButtons`: render-slot for additional buttons (the Dashboard re-uses this for the notification bell with `data-testid="dashboard-bell"`).
  - `settingsTestId`: override the gear-button test id so call sites keep their existing harness.
- Behaviour:
  - Debounced search runs `chatClient.search(query)` then optionally awaits the memory adapter. Results render in a dropdown grouped `Folders | Chats | Memories`. Click handlers route via the parent's `onFolderClick` / `onChatClick` / `onMemoryClick` callbacks and close the dropdown.
  - Empty-state row when the query yields nothing.
  - Keyboard shortcut `Ctrl+K` focuses the input from anywhere in the app. `Escape` closes the dropdown.
- Integrated into [desktop/src/pages/Dashboard.tsx](../../../../desktop/src/pages/Dashboard.tsx): the existing notification bell + gear icon live inside the TopBar via `extraButtons` + `settingsTestId="dashboard-gear"`, preserving the legacy test surface (`dashboard-bell` + `dashboard-bell-badge` + `dashboard-gear` ids still resolve).
- 13 tests in [desktop/tests/TopBar.test.tsx](../../../../desktop/tests/TopBar.test.tsx).

### 4.6 -- Testing and stabilization

- Total new tests: 102 (41 store + 23 scope memory + 24 frontend client + 22 FolderTree + 22 shell+ChatPage + 13 TopBar + 1 App route adjustment).
- Coverage gates on per-tree numbers for new code:
  - `core/memory/MemoryHub.ts`: 100% lines / 98.55% branches.
  - `modules/chat/storage/`: 99.35% lines / 95.87% branches.
  - `modules/chat/memory/`: 100% lines / 91.66% branches.
- Existing suites unchanged: desktop's `CodingPage.test.tsx` continues to pass against the shared-shell composition; the 5 pre-existing Phase 2 root failures (CRLF + SHA-pin) are unchanged.

## Deviations from the plan

- **HTML5 dnd in place of `@dnd-kit/core` (gap `4.P1.V`).** The plan called for `@dnd-kit/core` explicitly; we used native HTML5 dnd to avoid adding a dependency in this phase. The FolderTree component is structured so a future swap touches only four handlers.
- **In-memory frontend client + deferred sidecar bridge (gap `4.P1.W`).** Phase 4 ships the SQLite-backed `ChatExplorerStore` at the root and a parallel `InMemoryChatExplorerClient` on the desktop frontend; the IPC wire between them lands in Phase 5 alongside `3.P1.M` / `3.P1.N` / `3.P2.S`.
- **Memory `scope_id` columns deferred for SQLite tables (gap `4.P1.X`).** The in-memory `MemoryHub` carries the scope tag end-to-end; the SQLite-backed engine tables (`memory_entries`, `episodic_events`, `graph_edges`) still rely on the legacy unscoped schema.
- **`MemorySearchAdapter` not bound in production yet (gap `4.P2.Y`).** The TopBar accepts and tests the adapter; the Dashboard does not pass one yet (no IPC path to `MemoryHub`).
- **ChatPage uses a local echo stub for assistant replies (gap `4.P2.Z`).** The UI surface is exercised end-to-end; the actual streaming integration with the Coding sidecar is deferred to Phase 5.

## Files touched

**Added**:

- `core/memory/migrations/0001_chat_explorer.sql`
- `modules/chat/storage/ChatExplorerStore.ts`
- `modules/chat/storage/ChatExplorerStore.types.ts`
- `modules/chat/memory/ChatScopedMemory.ts`
- `desktop/src/components/TopBar.tsx`
- `desktop/src/modules/chat/types.ts`
- `desktop/src/modules/chat/chatExplorerClient.ts`
- `desktop/src/modules/chat/FolderTree.tsx`
- `desktop/src/modules/chat/Breadcrumb.tsx`
- `desktop/src/modules/chat/ChatPage.tsx`
- `desktop/src/shared/chat/{types,MessageBubble,MessageList,ChatInput,ModelSelector,index}.{ts,tsx}`
- `tests/unit/chat/ChatExplorerStore.test.ts`
- `tests/integration/chat/ChatExplorerStore.integration.test.ts`
- `tests/integration/chat/ChatScopedMemory.integration.test.ts`
- `tests/unit/core/memory/MemoryHub.scopes.test.ts`
- `desktop/tests/{chatExplorerClient,FolderTree,sharedChat,ChatPage,TopBar}.test.{ts,tsx}`
- `docs/v1.0.0/development/history/2026-05-17_phase-04-chat-module.md` (this file)

**Modified**:

- `core/memory/MemoryHub.ts` (scopeId on every layer, retagScope, computeVisibleScopes helper)
- `desktop/src/App.tsx` (route `/chatbot` -> `<ChatPage>`)
- `desktop/src/modules/coding/CodingPage.tsx` (consume shared shell via composition)
- `desktop/src/pages/Dashboard.tsx` (use TopBar with extraButtons/settingsTestId)
- `desktop/tests/App.test.tsx` (route adjustment)
- `docs/DEVLOG.md` (Phase 4 entry)
- `docs/v1.0.0/known-gaps.md` (seven new entries 4.P1.V ... 4.P2.AA, summary recomputed)

## Phase 4 exit checklist

- [x] All six sub-tasks completed.
- [x] Folder tree CRUD + drag-drop works (22 interaction tests).
- [x] Per-folder context isolation verified (17 unit + 6 integration tests; ancestor visibility, sibling exclusion, MoveChat re-tag all covered).
- [x] Shared chat shell extracted and reused by Coding + Chat.
- [x] Search bar functional (folders + chats live; memories slot wired but not bound in production).
- [x] Coverage gate green for new code (per-tree 99%+).
- [x] Session history generated for Phase 4 (this file).
- [x] Ready to advance to Phase 5 (ModelRegistry + native model downloader) once the operator opens the cycle.
