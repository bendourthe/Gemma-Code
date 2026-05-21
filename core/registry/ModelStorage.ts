/**
 * v1.0.0 Phase 5.1 -- content-addressed model storage.
 *
 * Layout under `~/.nexus/models/`:
 *
 *   models/
 *     blobs/
 *       sha256-<hex>             - file keyed by its SHA-256 digest
 *     manifests/
 *       <family>/<name>/<tag>.json   - per-model manifest referencing blobs
 *     _tmp/
 *       <sha256>.part            - partial downloads (managed by Downloader)
 *
 * Manifest schema: see `core/registry/manifest.schema.json`.
 *
 * The storage layer is pure FS: it does not download, verify digests, or
 * validate manifest semantics beyond the schema's required keys. Higher
 * layers (`Downloader`, `NexusModelRegistry`) bring those.
 *
 * Garbage collection: `gcUnreferencedBlobs()` deletes any `blobs/sha256-*`
 * that is not referenced by any manifest. Shared blobs (two manifests
 * pointing at the same sha) are preserved.
 */

import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";

export interface ManifestBlobRef {
  readonly role: string;
  readonly sha256: string;
  readonly sizeBytes?: number;
  readonly filename?: string;
}

export interface ModelManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly family: string;
  readonly name: string;
  readonly tag: string;
  readonly type: "llm" | "embed" | "image" | "video" | "controlnet" | "vae";
  readonly runtime?:
    | "ollama"
    | "lmstudio"
    | "diffusion"
    | "video"
    | "embed"
    | "controlnet"
    | "vae";
  readonly displayName?: string;
  readonly license?: string;
  readonly sizeBytes?: number;
  readonly vramGb?: number;
  readonly blobs: readonly ManifestBlobRef[];
  readonly source?: { protocol: "ollama" | "huggingface" | "url"; url?: string; repo?: string };
  readonly tags?: readonly string[];
  readonly createdAt: string;
}

export interface GcResult {
  readonly deleted: readonly string[];
  readonly kept: readonly string[];
}

const SHA256_RE = /^[a-f0-9]{64}$/;

function assertSha256(sha: string): void {
  if (!SHA256_RE.test(sha)) {
    throw new Error(`ModelStorage: invalid sha256 digest: ${sha}`);
  }
}

function assertManifest(manifest: ModelManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error("ModelStorage: manifest schemaVersion must be 1");
  }
  if (!manifest.id || !manifest.family || !manifest.name || !manifest.tag) {
    throw new Error("ModelStorage: manifest is missing required identity fields");
  }
  if (!Array.isArray(manifest.blobs) || manifest.blobs.length === 0) {
    throw new Error("ModelStorage: manifest must reference at least one blob");
  }
  for (const ref of manifest.blobs) {
    assertSha256(ref.sha256);
  }
}

export class ModelStorage {
  constructor(private readonly _root: string) {}

  get root(): string {
    return this._root;
  }

  blobsDir(): string {
    return path.join(this._root, "blobs");
  }

  manifestsDir(): string {
    return path.join(this._root, "manifests");
  }

  tmpDir(): string {
    return path.join(this._root, "_tmp");
  }

  blobPath(sha256: string): string {
    assertSha256(sha256);
    return path.join(this.blobsDir(), `sha256-${sha256}`);
  }

  manifestPath(family: string, name: string, tag: string): string {
    if (!family || !name || !tag) {
      throw new Error("ModelStorage: manifestPath requires family, name, tag");
    }
    return path.join(this.manifestsDir(), family, name, `${tag}.json`);
  }

  async ensureLayout(): Promise<void> {
    await fs.mkdir(this.blobsDir(), { recursive: true });
    await fs.mkdir(this.manifestsDir(), { recursive: true });
    await fs.mkdir(this.tmpDir(), { recursive: true });
  }

  async hasBlob(sha256: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.blobPath(sha256));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async writeBlob(sha256: string, source: Readable | Buffer): Promise<string> {
    await this.ensureLayout();
    const target = this.blobPath(sha256);
    if (Buffer.isBuffer(source)) {
      await fs.writeFile(target, source);
      return target;
    }
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(target);
      source.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      source.pipe(out);
    });
    return target;
  }

  async readBlob(sha256: string): Promise<Readable> {
    if (!(await this.hasBlob(sha256))) {
      throw new Error(`ModelStorage: blob not found: ${sha256}`);
    }
    return createReadStream(this.blobPath(sha256));
  }

  async readBlobBuffer(sha256: string): Promise<Buffer> {
    if (!(await this.hasBlob(sha256))) {
      throw new Error(`ModelStorage: blob not found: ${sha256}`);
    }
    return fs.readFile(this.blobPath(sha256));
  }

  async linkManifest(family: string, name: string, tag: string, manifest: ModelManifest): Promise<string> {
    assertManifest(manifest);
    const target = this.manifestPath(family, name, tag);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = JSON.stringify(manifest, null, 2);
    await fs.writeFile(target, body, "utf8");
    return target;
  }

  async unlinkManifest(family: string, name: string, tag: string): Promise<boolean> {
    const target = this.manifestPath(family, name, tag);
    try {
      await fs.unlink(target);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }

  async readManifest(family: string, name: string, tag: string): Promise<ModelManifest | null> {
    const target = this.manifestPath(family, name, tag);
    try {
      const body = await fs.readFile(target, "utf8");
      const parsed = JSON.parse(body) as ModelManifest;
      assertManifest(parsed);
      return parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async listManifests(): Promise<readonly ModelManifest[]> {
    const root = this.manifestsDir();
    const out: ModelManifest[] = [];
    const families = await safeReaddir(root);
    for (const family of families) {
      const familyDir = path.join(root, family);
      const names = await safeReaddir(familyDir);
      for (const name of names) {
        const nameDir = path.join(familyDir, name);
        const tags = await safeReaddir(nameDir);
        for (const tagFile of tags) {
          if (!tagFile.endsWith(".json")) continue;
          const tag = tagFile.slice(0, -".json".length);
          const manifest = await this.readManifest(family, name, tag);
          if (manifest) out.push(manifest);
        }
      }
    }
    return out;
  }

  async listBlobShas(): Promise<readonly string[]> {
    const entries = await safeReaddir(this.blobsDir());
    return entries
      .filter((e) => e.startsWith("sha256-"))
      .map((e) => e.slice("sha256-".length))
      .filter((h) => SHA256_RE.test(h));
  }

  async gcUnreferencedBlobs(): Promise<GcResult> {
    const manifests = await this.listManifests();
    const referenced = new Set<string>();
    for (const m of manifests) {
      for (const b of m.blobs) referenced.add(b.sha256);
    }
    const shas = await this.listBlobShas();
    const deleted: string[] = [];
    const kept: string[] = [];
    for (const sha of shas) {
      if (referenced.has(sha)) {
        kept.push(sha);
      } else {
        await fs.unlink(this.blobPath(sha));
        deleted.push(sha);
      }
    }
    return { deleted, kept };
  }

  /** Total bytes on disk under `blobs/`. */
  async diskUsageBytes(): Promise<number> {
    const shas = await this.listBlobShas();
    let total = 0;
    for (const sha of shas) {
      try {
        const stat = await fs.stat(this.blobPath(sha));
        total += stat.size;
      } catch {
        // ignore disappeared files; gc will clean up
      }
    }
    return total;
  }
}

async function safeReaddir(dir: string): Promise<readonly string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
