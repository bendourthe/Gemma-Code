/**
 * v2.2.8 Phase 2 -- coding.session.* adapter for FolderTree.
 */

import { describe, expect, it } from "vitest";
import {
  createCodingSessionsAsChatExplorer,
  type CodingExplorerBackend,
} from "../src/shared/explorer/codingSessionsAsChatExplorer";
import type { CodingSessionSummaryT } from "../sidecar/src/protocol";

function session(
  partial: Partial<CodingSessionSummaryT> & Pick<CodingSessionSummaryT, "sessionId" | "title">,
): CodingSessionSummaryT {
  return {
    modelId: "gemma4:e4b",
    family: "gemma",
    createdAt: "2026-08-24T00:00:00Z",
    messageCount: 0,
    ...partial,
  };
}

function makeBackend(rows: CodingSessionSummaryT[]): CodingExplorerBackend & {
  rows: CodingSessionSummaryT[];
} {
  return {
    rows,
    async listSessions() {
      return [...rows];
    },
    async startSession(input) {
      const created = session({
        sessionId: `new-${rows.length + 1}`,
        title: input.title,
        modelId: input.modelId,
      });
      rows.push(created);
      return created;
    },
    async renameSession(sessionId, title) {
      const found = rows.find((row) => row.sessionId === sessionId);
      if (!found) throw new Error(`unknown sessionId: ${sessionId}`);
      found.title = title;
      return found;
    },
    async deleteSession(sessionId) {
      const index = rows.findIndex((row) => row.sessionId === sessionId);
      if (index < 0) throw new Error(`unknown sessionId: ${sessionId}`);
      rows.splice(index, 1);
    },
  };
}

describe("createCodingSessionsAsChatExplorer", () => {
  it("lists sidecar sessions as a flat FolderTree with no fake rows", async () => {
    const backend = makeBackend([session({ sessionId: "prev-1", title: "Prior session" })]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspacePath: () => "C:\\work\\project",
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    const tree = await client.listTree();
    expect(tree.children).toEqual([]);
    expect(tree.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
    expect(tree.chats[0]?.title).toBe("Prior session");
  });

  it("renames and deletes through coding.session IPC", async () => {
    const backend = makeBackend([session({ sessionId: "prev-1", title: "Prior session" })]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspacePath: () => "C:\\work\\project",
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    await client.renameChat("prev-1", "Renamed agents");
    expect(backend.rows[0]?.title).toBe("Renamed agents");
    await client.deleteChat("prev-1");
    expect(backend.rows).toHaveLength(0);
    const tree = await client.listTree();
    expect(tree.chats).toHaveLength(0);
  });

  it("keeps overlay folders local and reparents sessions when a folder is deleted", async () => {
    const backend = makeBackend([session({ sessionId: "prev-1", title: "Prior session" })]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspacePath: () => "C:\\work\\project",
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    const folder = await client.createFolder({ parentId: null, name: "Work" });
    await client.moveChat("prev-1", folder.id);
    let tree = await client.listTree();
    expect(tree.children[0]?.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
    await client.deleteFolder(folder.id);
    expect(backend.rows).toHaveLength(1);
    tree = await client.listTree();
    expect(tree.children).toHaveLength(0);
    expect(tree.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
  });

  it("refuses createChat without a workspace", async () => {
    const backend = makeBackend([]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspacePath: () => "  ",
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    await expect(
      client.createChat({ folderId: null, title: "New session", modelId: "gemma4:e4b" }),
    ).rejects.toThrow(/workspace/i);
    expect(backend.rows).toHaveLength(0);
  });
});
