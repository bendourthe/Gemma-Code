/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T018) -- cross-surface session
 * resume.
 *
 * Proves a session started via one surface (modeled as one manager instance,
 * "CLI") resumes with intact history/state via another surface (a second
 * manager instance, "desktop") over the same shared `SessionStore` file.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { requireModel } from "../sidecar/src/coding/models";
import {
  JsonFileSessionStore,
  type PersistedSession,
} from "../sidecar/src/coding/sessionStore";

const tempFiles: string[] = [];

function tempStorePath(label: string): string {
  const p = path.join(os.tmpdir(), `nexus-sessions-${label}-${process.pid}.json`);
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    if (existsSync(f)) rmSync(f, { force: true });
    if (existsSync(`${f}.tmp`)) rmSync(`${f}.tmp`, { force: true });
  }
});

describe("CodingSessionManager -- cross-surface resume (item 26)", () => {
  it("a session started in one surface resumes with intact history in another", () => {
    const storePath = tempStorePath("xsurface");

    // Surface A ("CLI"): start a session and send two messages.
    const cli = new CodingSessionManager({
      idFactory: (() => {
        let i = 0;
        return () => `s-${++i}`;
      })(),
      store: new JsonFileSessionStore(storePath),
    });
    const started = cli.start({ modelId: "gemma4:e4b", title: "Shared work" });
    cli.sendMessage(started.sessionId, "first message");
    cli.sendMessage(started.sessionId, "second message");

    // Surface B ("desktop"): a brand-new manager + store over the same file.
    const desktop = new CodingSessionManager({
      store: new JsonFileSessionStore(storePath),
    });

    // The session is visible to the second surface...
    const listed = desktop.list().sessions;
    expect(listed.map((s) => s.sessionId)).toContain(started.sessionId);

    // ...and resumes with intact history + state.
    const resumed = desktop.resume(started.sessionId);
    expect(resumed.session.title).toBe("Shared work");
    expect(resumed.session.family).toBe("gemma");
    expect(resumed.session.messageCount).toBe(2);
    expect(resumed.messages).toEqual(["first message", "second message"]);
  });

  it("messages appended after resume persist back to the shared store", () => {
    const storePath = tempStorePath("append");
    const cli = new CodingSessionManager({ store: new JsonFileSessionStore(storePath) });
    const started = cli.start({ modelId: "gemma4:e4b" });
    cli.sendMessage(started.sessionId, "from cli");

    const desktop = new CodingSessionManager({ store: new JsonFileSessionStore(storePath) });
    desktop.sendMessage(started.sessionId, "from desktop");

    // A third surface sees both turns.
    const third = new CodingSessionManager({ store: new JsonFileSessionStore(storePath) });
    expect(third.resume(started.sessionId).messages).toEqual([
      "from cli",
      "from desktop",
    ]);
  });

  it("remains in-memory only (no persistence) when no store is injected", () => {
    const a = new CodingSessionManager();
    const started = a.start({ modelId: "gemma4:e4b" });
    // A second manager with no shared store does not see the session.
    const b = new CodingSessionManager();
    expect(() => b.resume(started.sessionId)).toThrow(/unknown sessionId/);
  });
});

describe("JsonFileSessionStore", () => {
  it("round-trips a session through the file", () => {
    const storePath = tempStorePath("roundtrip");
    const session: PersistedSession = {
      id: "abc",
      model: requireModel("gemma4:e4b"),
      title: "T",
      createdAt: "2026-06-14T00:00:00.000Z",
      messages: ["one"],
    };
    const a = new JsonFileSessionStore(storePath);
    a.upsert(session);

    const b = new JsonFileSessionStore(storePath);
    expect(b.get("abc")).toEqual(session);
    expect(b.list()).toHaveLength(1);
  });

  it("degrades to an empty store on a missing file", () => {
    const store = new JsonFileSessionStore(tempStorePath("missing"));
    expect(store.list()).toEqual([]);
    expect(store.get("anything")).toBeUndefined();
  });
});
