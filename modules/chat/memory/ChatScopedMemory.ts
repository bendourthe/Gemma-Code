/**
 * v1.0.0 Phase 4.2 -- bridge between `ChatExplorerStore` (folder hierarchy)
 * and `MemoryHub` (scope-tagged retrieval).
 *
 * Encapsulates the ancestor-chain resolution so chat callers can write
 * `chatScopedMemory.retrieve(chatId, query)` instead of computing the chain
 * by hand. Also implements the MoveChat action's memory re-tag described in
 * the Phase 4.2 acceptance criteria.
 */

import type {
  Chat,
  Folder,
} from "../storage/ChatExplorerStore.types.js";
import type { ChatExplorerStore } from "../storage/ChatExplorerStore.js";
import {
  computeVisibleScopes,
  type MemoryHit,
  type MemoryHub,
  type RetrieveOpts,
  type ScopeId,
} from "../../../core/memory/MemoryHub.js";

export interface ChatScopedRetrieveOpts extends Omit<RetrieveOpts, "scopeId" | "visibleScopes"> {
  /**
   * Override the scope chain that is used. Useful in tests; production
   * callers should let the adapter resolve from `chat.contextScopeId`.
   */
  overrideVisibleScopes?: readonly ScopeId[];
}

export class ChatScopedMemory {
  constructor(
    private readonly store: ChatExplorerStore,
    private readonly hub: MemoryHub,
  ) {}

  /** Resolve the visible scope chain for a given chat. */
  visibleScopesFor(chat: Chat): readonly ScopeId[] {
    return computeVisibleScopes(chat.contextScopeId, (id) =>
      this.lookupParent(id),
    );
  }

  /**
   * Run a memory retrieval scoped to `chat`. Ancestor scopes (the folder
   * tree above the chat) are visible; sibling scopes are not.
   */
  async retrieve(
    chat: Chat,
    query: string,
    opts: ChatScopedRetrieveOpts = {},
  ): Promise<readonly MemoryHit[]> {
    const visibleScopes = opts.overrideVisibleScopes ?? this.visibleScopesFor(chat);
    return this.hub.retrieve(query, {
      limit: opts.limit,
      layers: opts.layers,
      scopeId: chat.contextScopeId,
      visibleScopes,
    });
  }

  /**
   * Move a chat into a new folder, retag every memory entry written under
   * the old scope to the new scope, and update the store accordingly. Returns
   * the number of memory rows touched.
   */
  async moveChat(chatId: string, newFolderId: string | null): Promise<{
    chat: Chat;
    rowsRetagged: number;
  }> {
    const before = this.store.getChat(chatId);
    if (!before) throw new Error(`chat not found: ${chatId}`);
    const fromScope = before.contextScopeId;
    const toScope = newFolderId;
    const chat = this.store.moveChat(chatId, newFolderId, { retagScope: true });
    let rowsRetagged = 0;
    if (fromScope !== toScope) {
      rowsRetagged = await this.hub.retagScope(fromScope, toScope);
    }
    return { chat, rowsRetagged };
  }

  private lookupParent(id: string): ScopeId | undefined {
    const folder: Folder | null = this.store.getFolder(id);
    if (folder === null) return undefined;
    return folder.parentId;
  }
}
