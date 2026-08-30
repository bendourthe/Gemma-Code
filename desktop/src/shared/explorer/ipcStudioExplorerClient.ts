/**
 * v2.2.6 Phase 1 -- IPC client for `studio.session.*`.
 */

import { ipcCall } from "../../lib/ipc";
import type {
  StudioFolder,
  StudioSession,
  StudioTreeNode,
  StudioTurn,
  StudioPillar,
} from "../../../../core/generations/StudioSessionStore.types";
import type { StudioExplorerClient } from "./studioExplorerClient";

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const reply = await ipcCall<T>(method as never, params);
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

export function createIpcStudioExplorerClient(pillar: StudioPillar): StudioExplorerClient {
  return {
    async listTree() {
      const { tree } = await call<{ tree: StudioTreeNode }>("studio.session.tree", { pillar });
      return tree;
    },
    createFolder: (input) =>
      call<StudioFolder>("studio.session.createFolder", {
        pillar,
        parentId: input.parentId,
        name: input.name,
      }),
    renameFolder: (id, name) => call<StudioFolder>("studio.session.renameFolder", { id, name }),
    moveFolder: (id, parentId) =>
      call<StudioFolder>("studio.session.moveFolder", { id, parentId }),
    async deleteFolder(id) {
      await call("studio.session.deleteFolder", { id });
    },
    createSession: (input) =>
      call<StudioSession>("studio.session.createSession", {
        pillar,
        folderId: input.folderId,
        title: input.title,
        modelId: input.modelId,
      }),
    renameSession: (id, title) =>
      call<StudioSession>("studio.session.renameSession", { id, title }),
    moveSession: (id, folderId) =>
      call<StudioSession>("studio.session.moveSession", { id, folderId }),
    async deleteSession(id) {
      await call("studio.session.deleteSession", { id });
    },
    async getFolder(id) {
      const tree = await this.listTree();
      const stack = [tree];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.folder?.id === id) return node.folder;
        stack.push(...node.children);
      }
      return null;
    },
    async getSession(id) {
      const tree = await this.listTree();
      const stack = [tree];
      while (stack.length > 0) {
        const node = stack.pop()!;
        const found = node.sessions.find((s) => s.id === id);
        if (found) return found;
        stack.push(...node.children);
      }
      return null;
    },
    async ancestors(folderId) {
      if (folderId === null) return [];
      const tree = await this.listTree();
      const chain: StudioFolder[] = [];
      const walk = (node: StudioTreeNode, acc: StudioFolder[]): boolean => {
        if (node.folder?.id === folderId) {
          chain.push(...acc, node.folder);
          return true;
        }
        const next = node.folder ? [...acc, node.folder] : acc;
        for (const child of node.children) {
          if (walk(child, next)) return true;
        }
        return false;
      };
      walk(tree, []);
      return chain;
    },
    appendTurn: (input) =>
      call<StudioTurn>("studio.session.appendTurn", {
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        mediaRef: input.mediaRef ?? null,
        ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens } : {}),
        ...(input.reasoningTokens !== undefined ? { reasoningTokens: input.reasoningTokens } : {}),
        ...(input.reasoningText !== undefined ? { reasoningText: input.reasoningText } : {}),
        ...(input.outputTokens !== undefined ? { outputTokens: input.outputTokens } : {}),
        ...(input.tokensEstimated ? { tokensEstimated: true } : {}),
        ...(input.visualUnits !== undefined ? { visualUnits: input.visualUnits } : {}),
      }),
    async listTurns(sessionId, limit) {
      const { turns } = await call<{ turns: StudioTurn[] }>("studio.session.listTurns", {
        sessionId,
        ...(limit ? { limit } : {}),
      });
      return turns;
    },
  };
}
