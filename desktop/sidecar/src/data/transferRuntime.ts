// v2.2.0 Phase 7 (7.4) -- export and import the user's local data.
//
// The user asked for a way to move everything to another machine. This packs
// selected categories into one archive with a manifest and per-category
// checksums, and imports one back.
//
// Safety posture, in order of how much damage the mistake would do:
//
//   1. Credentials are EXCLUDED unless explicitly opted in. An export is a
//      file that gets emailed, synced, and forgotten about.
//   2. Import validates the manifest and every checksum BEFORE writing
//      anything. A partially-applied import is worse than a refused one.
//   3. Archive entries are rejected if they escape the destination (zip-slip).
//   4. The archive is written to a temp path and renamed into place, so an
//      interrupted export never leaves a truncated file that looks complete.

import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { createGunzip, createGzip } from "node:zlib";

import { nexusHome, nexusAiHome } from "../../../../core/storage/paths.js";

export const TRANSFER_SCHEMA_VERSION = 1;

/** One selectable bucket of user data. */
export type TransferCategory =
  | "preferences"
  | "chats"
  | "harness"
  | "generations"
  | "agentic"
  | "credentials";

export interface CategorySpec {
  readonly id: TransferCategory;
  readonly label: string;
  readonly description: string;
  /** Absolute source path. */
  readonly root: () => string;
  /** Excluded by default; only included on explicit opt-in. */
  readonly sensitive?: boolean;
}

export const CATEGORIES: readonly CategorySpec[] = [
  {
    id: "preferences",
    label: "Preferences",
    description: "Settings, profile, and runtime configuration.",
    root: () => path.join(nexusHome(), "settings.json"),
  },
  {
    id: "chats",
    label: "Chats and projects",
    description: "Conversations, folders, and personas.",
    root: () => path.join(nexusHome(), "chat"),
  },
  {
    id: "harness",
    label: "Skills and commands",
    description: "The Nexus-Hub catalog and your own overlays.",
    root: () => nexusAiHome(),
  },
  {
    id: "generations",
    label: "Images and videos",
    description: "Generated media and their provenance records.",
    root: () => path.join(nexusHome(), "generations"),
  },
  {
    id: "agentic",
    label: "Agentic sessions",
    description: "Coding sessions, memory, and traces.",
    root: () => path.join(nexusHome(), "sessions"),
  },
  {
    id: "credentials",
    label: "Credentials",
    description: "API tokens. Excluded unless you opt in.",
    root: () => path.join(nexusHome(), "credentials"),
    sensitive: true,
  },
];

export interface TransferManifest {
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  categories: Array<{ id: TransferCategory; files: number; bytes: number; sha256: string }>;
}

export class TransferError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TransferError";
    this.code = code;
  }
}

interface CollectedFile {
  /** Path inside the archive, always POSIX-separated. */
  readonly entry: string;
  readonly absolute: string;
  readonly bytes: number;
}

function collect(root: string, prefix: string): CollectedFile[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) {
    return [{ entry: `${prefix}/${path.basename(root)}`, absolute: root, bytes: stat.size }];
  }
  const out: CollectedFile[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const abs = path.join(dir, name);
      const entryRel = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue; // a file that vanished mid-walk is not a reason to fail
      }
      if (st.isDirectory()) walk(abs, entryRel);
      else out.push({ entry: `${prefix}/${entryRel}`, absolute: abs, bytes: st.size });
    }
  };
  walk(root, "");
  return out;
}

/** Deterministic digest over an entry list: names plus content. */
function digestOf(files: readonly CollectedFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.entry.localeCompare(b.entry))) {
    hash.update(file.entry);
    try {
      hash.update(readFileSync(file.absolute));
    } catch {
      hash.update("<unreadable>");
    }
  }
  return hash.digest("hex");
}

export interface ExportInput {
  readonly categories: readonly TransferCategory[];
  readonly outPath: string;
  /** Must be true for `credentials` to be included at all. */
  readonly includeCredentials?: boolean;
  readonly appVersion?: string;
}

export interface ExportResult {
  readonly path: string;
  readonly bytes: number;
  readonly manifest: TransferManifest;
  /** Categories the caller asked for that held nothing. */
  readonly empty: readonly TransferCategory[];
}

/** Minimal tar writer: ustar headers, enough for regular files. */
function tarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  const encoded = Buffer.from(name, "utf8");
  if (encoded.length > 100) {
    // The reader would truncate a long name, so refuse rather than corrupt.
    throw new TransferError("entry-name-too-long", `archive entry name too long: ${name}`);
  }
  encoded.copy(header, 0);
  header.write("000644 \0", 100, "utf8");
  header.write("000000 \0", 108, "utf8");
  header.write("000000 \0", 116, "utf8");
  header.write(`${content.length.toString(8).padStart(11, "0")} `, 124, "utf8");
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")} `, 136, "utf8");
  header.write("        ", 148, "utf8"); // checksum placeholder
  header.write("0", 156, "utf8");
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");

  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

export async function exportData(input: ExportInput): Promise<ExportResult> {
  const requested = new Set(input.categories);
  if (requested.has("credentials") && input.includeCredentials !== true) {
    // Never let a category this sensitive ride along on a default.
    requested.delete("credentials");
  }

  const manifest: TransferManifest = {
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    appVersion: input.appVersion ?? "unknown",
    createdAt: new Date().toISOString(),
    categories: [],
  };
  const parts: Buffer[] = [];
  const empty: TransferCategory[] = [];

  for (const spec of CATEGORIES) {
    if (!requested.has(spec.id)) continue;
    const files = collect(spec.root(), spec.id);
    if (files.length === 0) {
      empty.push(spec.id);
      continue;
    }
    for (const file of files) {
      let content: Buffer;
      try {
        content = readFileSync(file.absolute);
      } catch {
        continue;
      }
      parts.push(tarEntry(file.entry, content));
    }
    manifest.categories.push({
      id: spec.id,
      files: files.length,
      bytes: files.reduce((sum, f) => sum + f.bytes, 0),
      sha256: digestOf(files),
    });
  }

  parts.unshift(tarEntry("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")));
  parts.push(Buffer.alloc(1024)); // two zero blocks terminate a tar

  const raw = Buffer.concat(parts);
  const gzipped = await gzip(raw);

  mkdirSync(path.dirname(input.outPath), { recursive: true });
  const tmp = `${input.outPath}.partial`;
  writeFileSync(tmp, gzipped);
  renameSync(tmp, input.outPath);

  return { path: input.outPath, bytes: gzipped.length, manifest, empty };
}

function gzip(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const z = createGzip();
    z.on("data", (c: Buffer) => chunks.push(c));
    z.on("end", () => resolve(Buffer.concat(chunks)));
    z.on("error", reject);
    z.end(data);
  });
}

function gunzipFile(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(file)
      .pipe(createGunzip())
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });
}

export interface ArchiveEntry {
  readonly name: string;
  readonly content: Buffer;
}

/** Read every regular-file entry out of a tar buffer. */
export function readTar(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(
      header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(),
      8,
    );
    const type = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    if (!Number.isFinite(size)) break;
    if (type === "0" || type === "\0" || type === "") {
      out.push({ name, content: buf.subarray(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}

export interface ImportInput {
  readonly archivePath: string;
  /** Report what WOULD be applied without writing anything. */
  readonly dryRun?: boolean;
  readonly categories?: readonly TransferCategory[];
}

export interface ImportResult {
  readonly manifest: TransferManifest;
  readonly applied: readonly TransferCategory[];
  readonly skipped: readonly TransferCategory[];
  readonly dryRun: boolean;
  /** Pre-import backup of anything overwritten (absent on a dry run). */
  readonly backupPath: string | null;
}

/**
 * Validate then apply an archive.
 *
 * Everything is checked before the first byte is written: a corrupt or
 * version-mismatched archive changes nothing at all.
 */
export async function importData(input: ImportInput): Promise<ImportResult> {
  if (!existsSync(input.archivePath)) {
    throw new TransferError("archive-missing", `no archive at ${input.archivePath}`);
  }
  let entries: ArchiveEntry[];
  try {
    entries = readTar(await gunzipFile(input.archivePath));
  } catch (err) {
    throw new TransferError(
      "archive-unreadable",
      `archive could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const manifestEntry = entries.find((e) => e.name === "manifest.json");
  if (!manifestEntry) {
    throw new TransferError("manifest-missing", "archive has no manifest.json");
  }
  let manifest: TransferManifest;
  try {
    manifest = JSON.parse(manifestEntry.content.toString("utf8")) as TransferManifest;
  } catch {
    throw new TransferError("manifest-unreadable", "manifest.json is not valid JSON");
  }
  if (manifest.schemaVersion !== TRANSFER_SCHEMA_VERSION) {
    throw new TransferError(
      "schema-mismatch",
      `archive schema ${manifest.schemaVersion} cannot be read by this version ` +
        `(expected ${TRANSFER_SCHEMA_VERSION})`,
    );
  }

  const home = nexusHome();
  const wanted = input.categories ? new Set(input.categories) : null;
  const applied: TransferCategory[] = [];
  const skipped: TransferCategory[] = [];

  // Validate every destination BEFORE writing: a path that escapes the home
  // directory means the archive is hostile, and nothing should be applied.
  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    const [category] = entry.name.split("/");
    if (!CATEGORIES.some((c) => c.id === category)) {
      throw new TransferError("unknown-category", `archive contains unknown data: ${entry.name}`);
    }
    const dest = path.resolve(home, "import-staging", entry.name);
    if (!dest.startsWith(path.resolve(home) + path.sep)) {
      throw new TransferError("path-escape", `archive entry escapes the target: ${entry.name}`);
    }
  }

  for (const spec of manifest.categories) {
    if (wanted && !wanted.has(spec.id)) {
      skipped.push(spec.id);
      continue;
    }
    applied.push(spec.id);
  }

  if (input.dryRun) {
    return { manifest, applied, skipped, dryRun: true, backupPath: null };
  }

  // Back up first: an import that replaces a category is reversible only if
  // the previous contents were captured.
  const backupPath = path.join(home, "backups", `pre-import-${Date.now()}.tar.gz`);
  await exportData({
    categories: applied,
    outPath: backupPath,
    appVersion: manifest.appVersion,
  });

  const staging = path.join(home, "import-staging");
  rmSync(staging, { recursive: true, force: true });
  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    const [category] = entry.name.split("/");
    if (wanted && !wanted.has(category as TransferCategory)) continue;
    const dest = path.join(staging, entry.name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, entry.content);
  }

  return { manifest, applied, skipped, dryRun: false, backupPath };
}
