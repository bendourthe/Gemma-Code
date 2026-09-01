/**
 * v2.2.6 Phase 1 -- adapt a StudioExplorerClient to ChatExplorerClient so
 * FolderTree can render Image/Video sessions without those pages importing
 * Chat types.
 *
 * Methods stay synchronous when the inner client is synchronous, so FolderTree
 * (resolveMaybe) can paint the first tree in the same turn. IPC clients still
 * return Promises.
 */

import type { AsyncChatExplorerClient } from "../../modules/chat/chatExplorerClient";
import type {
  Chat,
  ChatExplorerSearchHit,
  ChatMessageRecord,
  Folder,
  FolderTreeNode,
} from "../../modules/chat/types";
import type { StudioExplorerClient } from "./studioExplorerClient";
import type { StudioFolder, StudioSession, StudioTreeNode } from "../../../../core/generations/StudioSessionStore.types";

function folderToChatFolder(folder: StudioFolder): Folder {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    color: folder.color ?? null,
    icon: folder.icon ?? null,
  };
}

export function studioClientAsChatExplorer(client: StudioExplorerClient): AsyncChatExplorerClient {
  const userRenamed = new Map<string, boolean>();
  const sessionToChat = (session: StudioSession): Chat => ({
    id: session.id,
    folderId: session.folderId,
    title: session.title,
    modelId: session.modelId,
    contextScopeId: session.folderId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.turnCount,
    persona: null,
    userRenamed: userRenamed.get(session.id) === true,
  });

  function mapTree(node: StudioTreeNode): FolderTreeNode {
    return {
      folder: node.folder ? folderToChatFolder(node.folder) : null,
      children: node.children.map(mapTree),
      chats: node.sessions.map(sessionToChat),
    };
  }

  function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
  }

  function wrap<T, U>(value: T | Promise<T>, map: (inner: T) => U): U | Promise<U> {
    if (isThenable(value)) return value.then(map);
    return map(value);
  }

  return {
    listTree() {
      return wrap(client.listTree(), mapTree);
    },
    createFolder(input) {
      return wrap(client.createFolder(input), folderToChatFolder);
    },
    renameFolder(id, name) {
      return wrap(client.renameFolder(id, name), folderToChatFolder);
    },
    moveFolder(id, newParentId) {
      return wrap(client.moveFolder(id, newParentId), folderToChatFolder);
    },
    deleteFolder(id) {
      return wrap(client.deleteFolder(id), () => undefined);
    },
    createChat(input) {
      return wrap(
        client.createSession({
          folderId: input.folderId,
          title: input.title,
          modelId: input.modelId,
        }),
        sessionToChat,
      );
    },
    renameChat(id, title, byUser) {
      if (byUser === true) userRenamed.set(id, true);
      return wrap(client.renameSession(id, title), sessionToChat);
    },
    moveChat(id, newFolderId) {
      return wrap(client.moveSession(id, newFolderId), sessionToChat);
    },
    deleteChat(id) {
      return wrap(client.deleteSession(id), () => undefined);
    },
    archiveChat(id) {
      return wrap(client.archiveSession(id), () => undefined);
    },
    getFolder(id) {
      return wrap(client.getFolder(id), (folder) => (folder ? folderToChatFolder(folder) : null));
    },
    getChat(id) {
      return wrap(client.getSession(id), (session) => (session ? sessionToChat(session) : null));
    },
    ancestors(folderId) {
      return wrap(client.ancestors(folderId), (chain) => chain.map(folderToChatFolder));
    },
    search(query, limit = 25) {
      return wrap(client.listTree(), (raw) => {
        const tree = mapTree(raw);
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return [];
        const hits: ChatExplorerSearchHit[] = [];
        const walk = (node: FolderTreeNode): void => {
          if (node.folder && node.folder.name.toLowerCase().includes(trimmed)) {
            hits.push({
              kind: "folder",
              id: node.folder.id,
              name: node.folder.name,
              parentId: node.folder.parentId,
            });
          }
          for (const chat of node.chats) {
            if (chat.title.toLowerCase().includes(trimmed)) {
              hits.push({
                kind: "chat",
                id: chat.id,
                name: chat.title,
                parentId: chat.folderId,
              });
            }
          }
          for (const child of node.children) walk(child);
        };
        walk(tree);
        return hits.slice(0, limit);
      });
    },
    appendMessage(input) {
      if (!client.appendTurn) throw new Error("appendTurn is not available");
      return wrap(
        client.appendTurn({
          sessionId: input.chatId,
          role: input.role,
          content: input.content,
          mediaRef: input.attachments?.[0] ?? null,
          inputTokens: input.inputTokens,
          reasoningTokens: input.reasoningTokens,
          reasoningText: input.reasoningText,
          outputTokens: input.outputTokens,
          tokensEstimated: input.tokensEstimated,
          requestUsage: input.requestUsage,
          messageUsage: input.messageUsage,
        }),
        (turn) => {
          const record: ChatMessageRecord = {
            id: turn.id,
            chatId: turn.sessionId,
            role: turn.role,
            content: turn.content,
            attachments: turn.mediaRef ? [turn.mediaRef] : [],
            createdAt: turn.createdAt,
            inputTokens: turn.inputTokens,
            reasoningTokens: turn.reasoningTokens,
            reasoningText: turn.reasoningText,
            outputTokens: turn.outputTokens,
            tokensEstimated: turn.tokensEstimated,
            requestUsage: turn.requestUsage,
            messageUsage: turn.messageUsage,
          };
          return record;
        },
      );
    },
    listMessages(chatId, limit) {
      if (!client.listTurns) return [];
      return wrap(client.listTurns(chatId, limit), (turns) =>
        turns.map((turn) => ({
          id: turn.id,
          chatId: turn.sessionId,
          role: turn.role,
          content: turn.content,
          attachments: turn.mediaRef ? [turn.mediaRef] : [],
          createdAt: turn.createdAt,
          inputTokens: turn.inputTokens,
          reasoningTokens: turn.reasoningTokens,
          reasoningText: turn.reasoningText,
          outputTokens: turn.outputTokens,
          tokensEstimated: turn.tokensEstimated,
          requestUsage: turn.requestUsage,
          messageUsage: turn.messageUsage,
        })),
      );
    },
  };
}
