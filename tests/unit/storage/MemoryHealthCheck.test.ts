import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";
import { MemoryHealthCheck } from "../../../src/storage/MemoryHealthCheck.js";

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

describe("MemoryHealthCheck", () => {
  let store: MemoryStore;
  let workspaceRoot: string;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-mhc-"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function setLastAccessed(id: string, ts: number): void {
    // Direct DB write through a private helper would be invasive; expose the
    // mutation via a fresh saved row's update path: re-save then back-date.
    // The MemoryStore does not expose a back-date API, so we open the same
    // SQLite file -- here we used :memory: so we go through a small reach-in.
    // Tests run against an in-memory DB so we use a private cast.
    const db = (store as unknown as { _db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } })._db;
    db.prepare("UPDATE memories SET accessed_at = ?, access_count = 1 WHERE id = ?").run(ts, id);
  }

  it("flags stale entries (older than 60 days, accessCount <= 1)", async () => {
    const fresh = await store.save("fresh entry", "fact");
    const stale = await store.save("stale entry", "fact");
    setLastAccessed(stale.id, Date.now() - SIXTY_DAYS_MS - 1000);

    const check = new MemoryHealthCheck({ memoryStore: store, workspaceRoot });
    const report = await check.run();

    expect(report.issues.stale.map((s) => s.id)).toContain(stale.id);
    expect(report.issues.stale.map((s) => s.id)).not.toContain(fresh.id);
  });

  it("flags broken file path references", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "exists.ts"), "// real");
    await store.save(
      "We renamed src/legacy/missing-file.ts to keep things tidy",
      "fact",
    );
    await store.save("We modified exists.ts and verified the result", "fact");

    const check = new MemoryHealthCheck({ memoryStore: store, workspaceRoot });
    const report = await check.run();

    const paths = report.issues.brokenPath.map((p) => p.missingPath);
    expect(paths).toContain("src/legacy/missing-file.ts");
    expect(paths).not.toContain("exists.ts");
  });

  it("flags rows with NULL embedding when embedder is configured", async () => {
    const a = await store.save("entry without embedding", "fact");

    const check = new MemoryHealthCheck({
      memoryStore: store,
      workspaceRoot,
      embeddingEnabled: true,
    });
    const report = await check.run();

    expect(report.issues.embeddingFailed.map((i) => i.id)).toContain(a.id);
  });

  it("does NOT flag missing embeddings when embedder is disabled", async () => {
    await store.save("entry without embedding", "fact");
    const check = new MemoryHealthCheck({
      memoryStore: store,
      workspaceRoot,
      embeddingEnabled: false,
    });
    const report = await check.run();
    expect(report.issues.embeddingFailed).toHaveLength(0);
  });

  it("flags duplicate entries by Jaccard >= 0.9", async () => {
    const a = await store.save(
      "The backend runs on port eleven thousand four hundred thirty five",
      "fact",
    );
    const b = await store.save(
      "The backend runs on port eleven thousand four hundred thirty four",
      "fact",
    );

    const check = new MemoryHealthCheck({ memoryStore: store, workspaceRoot });
    const report = await check.run();

    const dup = report.issues.duplicate.find(
      (d) =>
        (d.olderId === a.id && d.newerId === b.id) ||
        (d.olderId === b.id && d.newerId === a.id),
    );
    expect(dup).toBeDefined();
    expect(dup!.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it("returns no false positives on a clean fixture", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "real.ts"), "// real");
    await store.save("Edited real.ts to add a comment", "fact");

    const check = new MemoryHealthCheck({ memoryStore: store, workspaceRoot });
    const report = await check.run();

    expect(report.issues.stale).toHaveLength(0);
    expect(report.issues.brokenPath).toHaveLength(0);
    expect(report.issues.duplicate).toHaveLength(0);
  });

  it("writes a parseable Markdown report", async () => {
    await store.save("anything", "fact");
    const check = new MemoryHealthCheck({ memoryStore: store, workspaceRoot });
    const report = await check.run();
    const target = check.writeReportToDisk(report);

    expect(fs.existsSync(target)).toBe(true);
    const md = fs.readFileSync(target, "utf8");
    expect(md).toContain("# Memory Health Report");
    expect(md).toContain("## Stale entries");
    expect(md).toContain("## Broken path references");
    expect(md).toContain("## Embedding failures");
    expect(md).toContain("## Duplicates");
    expect(md).toMatch(/issues across \d+ entries/);
  });

  it("redacts content matching secret-path patterns", async () => {
    const a = await store.save(
      "We loaded creds from .env.production for the test",
      "fact",
    );
    // Force the row into the stale tier so it surfaces in the report; only
    // surfaced bodies need redaction.
    setLastAccessed(a.id, Date.now() - SIXTY_DAYS_MS - 1000);

    const check = new MemoryHealthCheck({ memoryStore: store, workspaceRoot });
    const report = await check.run();
    const md = check.renderMarkdown(report);

    expect(md).not.toContain(".env.production");
    expect(md.toLowerCase()).toContain("redacted");
  });
});
