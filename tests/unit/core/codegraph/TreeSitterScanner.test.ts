/**
 * v1.4.0 Phase 7 (T022 / gap 3.3.P2.G) -- Tree-sitter scanner tests.
 *
 * Proves the web-tree-sitter (WASM) extractor (a) loads the four language
 * grammars, (b) extracts the same function/class/method/call symbols the regex
 * extractor did for the four language fixtures, and (c) handles the three edge
 * cases the regex extractor documented as misses: multi-line declarations,
 * property-method assignments (`const f = () => {}`), and computed method names.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  initTreeSitter,
  isTreeSitterReady,
  isLanguageReady,
  extractSymbols,
  extractSymbolsRegex,
} from "../../../../core/codegraph/scanner/index.js";

beforeAll(async () => {
  const ready = await initTreeSitter();
  expect(ready).toBe(true);
});

describe("TreeSitterScanner -- grammars load", () => {
  it("loads all four language grammars", () => {
    expect(isTreeSitterReady()).toBe(true);
    for (const lang of ["typescript", "python", "rust", "go"] as const) {
      expect(isLanguageReady(lang)).toBe(true);
    }
  });
});

describe("TreeSitterScanner -- four language fixtures", () => {
  it("typescript: function + class + method + call edge", () => {
    const src = [
      "export function redactSecrets(input: string): string {",
      "  return input;",
      "}",
      "",
      "export class Logger {",
      "  log(message: string): void {",
      "    redactSecrets(message);",
      "  }",
      "}",
    ].join("\n");
    const r = extractSymbols(src, "typescript");
    expect(r.symbols.find((s) => s.name === "redactSecrets")?.kind).toBe("function");
    expect(r.symbols.find((s) => s.name === "Logger")?.kind).toBe("class");
    expect(r.symbols.find((s) => s.name === "log")?.kind).toBe("method");
    expect(r.calls.some((c) => c.calleeName === "redactSecrets")).toBe(true);
  });

  it("python: def + class + call", () => {
    const src = [
      "def add(a, b):",
      "    return a + b",
      "",
      "class Calculator:",
      "    def total(self, items):",
      "        return add(items[0], items[1])",
    ].join("\n");
    const r = extractSymbols(src, "python");
    expect(r.symbols.some((s) => s.name === "add")).toBe(true);
    expect(r.symbols.find((s) => s.name === "Calculator")?.kind).toBe("class");
    expect(r.calls.some((c) => c.calleeName === "add")).toBe(true);
  });

  it("rust: fn + struct + trait + call", () => {
    const src = [
      "pub struct Point { x: i32, y: i32 }",
      "pub trait Shape { fn area(&self) -> i32; }",
      "pub fn double(value: i32) -> i32 { value * 2 }",
      "pub fn apply(value: i32) -> i32 { double(value) }",
    ].join("\n");
    const r = extractSymbols(src, "rust");
    expect(r.symbols.find((s) => s.name === "Point")?.kind).toBe("struct");
    expect(r.symbols.find((s) => s.name === "Shape")?.kind).toBe("trait");
    expect(r.symbols.find((s) => s.name === "double")?.kind).toBe("function");
    expect(r.calls.some((c) => c.calleeName === "double")).toBe(true);
  });

  it("go: func + method + struct + call", () => {
    const src = [
      "package main",
      "type Counter struct { value int }",
      "func increment(n int) int { return n + 1 }",
      "func (c *Counter) Bump() { c.value = increment(c.value) }",
    ].join("\n");
    const r = extractSymbols(src, "go");
    expect(r.symbols.find((s) => s.name === "Counter")?.kind).toBe("struct");
    expect(r.symbols.find((s) => s.name === "increment")?.kind).toBe("function");
    expect(r.symbols.find((s) => s.name === "Bump")?.kind).toBe("method");
    expect(r.calls.some((c) => c.calleeName === "increment")).toBe(true);
  });
});

describe("TreeSitterScanner -- edge cases the regex extractor misses", () => {
  it("multi-line function declaration (open paren on next line)", () => {
    const src = [
      "export function manyArgs(",
      "  a: number,",
      "  b: number,",
      "): number {",
      "  return a + b;",
      "}",
    ].join("\n");
    const sym = extractSymbols(src, "typescript").symbols.find(
      (s) => s.name === "manyArgs",
    );
    expect(sym).toBeDefined();
    expect(sym?.kind).toBe("function");
    expect(sym?.lineStart).toBe(1);
    // The full declaration spans through the body, so a call on any inner line
    // attributes to this symbol (the regex extractor's line range was the
    // single match line, truncating multi-line signatures).
    expect(sym!.lineEnd).toBeGreaterThan(sym!.lineStart);
  });

  it("property-method assignment (const arrow function)", () => {
    const src = "const handler = (event: string): void => { return; };";
    expect(extractSymbols(src, "typescript").symbols.map((s) => s.name)).toContain(
      "handler",
    );
  });

  it("computed method name", () => {
    const src = ["class Iter {", "  [Symbol.iterator]() { return this; }", "}"].join("\n");
    const syms = extractSymbols(src, "typescript").symbols;
    expect(
      syms.some((s) => s.kind === "method" && s.name.includes("Symbol.iterator")),
    ).toBe(true);
  });
});

describe("TreeSitterScanner -- regex fallback still works", () => {
  it("extractSymbolsRegex extracts a single-line function", () => {
    const r = extractSymbolsRegex("export function noop() { return 1; }", "typescript");
    expect(r.symbols.some((s) => s.name === "noop")).toBe(true);
  });
});
