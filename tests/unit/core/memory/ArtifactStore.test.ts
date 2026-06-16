/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- ArtifactStore unit
 * tests.
 *
 * Coverage:
 *   - put/get round-trip
 *   - content-addressing: identical content dedupes to one ref + file
 *   - redaction on the write path: a secret is never written to disk
 *   - get on a missing / malformed ref returns null (never throws)
 *   - has() reflects presence and rejects malformed refs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArtifactStore } from "../../../../core/memory/ArtifactStore.js";

let tmpDir = "";
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-artifact-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function allArtifactFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const shard of readdirSync(dir)) {
    const shardDir = path.join(dir, shard);
    for (const f of readdirSync(shardDir)) files.push(path.join(shardDir, f));
  }
  return files;
}

describe("ArtifactStore", () => {
  it("round-trips a payload through put/get", () => {
    const store = new ArtifactStore(tmpDir);
    const text = "x".repeat(50_000);
    const { ref, bytes, deduped } = store.put(text);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
    expect(bytes).toBe(50_000);
    expect(deduped).toBe(false);
    expect(store.get(ref)).toBe(text);
  });

  it("is content-addressed: identical payloads dedupe to one ref and file", () => {
    const store = new ArtifactStore(tmpDir);
    const text = "duplicate payload body";
    const first = store.put(text);
    const second = store.put(text);
    expect(second.ref).toBe(first.ref);
    expect(second.deduped).toBe(true);
    expect(allArtifactFiles(tmpDir)).toHaveLength(1);
  });

  it("redacts secrets before writing: no secret reaches disk", () => {
    const store = new ArtifactStore(tmpDir);
    const secret = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    const { ref } = store.put(`leaked token ${secret} in output`);
    // The stored content is redacted...
    expect(store.get(ref)).not.toContain(secret);
    expect(store.get(ref)).toContain("<redacted>");
    // ...and the secret is absent from every on-disk artifact file.
    for (const f of allArtifactFiles(tmpDir)) {
      expect(readFileSync(f, "utf8")).not.toContain(secret);
    }
  });

  it("returns null for a missing ref without throwing", () => {
    const store = new ArtifactStore(tmpDir);
    const missing = "a".repeat(64);
    expect(store.get(missing)).toBeNull();
    expect(store.has(missing)).toBe(false);
  });

  it("returns null / false for a malformed ref (no path traversal)", () => {
    const store = new ArtifactStore(tmpDir);
    expect(store.get("../../etc/passwd")).toBeNull();
    expect(store.get("not-a-hash")).toBeNull();
    expect(store.has("../../etc/passwd")).toBe(false);
  });

  it("has() reports presence after put", () => {
    const store = new ArtifactStore(tmpDir);
    const { ref } = store.put("y".repeat(1000));
    expect(store.has(ref)).toBe(true);
  });

  it("exposes its base directory", () => {
    const store = new ArtifactStore(tmpDir);
    expect(store.dir).toBe(tmpDir);
  });
});
