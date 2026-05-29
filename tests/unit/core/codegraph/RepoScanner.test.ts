/**
 * v1.2.0 Phase 3.3 -- scanner tests for TS / Python / Rust / Go.
 *
 * Each language fixture proves the regex extractor pulls out at least one
 * function / class symbol and at least one call-edge, plus incremental
 * re-index honors the content-hash short-circuit.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoScanner } from "../../../../core/codegraph/scanner/index.js";
import { SqliteGraphStore } from "../../../../core/codegraph/store/index.js";

interface Fixture {
  readonly rootDir: string;
  readonly dbPath: string;
}

function setupFixture(files: Record<string, string>): Fixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-scan-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
  const dbPath = path.join(rootDir, ".graph.db");
  return { rootDir, dbPath };
}

function teardown(f: Fixture | null): void {
  if (!f) return;
  try {
    fs.rmSync(f.rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

describe("RepoScanner", () => {
  let fx: Fixture | null = null;
  let store: SqliteGraphStore | null = null;

  beforeEach(() => {
    fx = null;
    store = null;
  });

  afterEach(() => {
    store?.close();
    teardown(fx);
  });

  it("indexes a TypeScript fixture with function + class + method + call edge", () => {
    fx = setupFixture({
      "src/foo.ts": [
        "export function redactSecrets(input: string): string {",
        "  return input;",
        "}",
        "",
        "export class Logger {",
        "  log(message: string): void {",
        "    redactSecrets(message);",
        "  }",
        "}",
      ].join("\n"),
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    const report = scanner.scan(fx.rootDir);
    expect(report.filesIndexed).toBe(1);
    expect(report.symbolsUpserted).toBeGreaterThanOrEqual(3);

    const redact = store.findSymbolByName("redactSecrets");
    expect(redact.length).toBe(1);
    expect(redact[0].kind).toBe("function");

    const logger = store.findSymbolByName("Logger");
    expect(logger.length).toBe(1);
    expect(logger[0].kind).toBe("class");

    const callers = store.findCallersOf("redactSecrets");
    expect(callers.length).toBe(1);
    expect(callers[0].symbolName).toBe("log");
  });

  it("indexes a Python fixture with def + class", () => {
    fx = setupFixture({
      "pkg/mod.py": [
        "def add(a, b):",
        "    return a + b",
        "",
        "class Calculator:",
        "    def total(self, items):",
        "        return add(items[0], items[1])",
      ].join("\n"),
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    const report = scanner.scan(fx.rootDir);
    expect(report.filesIndexed).toBe(1);

    expect(store.findSymbolByName("add").length).toBe(1);
    expect(store.findSymbolByName("Calculator").length).toBe(1);
    const callers = store.findCallersOf("add");
    expect(callers.length).toBeGreaterThanOrEqual(1);
  });

  it("indexes a Rust fixture with fn + struct + trait", () => {
    fx = setupFixture({
      "src/lib.rs": [
        "pub struct Point { x: i32, y: i32 }",
        "",
        "pub trait Shape { fn area(&self) -> i32; }",
        "",
        "pub fn double(value: i32) -> i32 {",
        "    value * 2",
        "}",
        "",
        "pub fn apply(value: i32) -> i32 {",
        "    double(value)",
        "}",
      ].join("\n"),
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    scanner.scan(fx.rootDir);

    expect(store.findSymbolByName("Point").length).toBe(1);
    expect(store.findSymbolByName("Shape").length).toBe(1);
    expect(store.findSymbolByName("double").length).toBe(1);
    const callers = store.findCallersOf("double");
    expect(callers.length).toBe(1);
    expect(callers[0].symbolName).toBe("apply");
  });

  it("indexes a Go fixture with func + method + type struct + call edge", () => {
    fx = setupFixture({
      "main.go": [
        "package main",
        "",
        "type Counter struct { value int }",
        "",
        "func increment(n int) int {",
        "    return n + 1",
        "}",
        "",
        "func (c *Counter) Bump() {",
        "    c.value = increment(c.value)",
        "}",
      ].join("\n"),
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    scanner.scan(fx.rootDir);

    expect(store.findSymbolByName("Counter").length).toBe(1);
    expect(store.findSymbolByName("increment").length).toBe(1);
    expect(store.findSymbolByName("Bump").length).toBe(1);
    const callers = store.findCallersOf("increment");
    expect(callers.length).toBe(1);
    expect(callers[0].symbolName).toBe("Bump");
  });

  it("skips unchanged files on incremental re-index", () => {
    fx = setupFixture({
      "src/unchanged.ts": "export function noop() { return 1; }\n",
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    const r1 = scanner.scan(fx.rootDir);
    expect(r1.filesIndexed).toBe(1);
    expect(r1.filesSkippedUnchanged).toBe(0);

    const r2 = scanner.scan(fx.rootDir);
    expect(r2.filesIndexed).toBe(0);
    expect(r2.filesSkippedUnchanged).toBe(1);
  });

  it("honors .nexusignore", () => {
    fx = setupFixture({
      ".nexusignore": "ignored/\n",
      "src/keep.ts": "export function keep() { return 1; }\n",
      "ignored/skip.ts": "export function skip() { return 1; }\n",
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    scanner.scan(fx.rootDir);

    expect(store.findSymbolByName("keep").length).toBe(1);
    expect(store.findSymbolByName("skip").length).toBe(0);
  });

  it("respects per-file size cap", () => {
    const big = "// padding\n".repeat(2000); // ~22 KB
    fx = setupFixture({ "src/big.ts": big });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store, maxFileBytes: 1000 });
    const r = scanner.scan(fx.rootDir);
    expect(r.filesSkippedSizeCap).toBe(1);
    expect(r.filesIndexed).toBe(0);
  });

  it("prunes files that have disappeared since the last scan", () => {
    fx = setupFixture({
      "a.ts": "export function a() {}",
      "b.ts": "export function b() {}",
    });
    store = new SqliteGraphStore({ dbPath: fx.dbPath });
    const scanner = new RepoScanner({ store });
    scanner.scan(fx.rootDir);
    expect(store.findFileByPath("b.ts")).toBeDefined();

    fs.unlinkSync(path.join(fx.rootDir, "b.ts"));
    scanner.scan(fx.rootDir);
    expect(store.findFileByPath("b.ts")).toBeUndefined();
    expect(store.findFileByPath("a.ts")).toBeDefined();
  });
});
