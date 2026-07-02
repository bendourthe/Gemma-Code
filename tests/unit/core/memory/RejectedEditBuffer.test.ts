import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRejectedEditBuffer, hashEdit } from "../../../../core/memory/RejectedEditBuffer.js";

/**
 * v1.7.0 Phase 2 (adoption-self-optimizing-skills S4 / SO002) -- unit tests for
 * the rejected-edit buffer. The load-bearing acceptance is the round-trip with
 * redaction: a rejected edit's trajectory text never lands on disk unredacted.
 */

let tmpDir = "";
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-rejected-edit-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const SECRET = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";

function allArtifactFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const shard of readdirSync(dir)) {
    const shardDir = path.join(dir, shard);
    if (!existsSync(shardDir)) continue;
    for (const f of readdirSync(shardDir)) files.push(path.join(shardDir, f));
  }
  return files;
}

describe("hashEdit", () => {
  it("is a deterministic 64-char hex digest", () => {
    const a = hashEdit("some edit text");
    const b = hashEdit("some edit text");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(hashEdit("different")).not.toBe(a);
  });
});

describe("RejectedEditBuffer", () => {
  it("round-trips a rejected edit with redaction (no secret on disk)", () => {
    const buffer = createRejectedEditBuffer(tmpDir, () => 1700);
    const editHash = hashEdit("- old line\n+ new line");
    const record = buffer.record({
      skillId: "python-cleanup",
      editHash,
      reason: `failed gate; trajectory leaked ${SECRET}`,
      validationDelta: -0.25,
      content: `proposed edit + trajectory containing ${SECRET}`,
    });

    // The buffer roots its content-addressed store under `<dir>/artifacts/`.
    expect(buffer.store.dir.endsWith("artifacts")).toBe(true);
    expect(record.key).toBe(`python-cleanup:${editHash}`);
    expect(record.skillId).toBe("python-cleanup");
    expect(record.editHash).toBe(editHash);
    expect(record.validationDelta).toBe(-0.25);
    expect(record.recordedAt).toBe(1700);
    // The reason is redacted in the index.
    expect(record.reason).not.toContain(SECRET);
    expect(record.reason).toContain("<redacted>");

    // The rehydrated content is redacted...
    const resolved = buffer.get("python-cleanup", editHash);
    expect(resolved).not.toBeNull();
    expect(resolved!.content).not.toContain(SECRET);
    expect(resolved!.content).toContain("<redacted>");

    // ...and no secret reaches any on-disk artifact or the index file.
    for (const f of allArtifactFiles(path.join(tmpDir, "artifacts"))) {
      expect(readFileSync(f, "utf8")).not.toContain(SECRET);
    }
    expect(readFileSync(path.join(tmpDir, "index.json"), "utf8")).not.toContain(SECRET);
  });

  it("reports presence and resolves null for unknown keys", () => {
    const buffer = createRejectedEditBuffer(tmpDir);
    const editHash = hashEdit("edit");
    expect(buffer.has("s1", editHash)).toBe(false);
    expect(buffer.get("s1", editHash)).toBeNull();
    buffer.record({ skillId: "s1", editHash, reason: "r", validationDelta: -0.1, content: "c" });
    expect(buffer.has("s1", editHash)).toBe(true);
    expect(buffer.has("s1", hashEdit("other"))).toBe(false);
  });

  it("is idempotent on skillId + editHash (first write wins, no duplicate)", () => {
    const buffer = createRejectedEditBuffer(tmpDir, () => 42);
    const editHash = hashEdit("edit");
    const first = buffer.record({ skillId: "s1", editHash, reason: "first", validationDelta: -0.1, content: "c1" });
    const second = buffer.record({ skillId: "s1", editHash, reason: "second", validationDelta: -0.9, content: "c2" });
    expect(second).toEqual(first); // existing record returned unchanged
    expect(buffer.list("s1")).toHaveLength(1);
    // The stored content is the first write's content.
    expect(buffer.get("s1", editHash)!.content).toBe("c1");
  });

  it("keys separate edits independently and filters by skill", () => {
    const buffer = createRejectedEditBuffer(tmpDir);
    buffer.record({ skillId: "s1", editHash: hashEdit("e1"), reason: "r", validationDelta: 0, content: "a" });
    buffer.record({ skillId: "s1", editHash: hashEdit("e2"), reason: "r", validationDelta: 0, content: "b" });
    buffer.record({ skillId: "s2", editHash: hashEdit("e3"), reason: "r", validationDelta: 0, content: "c" });
    expect(buffer.list()).toHaveLength(3);
    expect(buffer.list("s1")).toHaveLength(2);
    expect(buffer.list("s2")).toHaveLength(1);
  });

  it("persists the index across buffer instances", () => {
    const editHash = hashEdit("edit");
    const first = createRejectedEditBuffer(tmpDir, () => 7);
    first.record({ skillId: "s1", editHash, reason: "r", validationDelta: -0.2, content: "content" });

    const reopened = createRejectedEditBuffer(tmpDir);
    expect(reopened.has("s1", editHash)).toBe(true);
    const resolved = reopened.get("s1", editHash);
    expect(resolved!.record.validationDelta).toBe(-0.2);
    expect(resolved!.content).toBe("content");
  });

  it("tolerates a missing or corrupt index file", () => {
    // Fresh dir: no index yet.
    const buffer = createRejectedEditBuffer(tmpDir);
    expect(buffer.list()).toEqual([]);
    expect(buffer.has("s1", hashEdit("x"))).toBe(false);

    // Corrupt index degrades to empty rather than throwing.
    const store = createRejectedEditBuffer(tmpDir);
    writeFileSync(store.indexPath, "{ not valid json", "utf8");
    expect(store.list()).toEqual([]);

    // Valid JSON of the wrong shape (not an array) also degrades to empty.
    writeFileSync(store.indexPath, '{"unexpected":"object"}', "utf8");
    expect(store.list()).toEqual([]);
  });

  it("degrades to empty content when the backing artifact is missing", async () => {
    const editHash = hashEdit("edit");
    const buffer = createRejectedEditBuffer(tmpDir);
    buffer.record({ skillId: "s1", editHash, reason: "r", validationDelta: -0.1, content: "trajectory" });
    // Simulate a pruned / hand-deleted artifact: the index row survives.
    await fs.rm(path.join(tmpDir, "artifacts"), { recursive: true, force: true });
    const resolved = buffer.get("s1", editHash);
    expect(resolved).not.toBeNull();
    expect(resolved!.content).toBe("");
  });
});
