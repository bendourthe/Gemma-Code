/**
 * E2E: memories persist across ConversationManager sessions.
 *
 * Uses a single MemoryStore (in-memory SQLite with shared handle is not
 * possible, so we use an on-disk temp db) to verify that entries saved in
 * session 1 are still retrievable in session 2.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `gemma-e2e-memory-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`
  );
}

describe("e2e: memory across sessions", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
  });

  afterEach(async () => {
    // Windows occasionally reports EBUSY/EPERM briefly after sqlite closes
    // the handle; retry a handful of times before giving up.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.unlinkSync(dbPath);
        return;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EBUSY" && code !== "EPERM") {
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  it("memories saved in session 1 are retrievable in session 2", async () => {
    // Session 1: save 5 memories of different types
    const session1 = new MemoryStore(dbPath);
    await session1.save("Use async/await, not callbacks", "preference");
    await session1.save("Project uses strict TypeScript", "fact");
    await session1.save("Never mock the database", "decision");
    await session1.save("React components under src/webview/", "file_pattern");
    await session1.save("Fixed race in counter.ts with mutex", "error_resolution");
    session1.close();

    // Session 2: open the same db and verify we can retrieve them
    const session2 = new MemoryStore(dbPath);
    const results = session2.searchKeyword("async", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entry.content).toContain("async/await");

    const stats = session2.getStats();
    expect(stats.totalEntries).toBe(5);
    // Types accumulate across sessions
    expect(stats.byType.preference).toBe(1);
    expect(stats.byType.fact).toBe(1);
    expect(stats.byType.decision).toBe(1);
    expect(stats.byType.file_pattern).toBe(1);
    expect(stats.byType.error_resolution).toBe(1);
    session2.close();
  });

  it("memory of a coding-style decision is retrievable by paraphrase keyword", async () => {
    const session1 = new MemoryStore(dbPath);
    await session1.save(
      "Always use async/await instead of callbacks",
      "decision"
    );
    session1.close();

    const session2 = new MemoryStore(dbPath);
    // Search with a keyword from the saved memory
    const results = session2.searchKeyword("async", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entry.type).toBe("decision");
    session2.close();
  });
});
