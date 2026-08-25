/**
 * v2.2.6 Phase 1 -- StudioSessionStore.
 *
 * In-memory SQLite for CRUD. A temp-file round-trip covers the
 * "new store instance" restart gate. Chat explorer is a separate schema.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioSessionStore } from "../../../../core/generations/StudioSessionStore.js";
import { resolveSessionsDbPath } from "../../../../core/generations/paths.js";

const stores: StudioSessionStore[] = [];

afterEach(() => {
  for (const s of stores) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  stores.length = 0;
});

function mem(): StudioSessionStore {
  const store = new StudioSessionStore(":memory:");
  stores.push(store);
  return store;
}

describe("resolveSessionsDbPath", () => {
  it("places sessions.db under the generations directory", () => {
    const db = resolveSessionsDbPath(() => path.join("/tmp", "nexus-home"));
    expect(db.replace(/\\/g, "/")).toMatch(/generations\/sessions\.db$/);
  });
});

describe("StudioSessionStore", () => {
  it("rejects create when pillar is missing", () => {
    const store = mem();
    expect(() =>
      store.createSession({
        pillar: "" as never,
        folderId: null,
        title: "Fox",
        modelId: "sana-1.6b-1024",
      }),
    ).toThrow(/pillar is required/);
  });

  it("creates an image session, appends user + assistant media, lists after a new instance", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-studio-sessions-"));
    const dbPath = path.join(dir, "sessions.db");
    try {
      const first = new StudioSessionStore(dbPath);
      const session = first.createSession({
        pillar: "image",
        folderId: null,
        title: "Fox portrait",
        modelId: "sana-1.6b-1024",
      });
      first.appendTurn({
        sessionId: session.id,
        role: "user",
        content: "a fox in snow",
      });
      first.appendTurn({
        sessionId: session.id,
        role: "assistant",
        content: "",
        mediaRef: path.join(dir, "fox.png"),
      });
      first.close();

      const second = new StudioSessionStore(dbPath);
      try {
        const tree = second.listTree("image");
        expect(tree.sessions).toHaveLength(1);
        expect(tree.sessions[0]?.title).toBe("Fox portrait");
        expect(tree.sessions[0]?.lastOutputRef).toBe(path.join(dir, "fox.png"));
        const turns = second.listTurns(session.id);
        expect(turns).toHaveLength(2);
        expect(turns[0]?.role).toBe("user");
        expect(turns[0]?.content).toBe("a fox in snow");
        expect(turns[0]?.createdAt).toBeGreaterThan(0);
        expect(turns[1]?.role).toBe("assistant");
        expect(turns[1]?.mediaRef).toBe(path.join(dir, "fox.png"));
      } finally {
        second.close();
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may keep a SQLite WAL handle until process exit.
      }
    }
  });

  it("keeps image and video trees isolated", () => {
    const store = mem();
    store.createSession({
      pillar: "image",
      folderId: null,
      title: "Still",
      modelId: "sana",
    });
    store.createSession({
      pillar: "video",
      folderId: null,
      title: "Clip",
      modelId: "wan",
    });
    expect(store.listTree("image").sessions.map((s) => s.title)).toEqual(["Still"]);
    expect(store.listTree("video").sessions.map((s) => s.title)).toEqual(["Clip"]);
  });

  it("rejects an empty rename", () => {
    const store = mem();
    const session = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Keep",
      modelId: "sana",
    });
    expect(() => store.renameSession(session.id, "   ")).toThrow(/title is required/);
  });

  it("delete wins: rename after delete returns not-found", () => {
    const store = mem();
    const session = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Gone",
      modelId: "sana",
    });
    store.deleteSession(session.id);
    expect(() => store.renameSession(session.id, "Still here")).toThrow(/session not found/);
  });

  it("skips a session whose extra JSON is corrupt instead of crashing the tree", () => {
    const store = mem();
    const good = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Good",
      modelId: "sana",
    });
    const bad = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Bad",
      modelId: "sana",
    });
    store.unsafeSetSessionExtraJson(bad.id, "{not-json");
    const titles = store.listTree("image").sessions.map((s) => s.title);
    expect(titles).toContain("Good");
    expect(titles).not.toContain("Bad");
    expect(store.getSession(good.id)?.title).toBe("Good");
  });

  it("rejects an inline blob as mediaRef", () => {
    const store = mem();
    const session = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Blob",
      modelId: "sana",
    });
    expect(() =>
      store.appendTurn({
        sessionId: session.id,
        role: "assistant",
        content: "",
        mediaRef: "data:image/png;base64,AAAA",
      }),
    ).toThrow(/path/);
  });

  it("organises sessions into folders and moves them back to root", () => {
    const store = mem();
    const folder = store.createFolder({ pillar: "image", parentId: null, name: "Portraits" });
    const session = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Fox",
      modelId: "sana",
    });
    expect(store.moveSession(session.id, folder.id).folderId).toBe(folder.id);
    expect(store.moveSession(session.id, null).folderId).toBeNull();
  });

  it("round-trips usage fields through extra_json and does not count a stub visual unit", () => {
    const store = mem();
    const session = store.createSession({
      pillar: "image",
      folderId: null,
      title: "Usage",
      modelId: "sana",
    });
    store.appendTurn({
      sessionId: session.id,
      role: "user",
      content: "a fox",
      inputTokens: 3,
      tokensEstimated: true,
      visualUnits: 0,
    });
    store.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "",
      mediaRef: "/tmp/fox.png",
      visualUnits: 1,
    });
    store.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "stub",
      visualUnits: 0,
    });
    const turns = store.listTurns(session.id);
    expect(turns[0]?.inputTokens).toBe(3);
    expect(turns[0]?.tokensEstimated).toBe(true);
    expect(turns[0]?.visualUnits).toBe(0);
    expect(turns[1]?.visualUnits).toBe(1);
    expect(turns[1]?.mediaRef).toBe("/tmp/fox.png");
    expect(turns[2]?.visualUnits).toBe(0);
    expect(turns[2]?.inputTokens).toBeUndefined();
  });
});
