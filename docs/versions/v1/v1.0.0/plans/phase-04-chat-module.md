# Phase 4 - Local Chatbot Explorer module

**Goal**: Greenfield folder-organized chat module: nested folders, drag-drop chats, per-folder context isolation, chat-history-store reuse, memory-layer carryover.
**Prerequisites**: Phase 2 (shared core), Phase 3 (memory layers exposed via core).
**Stability Gate**: A user can create `Projects/Work/Q3-roadmap/`, drag two chats into it, switch between them, and the per-folder context isolation is verifiable in a TraceDashboard recording.

---

## Sub-tasks

### 4.1 - Folder + Chat data model

**Objective**: Define the persistence model for nested folders + chats; back it with SQLite via the existing ChatHistoryStore.

**Prompt**:
> In `modules/chat/storage/ChatExplorerStore.ts` define the data model: a `Folder` has `{id, parentId | null, name, createdAt, updatedAt, color?, icon?}`; a `Chat` has `{id, folderId, title, modelId, contextScopeId, createdAt, updatedAt, messageCount}`. Folders are nested via `parentId`. The store is backed by SQLite tables `chat_folders` and `chat_chats`, both with `FTS5` over name/title for the search bar in the dashboard's top bar. Reuse the existing `ChatHistoryStore` for the actual chat message persistence (`chat_messages` keyed on `chatId`). Add migrations under `core/memory/migrations/0001_chat_explorer.sql`. Methods: `createFolder({parentId, name})`, `renameFolder`, `moveFolder`, `deleteFolder` (cascades to chats), `createChat({folderId, title, modelId})`, `renameChat`, `moveChat`, `deleteChat`, `listTree()` returns the full nested tree, `search(query)` returns folders + chats. Acceptance: unit tests cover create / rename / move / delete with cascades; integration test against a real SQLite file covers the migration.

---

### 4.2 - Per-folder context isolation

**Objective**: Each folder has its own `MemoryHub` scope so a chat in `Work/` does not pollute the context retrieval of a chat in `Personal/`.

**Prompt**:
> Per-folder context isolation: every folder gets a `contextScopeId` (default = folder ID; root folder = `null`). When a chat is created inside a folder, its `Chat.contextScopeId` is set to the folder's scope. The `MemoryHub.retrieve(query, opts)` call from Phase 2.6 honors `opts.scopeId` - if set, only memory entries tagged with that scope (or ancestors) are returned. Memory entries written from a chat are tagged with the chat's `contextScopeId`. Ancestor scopes are visible (a chat in `Projects/Work/Q3-roadmap/` sees `Q3-roadmap`, `Work`, `Projects`, and root scopes); sibling scopes are NOT visible (a chat in `Projects/Work/` does not see entries from `Projects/Personal/`). The graph memory entity table also gains a `scope_id` column. Add a `MoveChat` action that re-tags all of the chat's memory entries to the new scope on move. Acceptance: an integration test creates two folders with chats, writes scope-tagged memory entries from each, asserts retrieval respects isolation + ancestry; move-chat moves the memory tags correctly.

---

### 4.3 - Sidebar folder tree UI

**Objective**: Render the folder tree in the Chat module's left rail with drag-drop, right-click context menu, inline rename, and breadcrumb.

**Prompt**:
> In `desktop/src/modules/chat/FolderTree.tsx` render the folder tree from `ChatExplorerStore.listTree()`. Use `@dnd-kit/core` for drag-drop (folder-into-folder and chat-into-folder). Right-click context menu: New Folder / New Chat / Rename / Move / Delete / Change Color. Inline rename on F2 or double-click. Keyboard navigation: arrow keys to traverse, Enter to open, Delete to delete (with confirm modal). Breadcrumb at the top of the chat pane shows the active folder path (`Projects > Work > Q3-roadmap`). Folder color is rendered as a colored 4px left border on the folder row. Persist expanded state in localStorage. Empty-state UI: a "Create your first folder" CTA when no folders exist. Acceptance: an interaction test (Vitest + Testing Library + dnd-kit testing utilities) covers create / rename / move (drag-drop) / delete with cascades; keyboard navigation tested.

---

### 4.4 - Chat pane UI (reuses Coding chat shell)

**Objective**: Reuse the chat-message-list + input components from the Coding module's `<CodingPage>` (extract to `desktop/src/shared/chat/`).

**Prompt**:
> Extract the shared chat UI from `desktop/src/modules/coding/CodingPage.tsx` into `desktop/src/shared/chat/`: `MessageList.tsx`, `MessageBubble.tsx`, `ChatInput.tsx`, `ModelSelector.tsx`. The Coding module re-uses these via composition. The Chat module's `ChatPage.tsx` imports the same components and adds the breadcrumb header from 4.3, but disables tool-call cards by default (Chat module does not run agentic tools - it is a conversational surface with optional code-block rendering and image attachments). Re-enable tool calls in Chat via a per-folder `enableTools` toggle (default off) so power users can have a tool-enabled chat in a specific folder. The Chat module honors the same model selector dropdown as Coding. Memory hub is wired with the folder's `contextScopeId`. Acceptance: switching between Chat and Coding modules reuses the same shared chat shell; the Chat module renders without tool-call UI by default.

---

### 4.5 - Search bar in dashboard top bar (functional this phase)

**Objective**: Wire the dashboard top-bar search field to query folders + chats + memory entries.

**Prompt**:
> In `desktop/src/components/TopBar.tsx`, wire the search field that was a placeholder in Phase 1. On input, debounce 200 ms then call `ChatExplorerStore.search(query)` + `MemoryHub.retrieve(query, {scopeId: null, limit: 10})`. Render results in a dropdown grouped by `Folders | Chats | Memories`. Click navigates: folder click expands + selects in the Chat module's tree; chat click opens the chat; memory click opens the originating chat with the memory-cited message scrolled into view. Keyboard shortcut `Ctrl+K` focuses search. Esc closes the dropdown. Acceptance: integration test searches across mock data, verifies dropdown grouping, click handlers, and keyboard shortcut.

---

### 4.6 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 4. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 4. Include: unit tests for `ChatExplorerStore` (CRUD + cascades + nested-tree builder + FTS5 search); integration test for per-folder context isolation (two folders, scope-tagged memory, retrieval respects scope + ancestry); UI tests for `<FolderTree>` (drag-drop, rename, delete-with-confirm, keyboard nav); UI tests for the search bar + dropdown; coverage gate at lines >= 80, functions >= 80 across `modules/chat/` and `desktop/src/modules/chat/`. Run the test suite, fix all failures, iterate until every test passes. After all tests pass, run `/generate-session-history` to document Phase 4.

---

### Phase 4 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Folder tree CRUD + drag-drop works
- [ ] Per-folder context isolation verified by trace recording
- [ ] Shared chat shell extracted and reused by Coding + Chat
- [ ] Search bar functional
- [ ] Coverage gate green
- [ ] Session history generated for Phase 4
- [ ] Ready to advance to Phase 5
