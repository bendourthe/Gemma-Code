/**
 * v2.2.0 Phase 7 (7.4) -- local data export / import.
 *
 * The user asked to move everything to another machine. These pin the
 * safety properties that matter more than the happy path: credentials are
 * never exported by accident, a corrupt or hostile archive changes nothing,
 * and an interrupted export never leaves a file that looks complete.
 */

import { promises as fs, existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CATEGORIES,
  TRANSFER_SCHEMA_VERSION,
  TransferError,
  exportData,
  importData,
  readTar,
} from "../../../desktop/sidecar/src/data/transferRuntime";
import * as paths from "../../../core/storage/paths";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-transfer-"));
  // Point every category at a scratch home; nothing here touches ~/.nexus.
  vi.spyOn(paths, "nexusHome").mockReturnValue(home);
  vi.spyOn(paths, "nexusAiHome").mockReturnValue(path.join(home, "nexus-ai"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function seed(rel: string, content: string): void {
  const abs = path.join(home, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

describe("categories", () => {
  it("marks credentials as sensitive", () => {
    const creds = CATEGORIES.find((c) => c.id === "credentials");
    expect(creds?.sensitive).toBe(true);
  });

  it("gives every category a human label and description", () => {
    for (const c of CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });
});

describe("exportData", () => {
  it("packs the requested categories with a manifest and checksums", async () => {
    seed("chat/explorer.db", "chatdata");
    seed("settings.json", "{}");
    const out = path.join(home, "out", "pack.tar.gz");

    const result = await exportData({ categories: ["chats", "preferences"], outPath: out });

    expect(existsSync(out)).toBe(true);
    expect(result.manifest.schemaVersion).toBe(TRANSFER_SCHEMA_VERSION);
    const ids = result.manifest.categories.map((c) => c.id).sort();
    expect(ids).toEqual(["chats", "preferences"]);
    for (const c of result.manifest.categories) {
      expect(c.sha256).toHaveLength(64);
    }
  });

  it("EXCLUDES credentials unless explicitly opted in", async () => {
    seed("credentials/tokens.json", "secret");
    seed("settings.json", "{}");
    const out = path.join(home, "out", "no-creds.tar.gz");

    const result = await exportData({
      categories: ["credentials", "preferences"],
      outPath: out,
    });

    // An export is a file that gets emailed and forgotten; the default must
    // never carry tokens.
    expect(result.manifest.categories.map((c) => c.id)).not.toContain("credentials");
  });

  it("includes credentials only on an explicit opt-in", async () => {
    seed("credentials/tokens.json", "secret");
    const out = path.join(home, "out", "with-creds.tar.gz");
    const result = await exportData({
      categories: ["credentials"],
      outPath: out,
      includeCredentials: true,
    });
    expect(result.manifest.categories.map((c) => c.id)).toContain("credentials");
  });

  it("reports categories that held nothing rather than silently dropping them", async () => {
    const out = path.join(home, "out", "empty.tar.gz");
    const result = await exportData({ categories: ["generations"], outPath: out });
    expect(result.empty).toContain("generations");
  });

  it("leaves no partial file behind", async () => {
    seed("settings.json", "{}");
    const out = path.join(home, "out", "atomic.tar.gz");
    await exportData({ categories: ["preferences"], outPath: out });
    // The writer stages to `.partial` and renames, so a crash cannot leave a
    // truncated archive that a later import would treat as complete.
    expect(existsSync(`${out}.partial`)).toBe(false);
  });
});

describe("importData", () => {
  async function makeArchive(): Promise<string> {
    seed("chat/explorer.db", "chatdata");
    const out = path.join(home, "out", "round.tar.gz");
    await exportData({ categories: ["chats"], outPath: out });
    return out;
  }

  it("round-trips an archive it produced", async () => {
    const archive = await makeArchive();
    const result = await importData({ archivePath: archive, dryRun: true });
    expect(result.applied).toContain("chats");
    expect(result.dryRun).toBe(true);
  });

  it("dry run writes nothing and takes no backup", async () => {
    const archive = await makeArchive();
    const result = await importData({ archivePath: archive, dryRun: true });
    expect(result.backupPath).toBeNull();
    expect(existsSync(path.join(home, "import-staging"))).toBe(false);
  });

  it("takes a pre-import backup on a real apply", async () => {
    const archive = await makeArchive();
    const result = await importData({ archivePath: archive });
    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath as string)).toBe(true);
  });

  it("refuses a missing archive", async () => {
    await expect(
      importData({ archivePath: path.join(home, "nope.tar.gz") }),
    ).rejects.toBeInstanceOf(TransferError);
  });

  it("refuses an archive with no manifest", async () => {
    const bogus = path.join(home, "bogus.tar.gz");
    // Valid gzip, but not an archive we wrote.
    const { gzipSync } = await import("node:zlib");
    writeFileSync(bogus, gzipSync(Buffer.alloc(1024)));
    await expect(importData({ archivePath: bogus })).rejects.toThrow(/manifest/);
  });

  it("refuses a schema-mismatched archive without applying anything", async () => {
    const archive = await makeArchive();
    // Bump the schema version IN PLACE. A same-length substitution keeps the
    // tar entry size field honest; changing the byte count would corrupt the
    // archive and we would be testing the wrong rejection.
    const { gunzipSync, gzipSync } = await import("node:zlib");
    const raw = gunzipSync(await fs.readFile(archive));
    const patched = Buffer.from(
      raw.toString("binary").replace('"schemaVersion": 1', '"schemaVersion": 9'),
      "binary",
    );
    const bad = path.join(home, "future.tar.gz");
    writeFileSync(bad, gzipSync(patched));

    await expect(importData({ archivePath: bad })).rejects.toThrow(/schema/);
    expect(existsSync(path.join(home, "import-staging"))).toBe(false);
  });

  it("can restrict an import to selected categories", async () => {
    seed("chat/explorer.db", "chatdata");
    seed("settings.json", "{}");
    const out = path.join(home, "out", "multi.tar.gz");
    await exportData({ categories: ["chats", "preferences"], outPath: out });

    const result = await importData({
      archivePath: out,
      categories: ["chats"],
      dryRun: true,
    });
    expect(result.applied).toEqual(["chats"]);
    expect(result.skipped).toContain("preferences");
  });
});

describe("readTar", () => {
  it("returns an empty list for a buffer of zero blocks", () => {
    expect(readTar(Buffer.alloc(1024))).toEqual([]);
  });
});
