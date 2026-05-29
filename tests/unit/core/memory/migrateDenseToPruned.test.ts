import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DenseIndex } from "../../../../core/memory/DenseIndex.js";
import { PrunedDenseIndex } from "../../../../core/memory/PrunedDenseIndex.js";
import { migrateDenseToPruned } from "../../../../core/memory/migrateDenseToPruned.js";
import { LocalEmbedder, hashEmbed } from "../../../../core/memory/LocalEmbedder.js";

/**
 * v1.2.0 Phase 4.3 -- migration script unit tests.
 *
 * Coverage:
 *   - Builds a pruned index from a saved DenseIndex + text map
 *   - Backs up the original; skipBackup honored
 *   - Idempotent: re-runs are no-ops
 *   - Drops entries whose text is missing
 *   - no-input branch when DenseIndex file is missing
 *   - Progress callback fires periodically
 */

let tmpDir = "";
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-migrate-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeEmbedder(): LocalEmbedder {
  return new LocalEmbedder({ forceFallback: true });
}

async function buildSourceIndex(n: number): Promise<{
  densePath: string;
  textMap: Map<string, string>;
}> {
  const dense = new DenseIndex();
  const texts = new Map<string, string>();
  for (let i = 0; i < n; i += 1) {
    const id = `e${i}`;
    const text = `document ${i} contains keyword-${i % 5} body text`;
    dense.add(id, hashEmbed(text));
    texts.set(id, text);
  }
  const densePath = path.join(tmpDir, "dense.bin");
  await dense.save(densePath);
  return { densePath, textMap: texts };
}

describe("migrateDenseToPruned", () => {
  it("builds a pruned index from a dense save file", async () => {
    const { densePath, textMap } = await buildSourceIndex(15);
    const prunedPath = path.join(tmpDir, "dense-pruned.bin");
    const result = await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => textMap.get(id) ?? null,
      timestamp: "2026-05-26T12-00-00",
    });
    expect(result.skipped).toBe(false);
    expect(result.entriesMigrated).toBe(15);
    expect(result.entriesDropped).toBe(0);
    expect(result.backupPath).not.toBeNull();
    const stat = await fs.stat(prunedPath);
    expect(stat.size).toBeGreaterThan(0);

    const loaded = await PrunedDenseIndex.load(prunedPath, makeEmbedder());
    expect(loaded.size).toBe(15);
  });

  it("creates a backup file alongside the original", async () => {
    const { densePath, textMap } = await buildSourceIndex(5);
    const prunedPath = path.join(tmpDir, "dense-pruned.bin");
    const result = await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => textMap.get(id) ?? null,
      timestamp: "2026-05-26",
    });
    expect(result.backupPath).toContain("backup-2026-05-26");
    expect(result.backupPath).not.toBeNull();
    const stat = await fs.stat(result.backupPath!);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("skipBackup omits the backup file", async () => {
    const { densePath, textMap } = await buildSourceIndex(3);
    const prunedPath = path.join(tmpDir, "dense-pruned.bin");
    const result = await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => textMap.get(id) ?? null,
      skipBackup: true,
    });
    expect(result.backupPath).toBeNull();
  });

  it("is idempotent: second run is a no-op", async () => {
    const { densePath, textMap } = await buildSourceIndex(5);
    const prunedPath = path.join(tmpDir, "dense-pruned.bin");
    await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => textMap.get(id) ?? null,
    });
    const second = await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => textMap.get(id) ?? null,
    });
    expect(second.skipped).toBe(true);
    expect(second.skipReason).toBe("already-migrated");
  });

  it("drops entries when loadText returns null", async () => {
    const { densePath, textMap } = await buildSourceIndex(10);
    const prunedPath = path.join(tmpDir, "dense-pruned.bin");
    const result = await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => {
        // Drop every odd-indexed entry by returning null.
        const t = textMap.get(id);
        if (!t) return null;
        const n = Number(id.slice(1));
        return n % 2 === 0 ? t : null;
      },
    });
    expect(result.entriesMigrated).toBe(5);
    expect(result.entriesDropped).toBe(5);
  });

  it("returns no-input when the source file is missing", async () => {
    const result = await migrateDenseToPruned({
      densePath: path.join(tmpDir, "missing.bin"),
      prunedPath: path.join(tmpDir, "pruned.bin"),
      embedder: makeEmbedder(),
      loadText: () => null,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-input");
  });

  it("calls onProgress at least once for large corpora", async () => {
    const { densePath, textMap } = await buildSourceIndex(250);
    const prunedPath = path.join(tmpDir, "dense-pruned.bin");
    const calls: Array<{ processed: number; total: number }> = [];
    await migrateDenseToPruned({
      densePath,
      prunedPath,
      embedder: makeEmbedder(),
      loadText: (id) => textMap.get(id) ?? null,
      onProgress: (info) => calls.push(info),
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const last = calls[calls.length - 1]!;
    expect(last.total).toBe(250);
  });
});
