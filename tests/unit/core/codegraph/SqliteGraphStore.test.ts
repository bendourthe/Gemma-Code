/**
 * v1.2.0 Phase 3.2 -- unit tests for the SQLite-backed graph store.
 *
 * Covers CRUD across all three tables, the FTS5 search path, the WAL
 * pragma (verified by re-opening the file), foreign-key cascade on file
 * deletion, and the per-file cleanup helpers the scanner uses on
 * incremental re-index.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteGraphStore, resolveCodegraphDbPath } from "../../../../core/codegraph/store/index.js";

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-store-"));
  return path.join(dir, "graph.db");
}

describe("SqliteGraphStore", () => {
  let dbPath: string;
  let store: SqliteGraphStore;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    store = new SqliteGraphStore({ dbPath });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("creates the DB file with WAL journal mode", () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    const journal = store["_db"].pragma("journal_mode", { simple: true });
    expect(String(journal).toLowerCase()).toBe("wal");
  });

  it("upserts a file, looks it up, and survives an update", () => {
    const id = store.upsertFile({
      path: "src/foo.ts",
      language: "typescript",
      lastIndexedAt: 1000,
      contentHash: "abc",
    });
    expect(id).toBeGreaterThan(0);

    const row = store.findFileByPath("src/foo.ts");
    expect(row?.path).toBe("src/foo.ts");
    expect(row?.contentHash).toBe("abc");

    const id2 = store.upsertFile({
      path: "src/foo.ts",
      language: "typescript",
      lastIndexedAt: 2000,
      contentHash: "def",
    });
    expect(id2).toBe(id);
    expect(store.findFileByPath("src/foo.ts")?.contentHash).toBe("def");
  });

  it("inserts symbols and finds them by name + by id", () => {
    const fileId = store.upsertFile({
      path: "src/bar.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "h1",
    });
    const symId = store.upsertSymbol({
      fileId,
      name: "redactSecrets",
      kind: "function",
      lineStart: 10,
      lineEnd: 25,
      signatureText: "function redactSecrets(input: string): string",
    });
    expect(symId).toBeGreaterThan(0);

    const byId = store.findSymbolById(symId);
    expect(byId?.name).toBe("redactSecrets");

    const byName = store.findSymbolByName("redactSecrets");
    expect(byName.length).toBe(1);
    expect(byName[0].kind).toBe("function");
  });

  it("FTS5 search returns matching symbols", () => {
    const fileId = store.upsertFile({
      path: "src/auth.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "h2",
    });
    store.upsertSymbol({
      fileId,
      name: "validateToken",
      kind: "function",
      lineStart: 1,
      lineEnd: 5,
      signatureText: "function validateToken(token: string): boolean",
    });
    store.upsertSymbol({
      fileId,
      name: "issueToken",
      kind: "function",
      lineStart: 6,
      lineEnd: 9,
      signatureText: "function issueToken(): string",
    });

    const hits = store.searchSymbols("token");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.map((h) => h.name).sort()).toEqual([
      "issueToken",
      "validateToken",
    ]);
  });

  it("records call edges and resolves callers / callees by name", () => {
    const fileA = store.upsertFile({
      path: "src/a.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "ha",
    });
    const callerId = store.upsertSymbol({
      fileId: fileA,
      name: "handler",
      kind: "function",
      lineStart: 1,
      lineEnd: 20,
      signatureText: "function handler()",
    });
    const calleeId = store.upsertSymbol({
      fileId: fileA,
      name: "redactSecrets",
      kind: "function",
      lineStart: 21,
      lineEnd: 30,
      signatureText: "function redactSecrets()",
    });
    store.upsertCallEdge({
      callerSymbolId: callerId,
      calleeSymbolId: calleeId,
      line: 12,
      kind: "call",
    });

    const callers = store.findCallersOf("redactSecrets");
    expect(callers.length).toBe(1);
    expect(callers[0].symbolName).toBe("handler");
    expect(callers[0].filePath).toBe("src/a.ts");

    const callees = store.findCalleesOf("handler");
    expect(callees.length).toBe(1);
    expect(callees[0].symbolName).toBe("redactSecrets");
  });

  it("deleteSymbolsForFile cascades to FTS rows and call edges", () => {
    const fileId = store.upsertFile({
      path: "src/c.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "hc",
    });
    const a = store.upsertSymbol({
      fileId,
      name: "alpha",
      kind: "function",
      lineStart: 1,
      lineEnd: 5,
      signatureText: "fn alpha",
    });
    const b = store.upsertSymbol({
      fileId,
      name: "beta",
      kind: "function",
      lineStart: 6,
      lineEnd: 10,
      signatureText: "fn beta",
    });
    store.upsertCallEdge({ callerSymbolId: a, calleeSymbolId: b, line: 3, kind: "call" });

    expect(store.searchSymbols("alpha").length).toBe(1);
    const removed = store.deleteSymbolsForFile(fileId);
    expect(removed).toBe(2);
    expect(store.findSymbolByName("alpha").length).toBe(0);
    expect(store.searchSymbols("alpha").length).toBe(0);
    expect(store.findCallersOf("beta").length).toBe(0);
  });

  it("pruneRemovedFiles drops files not in the still-present set", () => {
    store.upsertFile({
      path: "src/keep.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "k",
    });
    store.upsertFile({
      path: "src/gone.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "g",
    });
    const removed = store.pruneRemovedFiles(["src/keep.ts"]);
    expect(removed).toBe(1);
    expect(store.findFileByPath("src/gone.ts")).toBeUndefined();
    expect(store.findFileByPath("src/keep.ts")).toBeDefined();
  });

  it("listFiles returns rows sorted by path", () => {
    store.upsertFile({ path: "z.ts", language: "typescript", lastIndexedAt: 0, contentHash: "z" });
    store.upsertFile({ path: "a.ts", language: "typescript", lastIndexedAt: 0, contentHash: "a" });
    const files = store.listFiles();
    expect(files.map((f) => f.path)).toEqual(["a.ts", "z.ts"]);
  });

  it("deleteCallerEdgesForFile removes only edges originating in that file", () => {
    const f1 = store.upsertFile({ path: "f1.ts", language: "typescript", lastIndexedAt: 0, contentHash: "1" });
    const f2 = store.upsertFile({ path: "f2.ts", language: "typescript", lastIndexedAt: 0, contentHash: "2" });
    const s1 = store.upsertSymbol({
      fileId: f1,
      name: "callerA",
      kind: "function",
      lineStart: 1,
      lineEnd: 2,
      signatureText: "fn callerA",
    });
    const s2 = store.upsertSymbol({
      fileId: f2,
      name: "callerB",
      kind: "function",
      lineStart: 1,
      lineEnd: 2,
      signatureText: "fn callerB",
    });
    const target = store.upsertSymbol({
      fileId: f2,
      name: "target",
      kind: "function",
      lineStart: 3,
      lineEnd: 4,
      signatureText: "fn target",
    });
    store.upsertCallEdge({ callerSymbolId: s1, calleeSymbolId: target, line: 1, kind: "call" });
    store.upsertCallEdge({ callerSymbolId: s2, calleeSymbolId: target, line: 1, kind: "call" });
    expect(store.findCallersOf("target").length).toBe(2);

    const removed = store.deleteCallerEdgesForFile(f1);
    expect(removed).toBe(1);
    const callersAfter = store.findCallersOf("target");
    expect(callersAfter.length).toBe(1);
    expect(callersAfter[0].symbolName).toBe("callerB");
  });

  it("FTS sub-50ms target on a 10k-symbol fixture", () => {
    const fileId = store.upsertFile({
      path: "fixture.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "fx",
    });
    store.transaction(() => {
      for (let i = 0; i < 10_000; i += 1) {
        store.upsertSymbol({
          fileId,
          name: `sym${i}`,
          kind: "function",
          lineStart: i,
          lineEnd: i,
          signatureText: `function sym${i}(arg${i % 7}: string): void`,
        });
      }
    });
    const start = process.hrtime.bigint();
    const hits = store.searchSymbols("sym1234");
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    expect(hits.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(50);
  });

  it("persists across process-equivalent restarts", () => {
    const fileId = store.upsertFile({
      path: "persist.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "p",
    });
    store.upsertSymbol({
      fileId,
      name: "willSurvive",
      kind: "function",
      lineStart: 1,
      lineEnd: 2,
      signatureText: "fn willSurvive",
    });
    store.close();

    const reopen = new SqliteGraphStore({ dbPath });
    try {
      expect(reopen.findSymbolByName("willSurvive").length).toBe(1);
    } finally {
      reopen.close();
    }
  });

  it("resolveCodegraphDbPath sanitizes the fingerprint", () => {
    const dbp = resolveCodegraphDbPath("my repo/../weird");
    expect(dbp).toMatch(/codegraph[\\/]my_repo_\.\._weird\.db$/);
  });
});
