/**
 * v1.0.0 Phase 4 -- frontend type surface for the Local Chatbot Explorer.
 *
 * v2.2.3 Phase 1 (1.1): the duplicate declarations are gone. This module now
 * re-exports the storage layer's types (`modules/chat/storage/
 * ChatExplorerStore.types.ts`) so the sync in-memory client, the IPC adapter,
 * and every UI component share ONE type family instead of two look-alike
 * families bridged by `as unknown as` casts. The re-export is type-only, so
 * `better-sqlite3` still never enters the Vite bundle.
 */

export type {
  Folder,
  Chat,
  ChatMessageRecord,
  FolderTreeNode,
  ChatExplorerSearchHit,
  CreateFolderInput,
  CreateChatInput,
} from "../../../../modules/chat/storage/ChatExplorerStore.types";
