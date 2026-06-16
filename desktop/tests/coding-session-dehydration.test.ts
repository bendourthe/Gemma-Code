/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- session-state
 * artifact dehydration through the real `JsonFileSessionStore` seam.
 *
 * Proves the end-to-end A1 behaviour:
 *   - a large message is stored out-of-line (the sessions.json file does NOT
 *     carry the full payload; an artifact directory holds it) and rehydrates
 *     to full content when a fresh store loads the file (resume).
 *   - a pre-migration (schema v1) sessions.json with a large inline string
 *     still loads with full content -- the tolerant read path.
 *   - a secret in a large message is never written to the artifact store
 *     unredacted.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { requireModel } from "../sidecar/src/coding/models";
import {
  JsonFileSessionStore,
  type PersistedSession,
} from "../sidecar/src/coding/sessionStore";

const tempDirs: string[] = [];

function tempStoreDir(label: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `nexus-dehydration-${label}-`));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

function bigMessage(n = 30_000): string {
  return `BEGIN ${"payload ".repeat(Math.ceil(n / 8))} END`.slice(0, n);
}

function makeSession(messages: string[]): PersistedSession {
  return {
    id: "sess-1",
    model: requireModel("gemma4:e4b"),
    title: "Dehydration",
    createdAt: "2026-06-15T00:00:00.000Z",
    messages,
  };
}

describe("JsonFileSessionStore -- artifact dehydration (A1 / AS005)", () => {
  it("stores a large message out-of-line and rehydrates it on resume", () => {
    const dir = tempStoreDir("roundtrip");
    const storePath = path.join(dir, "sessions.json");
    const payload = bigMessage();

    const writer = new JsonFileSessionStore(storePath);
    writer.upsert(makeSession(["short turn", payload]));

    // The persisted JSON must not carry the full payload inline...
    const onDisk = readFileSync(storePath, "utf8");
    expect(onDisk).not.toContain(payload);
    expect(onDisk).toContain("nexusArtifact");
    // ...and a content-addressed artifact directory must exist.
    const artifactsDir = path.join(dir, "session-artifacts");
    expect(existsSync(artifactsDir)).toBe(true);

    // A fresh store over the same file rehydrates full content (resume).
    const reader = new JsonFileSessionStore(storePath);
    expect(reader.get("sess-1")?.messages).toEqual(["short turn", payload]);
  });

  it("loads a pre-migration (v1) sessions.json with a large inline string", () => {
    const dir = tempStoreDir("premigration");
    const storePath = path.join(dir, "sessions.json");
    const payload = bigMessage();

    // Hand-write a schema-v1 file: messages are plain inline strings, no
    // artifact refs, exactly as a session persisted before this change.
    const v1 = {
      version: 1,
      sessions: [
        {
          id: "sess-1",
          model: requireModel("gemma4:e4b"),
          title: "Legacy",
          createdAt: "2026-06-14T00:00:00.000Z",
          messages: ["legacy short", payload],
        },
      ],
    };
    writeFileSync(storePath, JSON.stringify(v1, null, 2), "utf8");

    // The tolerant read path returns full content despite no artifact store entry.
    const reader = new JsonFileSessionStore(storePath);
    expect(reader.get("sess-1")?.messages).toEqual(["legacy short", payload]);
  });

  it("never writes a secret to the artifact store unredacted", () => {
    const dir = tempStoreDir("redact");
    const storePath = path.join(dir, "sessions.json");
    const secret = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    const payload = `${bigMessage()} token=${secret}`;

    const writer = new JsonFileSessionStore(storePath);
    writer.upsert(makeSession([payload]));

    const artifactsDir = path.join(dir, "session-artifacts");
    for (const shard of readdirSync(artifactsDir)) {
      const shardDir = path.join(artifactsDir, shard);
      for (const f of readdirSync(shardDir)) {
        expect(readFileSync(path.join(shardDir, f), "utf8")).not.toContain(secret);
      }
    }
    // The sessions.json (preview) is redacted too.
    expect(readFileSync(storePath, "utf8")).not.toContain(secret);
  });

  it("leaves small-message sessions fully inline (no artifact directory)", () => {
    const dir = tempStoreDir("inline");
    const storePath = path.join(dir, "sessions.json");
    const store = new JsonFileSessionStore(storePath);
    store.upsert(makeSession(["tiny one", "tiny two"]));

    expect(existsSync(path.join(dir, "session-artifacts"))).toBe(false);
    const reader = new JsonFileSessionStore(storePath);
    expect(reader.get("sess-1")?.messages).toEqual(["tiny one", "tiny two"]);
  });
});
