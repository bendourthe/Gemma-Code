/**
 * v2.2.6 Phase 1 -- sidecar ops for studio.session.* (in-memory store).
 *
 * Lives in the ROOT suite: StudioSessionStore uses better-sqlite3, which the
 * desktop (jsdom) environment does not load.
 */

import { describe, expect, it } from "vitest";

import { StudioSessionStore } from "../../../core/generations/StudioSessionStore.js";
import { createStudioSessionOps } from "../../../desktop/sidecar/src/studio/sessionRuntime.js";

function ops() {
  const store = new StudioSessionStore(":memory:");
  return { ops: createStudioSessionOps({ store, dbPath: ":memory:" }), store };
}

describe("studio.session ops", () => {
  it("creates an image session, appends turns, lists them", () => {
    const { ops: o, store } = ops();
    const session = o.createSession({
      pillar: "image",
      folderId: null,
      title: "Fox",
      modelId: "sana-1.6b-1024",
    });
    o.appendTurn({ sessionId: session.id, role: "user", content: "a fox" });
    o.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "",
      mediaRef: "/tmp/fox.png",
    });
    const listed = o.listTurns({ sessionId: session.id }).turns;
    expect(listed).toHaveLength(2);
    expect(listed[1]?.mediaRef).toBe("/tmp/fox.png");
    expect(o.tree({ pillar: "image" }).tree.sessions[0]?.lastOutputRef).toBe("/tmp/fox.png");
    store.close();
  });

  it("does not leak image sessions into the video tree", () => {
    const { ops: o, store } = ops();
    o.createSession({
      pillar: "image",
      folderId: null,
      title: "Still",
      modelId: "sana",
    });
    expect(o.tree({ pillar: "video" }).tree.sessions).toHaveLength(0);
    store.close();
  });

  it("rejects a missing pillar on create", () => {
    const { ops: o, store } = ops();
    expect(() =>
      o.createSession({
        pillar: "chat" as never,
        folderId: null,
        title: "Nope",
        modelId: "x",
      }),
    ).toThrow(/pillar is required/);
    store.close();
  });
});
