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
        workspaceId: "ws-0123456789abcdef01234567",
        workspaceRoots: [...input.workspaceRoots],
        primaryRoot: input.primaryRoot,
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
  it("groups sidecar sessions under their durable workspace identity", async () => {
    const backend = makeBackend([session({
      sessionId: "prev-1",
      title: "Prior session",
      workspaceId: "ws-0123456789abcdef01234567",
      workspaceRoots: ["C:\\work\\project", "D:\\shared"],
      primaryRoot: "C:\\work\\project",
    })]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspaceSelection: () => ({ roots: ["C:\\work\\project"], primaryRoot: "C:\\work\\project" }),
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    const tree = await client.listTree();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.folder?.name).toBe("project +1");
    expect(tree.children[0]?.folder?.icon).toContain("D:\\shared");
    expect(tree.children[0]?.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
  });

  it("deduplicates concurrent list results by stable session id", async () => {
    const duplicate = session({
      sessionId: "prev-1",
      title: "Prior session",
      workspaceId: "ws-0123456789abcdef01234567",
      workspaceRoots: ["C:\\work\\project"],
      primaryRoot: "C:\\work\\project",
    });
    const client = createCodingSessionsAsChatExplorer({
      backend: makeBackend([duplicate, { ...duplicate }]),
      getWorkspaceSelection: () => ({ roots: ["C:\\work\\project"], primaryRoot: "C:\\work\\project" }),
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    const tree = await client.listTree();
    expect(tree.children[0]?.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
  });

  it("renames and deletes through coding.session IPC", async () => {
    const backend = makeBackend([session({ sessionId: "prev-1", title: "Prior session" })]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspaceSelection: () => ({ roots: ["C:\\work\\project"], primaryRoot: "C:\\work\\project" }),
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

  it("migrates local overlay folders beneath Legacy workspace without losing sessions", async () => {
    const backend = makeBackend([session({ sessionId: "prev-1", title: "Prior session" })]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspaceSelection: () => ({ roots: ["C:\\work\\project"], primaryRoot: "C:\\work\\project" }),
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    const folder = await client.createFolder({ parentId: null, name: "Work" });
    await client.moveChat("prev-1", folder.id);
    let tree = await client.listTree();
    const legacy = tree.children.find((node) => node.folder?.name === "Legacy workspace");
    const unsorted = legacy?.children.find((node) => node.folder?.name === "Unsorted");
    expect(unsorted?.children[0]?.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
    await client.deleteFolder(folder.id);
    expect(backend.rows).toHaveLength(1);
    tree = await client.listTree();
    const nextLegacy = tree.children.find((node) => node.folder?.name === "Legacy workspace");
    const nextUnsorted = nextLegacy?.children.find((node) => node.folder?.name === "Unsorted");
    expect(nextUnsorted?.chats.map((chat) => chat.id)).toEqual(["prev-1"]);
  });

  it("refuses createChat without a workspace", async () => {
    const backend = makeBackend([]);
    const client = createCodingSessionsAsChatExplorer({
      backend,
      getWorkspaceSelection: () => null,
      getModelId: () => "gemma4:e4b",
      persistOverlay: false,
    });
    await expect(
      client.createChat({ folderId: null, title: "New session", modelId: "gemma4:e4b" }),
    ).rejects.toThrow(/workspace/i);
    expect(backend.rows).toHaveLength(0);
  });
});
