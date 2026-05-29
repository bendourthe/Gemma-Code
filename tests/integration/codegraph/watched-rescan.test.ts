/**
 * v1.2.0 Phase 6.1 -- integration test for `WatchedRepoScanner`.
 *
 * Confirms that:
 *   - The Phase 3.6 benchmark fixture still indexes cleanly with the
 *     unmodified `RepoScanner` (so the refactor is non-breaking).
 *   - `WatchedRepoScanner.reindex(...)` updates the store for the
 *     supplied delta only, without touching unrelated rows.
 *   - A `removed` event purges the file + its symbols.
 *   - An untouched re-scan (same hash) is a no-op.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { SqliteGraphStore } from "../../../core/codegraph/store/index.js";
import {
  RepoScanner,
  WatchedRepoScanner,
} from "../../../core/codegraph/scanner/index.js";

interface Harness {
  readonly root: string;
  readonly store: SqliteGraphStore;
  readonly scanner: RepoScanner;
  readonly watched: WatchedRepoScanner;
  cleanup(): void;
}

function makeHarness(): Harness {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-watched-"));
  fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "src", "a.ts"),
    `export function alpha() {\n  return beta();\n}\n\nexport function beta() { return 1; }\n`,
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "b.ts"),
    `export function gamma() {\n  return 2;\n}\n`,
  );
  const dbPath = path.join(tmpDir, "graph.db");
  const store = new SqliteGraphStore({ dbPath });
  const scanner = new RepoScanner({ store });
  scanner.scan(tmpDir);
  const watched = new WatchedRepoScanner({
    store,
    rootPath: tmpDir,
    scanner,
  });
  return {
    root: tmpDir,
    store,
    scanner,
    watched,
    cleanup() {
      try {
        store.close();
      } catch {
        // ignore
      }
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

describe("WatchedRepoScanner", () => {
  let harness: Harness | null = null;
  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  it("re-indexes a modified file in isolation", () => {
    harness = makeHarness();
    const { root, store, watched } = harness;
    expect(store.findSymbolByName("alpha").length).toBe(1);
    expect(store.findSymbolByName("gamma").length).toBe(1);
    // Edit a.ts: rename alpha -> alphax.
    fs.writeFileSync(
      path.join(root, "src", "a.ts"),
      `export function alphax() {\n  return beta();\n}\n\nexport function beta() { return 1; }\n`,
    );
    const summary = watched.reindex([
      { path: "src/a.ts", kind: "modified" },
    ]);
    expect(summary.filesReindexed).toBe(1);
    expect(summary.filesRemoved).toBe(0);
    expect(store.findSymbolByName("alpha").length).toBe(0);
    expect(store.findSymbolByName("alphax").length).toBe(1);
    // Unrelated file is untouched.
    expect(store.findSymbolByName("gamma").length).toBe(1);
  });

  it("removes a deleted file's symbols", () => {
    harness = makeHarness();
    const { root, store, watched } = harness;
    expect(store.findSymbolByName("gamma").length).toBe(1);
    fs.unlinkSync(path.join(root, "src", "b.ts"));
    const summary = watched.reindex([
      { path: "src/b.ts", kind: "removed" },
    ]);
    expect(summary.filesRemoved).toBe(1);
    expect(store.findSymbolByName("gamma").length).toBe(0);
    expect(store.findFileByPath("src/b.ts")).toBeUndefined();
  });

  it("treats a same-hash modify as a no-op", () => {
    harness = makeHarness();
    const { watched } = harness;
    const summary = watched.reindex([
      { path: "src/a.ts", kind: "modified" },
    ]);
    expect(summary.filesReindexed).toBe(0);
  });

  it("skips files with unknown language extensions", () => {
    harness = makeHarness();
    const { root, watched } = harness;
    fs.writeFileSync(path.join(root, "README.md"), "# hello\n");
    const summary = watched.reindex([
      { path: "README.md", kind: "modified" },
    ]);
    expect(summary.filesReindexed).toBe(0);
    expect(summary.filesSkippedUnknownLang).toBe(1);
  });

  it("treats a missing file on modify as a removal", () => {
    harness = makeHarness();
    const { root, store, watched } = harness;
    fs.unlinkSync(path.join(root, "src", "b.ts"));
    const summary = watched.reindex([
      { path: "src/b.ts", kind: "modified" },
    ]);
    expect(summary.filesRemoved).toBe(1);
    expect(store.findFileByPath("src/b.ts")).toBeUndefined();
  });
});
