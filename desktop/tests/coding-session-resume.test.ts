/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T018) -- cross-surface session
 * resume.
 *
 * Proves a session started via one surface (modeled as one manager instance,
 * "CLI") resumes with intact history/state via another surface (a second
 * manager instance, "desktop") over the same shared `SessionStore` file.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
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
  it("a session started in one surface resumes with intact history in another", async () => {
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
    await cli.sendMessage(started.sessionId, "first message");
    await cli.sendMessage(started.sessionId, "second message");

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
    expect(resumed.turns).toHaveLength(2);
    expect(resumed.turns[0]).toEqual(
      expect.objectContaining({
        prompt: "first message",
        assistantText: "Acknowledged: first message",
        tokensEstimated: true,
      }),
    );
    expect(resumed.turns[1]).toEqual(
      expect.objectContaining({
        prompt: "second message",
        assistantText: "Acknowledged: second message",
        tokensEstimated: true,
      }),
    );
    expect(typeof resumed.turns[0]?.inputTokens).toBe("number");
    expect(typeof resumed.turns[0]?.outputTokens).toBe("number");
  });

  it("messages appended after resume persist back to the shared store", async () => {
    const storePath = tempStorePath("append");
    const cli = new CodingSessionManager({ store: new JsonFileSessionStore(storePath) });
    const started = cli.start({ modelId: "gemma4:e4b" });
    await cli.sendMessage(started.sessionId, "from cli");

    const desktop = new CodingSessionManager({ store: new JsonFileSessionStore(storePath) });
    await desktop.sendMessage(started.sessionId, "from desktop");

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
      turns: [
        {
          prompt: "one",
          assistantText: "answer",
          reasoningText: "explicit provider reasoning",
        },
      ],
    };
    const a = new JsonFileSessionStore(storePath);
    a.upsert(session);

    const b = new JsonFileSessionStore(storePath);
    expect(b.get("abc")).toEqual(session);
    expect(b.list()).toHaveLength(1);
  });

  it("loads schema-v2 sessions that predate explicit reasoning text", () => {
    const storePath = tempStorePath("schema-v2");
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 2,
        sessions: [
          {
            id: "old",
            model: requireModel("gemma4:e4b"),
            title: "Older session",
            createdAt: "2026-06-14T00:00:00.000Z",
            messages: ["one"],
            turns: [{ prompt: "one", assistantText: "answer" }],
          },
        ],
      }),
      "utf8",
    );
    const store = new JsonFileSessionStore(storePath);
    expect(store.get("old")?.turns?.[0]).toEqual({
      prompt: "one",
      assistantText: "answer",
    });
  });

  it("degrades to an empty store on a missing file", () => {
    const store = new JsonFileSessionStore(tempStorePath("missing"));
    expect(store.list()).toEqual([]);
    expect(store.get("anything")).toBeUndefined();
  });

  it("deletes a persisted session", () => {
    const storePath = tempStorePath("delete");
    const session: PersistedSession = {
      id: "abc",
      model: requireModel("gemma4:e4b"),
      title: "T",
      createdAt: "2026-06-14T00:00:00.000Z",
      messages: ["one"],
    };
    const a = new JsonFileSessionStore(storePath);
    a.upsert(session);
    a.delete("abc");
    const b = new JsonFileSessionStore(storePath);
    expect(b.get("abc")).toBeUndefined();
    expect(b.list()).toEqual([]);
  });

  it("archives and restores without losing the transcript", () => {
    const storePath = tempStorePath("archive");
    const session: PersistedSession = {
      id: "abc",
      model: requireModel("gemma4:e4b"),
      title: "T",
      createdAt: "2026-06-14T00:00:00.000Z",
      messages: ["one"],
      turns: [{ prompt: "one", assistantText: "answer" }],
    };
    const first = new JsonFileSessionStore(storePath);
    first.upsert(session);
    first.archive("abc", "2026-08-29T00:00:00.000Z");
    const second = new JsonFileSessionStore(storePath);
    expect(second.listArchived()[0]?.messages).toEqual(["one"]);
    expect(second.restore("abc").archivedAt).toBeNull();
    expect(new JsonFileSessionStore(storePath).get("abc")?.turns?.[0]?.assistantText).toBe("answer");
  });
});
