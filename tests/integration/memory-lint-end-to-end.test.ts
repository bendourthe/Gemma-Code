/**
 * Integration test for the `/memory lint` command surface.
 *
 * Exercises `parseMemoryLintArgs` + `runMemoryLint` end-to-end against a real
 * MemoryStore and a real workspace directory (the report file is written to
 * disk and re-read for verification).
 *
 * No Ollama server required.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/storage/MemoryStore.js";
import {
  parseMemoryLintArgs,
  runMemoryLint,
} from "../../modules/coding/commands/memoryLintCommand.js";

describe("/memory lint integration", () => {
  let store: MemoryStore;
  let workspaceRoot: string;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-lint-int-"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("writes a Markdown report to .nexus/memory-health.md", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "real.ts"), "// real");
    await store.save("Touched real.ts during refactor", "fact");
    await store.save("Renamed src/missing/module.ts during cleanup", "fact");

    const result = await runMemoryLint(parseMemoryLintArgs(""), {
      memoryStore: store,
      workspaceRoot,
    });

    expect(result.reportPath).toBeDefined();
    const target = path.join(workspaceRoot, ".nexus", "memory-health.md");
    expect(fs.existsSync(target)).toBe(true);

    const md = fs.readFileSync(target, "utf8");
    expect(md).toContain("# Memory Health Report");
    expect(md).toContain("src/missing/module.ts");
    expect(md).toMatch(/issues across 2 entries/);
  });

  it("--apply does not write a report", async () => {
    await store.save("anything", "fact");
    const result = await runMemoryLint(parseMemoryLintArgs("--apply"), {
      memoryStore: store,
      workspaceRoot,
    });

    expect(result.mode).toBe("apply");
    const target = path.join(workspaceRoot, ".nexus", "memory-health.md");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("completes the default scope in under 5s on a 10K-row store", async () => {
    // 10K saves through MemoryStore.save() take a long time because each
    // INSERT is its own transaction; populate the table directly via the
    // private DB handle for setup. The lint pass is what we are timing.
    const rawDb = (
      store as unknown as {
        _db: {
          prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
          transaction: <T>(fn: (rows: T[]) => void) => (rows: T[]) => void;
        };
      }
    )._db;
    const insert = rawDb.prepare(
      `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at, corroboration_count)
       VALUES (?, NULL, ?, 'fact', NULL, ?, ?, 1)`,
    );
    const now = Date.now();
    const tx = rawDb.transaction((rows: Array<[string, string]>) => {
      for (const [id, content] of rows) insert.run(id, content, now, now);
    });
    const rows: Array<[string, string]> = [];
    for (let i = 0; i < 10000; i++) {
      rows.push([`row-${i}`, `synthetic memory entry number ${i}`]);
    }
    tx(rows);

    const t0 = Date.now();
    const result = await runMemoryLint(parseMemoryLintArgs(""), {
      memoryStore: store,
      workspaceRoot,
    });
    const elapsed = Date.now() - t0;

    expect(result.report?.counts.totalEntries).toBe(10000);
    expect(elapsed).toBeLessThan(5000);
  });
});
