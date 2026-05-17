import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { ModelStorage, type ModelManifest } from "../../../../core/registry/ModelStorage.js";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function makeManifest(overrides: Partial<ModelManifest> = {}): ModelManifest {
  const buf = Buffer.from("hello");
  return {
    schemaVersion: 1,
    id: "demo:1",
    family: "demo",
    name: "demo",
    tag: "1",
    type: "llm",
    blobs: [{ role: "weights", sha256: sha256(buf), sizeBytes: buf.length }],
    createdAt: "2026-05-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("ModelStorage", () => {
  let root: string;
  let storage: ModelStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-models-"));
    storage = new ModelStorage(root);
    await storage.ensureLayout();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("ensureLayout creates the three top-level directories", async () => {
    const blobs = await fs.stat(storage.blobsDir());
    const manifests = await fs.stat(storage.manifestsDir());
    const tmp = await fs.stat(storage.tmpDir());
    expect(blobs.isDirectory()).toBe(true);
    expect(manifests.isDirectory()).toBe(true);
    expect(tmp.isDirectory()).toBe(true);
  });

  it("writeBlob + hasBlob + readBlob round-trips a buffer", async () => {
    const buf = Buffer.from("hello world");
    const digest = sha256(buf);
    await storage.writeBlob(digest, buf);
    expect(await storage.hasBlob(digest)).toBe(true);
    const back = await storage.readBlobBuffer(digest);
    expect(back.toString()).toBe("hello world");
  });

  it("blobPath rejects malformed digests", () => {
    expect(() => storage.blobPath("not-a-sha")).toThrow(/invalid sha256/);
  });

  it("linkManifest writes a JSON file under family/name/tag", async () => {
    const manifest = makeManifest();
    const target = await storage.linkManifest(manifest.family, manifest.name, manifest.tag, manifest);
    const body = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(body) as ModelManifest;
    expect(parsed.id).toBe(manifest.id);
  });

  it("linkManifest rejects malformed digests in the blob refs", async () => {
    const bad = makeManifest({ blobs: [{ role: "weights", sha256: "nope" }] });
    await expect(storage.linkManifest(bad.family, bad.name, bad.tag, bad)).rejects.toThrow(/invalid sha256/);
  });

  it("unlinkManifest returns true on success, false when missing", async () => {
    const manifest = makeManifest();
    await storage.linkManifest(manifest.family, manifest.name, manifest.tag, manifest);
    expect(await storage.unlinkManifest("demo", "demo", "1")).toBe(true);
    expect(await storage.unlinkManifest("demo", "demo", "1")).toBe(false);
  });

  it("listManifests enumerates every manifest under the tree", async () => {
    const a = makeManifest({ id: "a:1", name: "a", tag: "1" });
    const b = makeManifest({ id: "b:1", family: "b", name: "b", tag: "1" });
    await storage.linkManifest(a.family, a.name, a.tag, a);
    await storage.linkManifest(b.family, b.name, b.tag, b);
    const all = await storage.listManifests();
    expect(all.map((m) => m.id).sort()).toEqual(["a:1", "b:1"]);
  });

  it("gcUnreferencedBlobs preserves referenced and deletes orphans", async () => {
    const referenced = Buffer.from("keep me");
    const orphan = Buffer.from("orphan");
    const refSha = sha256(referenced);
    const orphanSha = sha256(orphan);
    await storage.writeBlob(refSha, referenced);
    await storage.writeBlob(orphanSha, orphan);
    const m = makeManifest({
      blobs: [{ role: "weights", sha256: refSha, sizeBytes: referenced.length }],
    });
    await storage.linkManifest(m.family, m.name, m.tag, m);
    const gc = await storage.gcUnreferencedBlobs();
    expect(gc.deleted).toEqual([orphanSha]);
    expect(gc.kept).toEqual([refSha]);
    expect(await storage.hasBlob(refSha)).toBe(true);
    expect(await storage.hasBlob(orphanSha)).toBe(false);
  });

  it("gc preserves shared blobs across two manifests", async () => {
    const shared = Buffer.from("shared weights");
    const sha = sha256(shared);
    await storage.writeBlob(sha, shared);
    const a = makeManifest({ id: "a:1", name: "a", tag: "1", blobs: [{ role: "weights", sha256: sha }] });
    const b = makeManifest({ id: "b:1", family: "b", name: "b", tag: "1", blobs: [{ role: "weights", sha256: sha }] });
    await storage.linkManifest(a.family, a.name, a.tag, a);
    await storage.linkManifest(b.family, b.name, b.tag, b);
    await storage.unlinkManifest(a.family, a.name, a.tag);
    const gc = await storage.gcUnreferencedBlobs();
    expect(gc.deleted).toEqual([]);
    expect(gc.kept).toEqual([sha]);
  });

  it("diskUsageBytes sums all blob sizes", async () => {
    const a = Buffer.from("a".repeat(100));
    const b = Buffer.from("b".repeat(200));
    await storage.writeBlob(sha256(a), a);
    await storage.writeBlob(sha256(b), b);
    expect(await storage.diskUsageBytes()).toBe(300);
  });

  it("readManifest returns null when missing", async () => {
    expect(await storage.readManifest("nope", "nope", "nope")).toBeNull();
  });

  it("readBlob throws when blob is missing", async () => {
    const missing = "0".repeat(64);
    await expect(storage.readBlobBuffer(missing)).rejects.toThrow(/blob not found/);
  });

  it("readBlob streams an existing blob", async () => {
    const buf = Buffer.from("streaming");
    const sha = sha256(buf);
    await storage.writeBlob(sha, buf);
    const stream = await storage.readBlob(sha);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("streaming");
  });

  it("readBlob throws when missing", async () => {
    const missing = "f".repeat(64);
    await expect(storage.readBlob(missing)).rejects.toThrow(/blob not found/);
  });

  it("readManifest validates and parses an on-disk file", async () => {
    const m = makeManifest();
    await storage.linkManifest(m.family, m.name, m.tag, m);
    const back = await storage.readManifest(m.family, m.name, m.tag);
    expect(back?.id).toBe(m.id);
  });

  it("manifestPath rejects missing components", () => {
    expect(() => storage.manifestPath("", "n", "t")).toThrow();
    expect(() => storage.manifestPath("f", "", "t")).toThrow();
    expect(() => storage.manifestPath("f", "n", "")).toThrow();
  });

  it("writeBlob accepts a Readable stream", async () => {
    const { Readable } = await import("node:stream");
    const buf = Buffer.from("read me");
    const sha = sha256(buf);
    await storage.writeBlob(sha, Readable.from([buf]));
    expect(await storage.hasBlob(sha)).toBe(true);
    const back = await storage.readBlobBuffer(sha);
    expect(back.toString()).toBe("read me");
  });

  it("listManifests handles a brand-new root with no entries", async () => {
    const empty = new ModelStorage(await fs.mkdtemp(path.join(os.tmpdir(), "nexus-empty-")));
    try {
      const all = await empty.listManifests();
      expect(all).toEqual([]);
    } finally {
      await fs.rm(empty.root, { recursive: true, force: true });
    }
  });

  it("listManifests skips non-json files under a tag directory", async () => {
    const m = makeManifest();
    await storage.linkManifest(m.family, m.name, m.tag, m);
    await fs.writeFile(path.join(storage.manifestsDir(), m.family, m.name, "stray.txt"), "ignored");
    const all = await storage.listManifests();
    expect(all.length).toBe(1);
  });

  it("linkManifest rejects a non-v1 schemaVersion", async () => {
    const bad = { ...makeManifest(), schemaVersion: 2 } as unknown as ReturnType<typeof makeManifest>;
    await expect(storage.linkManifest(bad.family, bad.name, bad.tag, bad)).rejects.toThrow(/schemaVersion/);
  });

  it("linkManifest rejects empty blobs array", async () => {
    const bad = makeManifest({ blobs: [] });
    await expect(storage.linkManifest(bad.family, bad.name, bad.tag, bad)).rejects.toThrow(/at least one blob/);
  });

  it("linkManifest rejects missing identity fields", async () => {
    const bad = makeManifest({ id: "" });
    await expect(storage.linkManifest(bad.family, bad.name, bad.tag, bad)).rejects.toThrow(/identity/);
  });
});
