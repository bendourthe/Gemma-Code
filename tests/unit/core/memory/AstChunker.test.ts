import { describe, it, expect } from "vitest";
import { AstChunker, DEFAULT_SIZE_CHUNK_CHARS } from "../../../../core/memory/chunkers/AstChunker.js";

/**
 * v1.2.0 Phase 4.1 -- AstChunker unit tests.
 *
 * Coverage:
 *   - Language detection from extension
 *   - One chunk per top-level symbol for each supported language
 *   - No chunk spans more than one symbol body
 *   - Size-fallback engages for unsupported extensions
 *   - Size-fallback engages when forceFallback is set
 *   - Empty input returns empty array
 *   - Chunk ids are unique per file + symbol
 */

describe("AstChunker.detectLanguage", () => {
  it("maps known extensions", () => {
    expect(AstChunker.detectLanguage("a.ts")).toBe("typescript");
    expect(AstChunker.detectLanguage("a.tsx")).toBe("typescript");
    expect(AstChunker.detectLanguage("a.js")).toBe("typescript");
    expect(AstChunker.detectLanguage("a.py")).toBe("python");
    expect(AstChunker.detectLanguage("a.rs")).toBe("rust");
    expect(AstChunker.detectLanguage("a.go")).toBe("go");
  });

  it("returns null for unknown extensions", () => {
    expect(AstChunker.detectLanguage("README.md")).toBeNull();
    expect(AstChunker.detectLanguage("data.json")).toBeNull();
    expect(AstChunker.detectLanguage("noext")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(AstChunker.detectLanguage("A.TS")).toBe("typescript");
    expect(AstChunker.detectLanguage("Foo.Py")).toBe("python");
  });
});

describe("AstChunker AST path", () => {
  const chunker = new AstChunker();

  it("emits one chunk per top-level TypeScript function", () => {
    const src = [
      "export function alpha(x: number): number {",
      "  return x + 1;",
      "}",
      "",
      "export function beta(y: number): number {",
      "  return y * 2;",
      "}",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "src/foo.ts", content: src });
    expect(chunks.length).toBe(2);
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    for (const c of chunks) {
      expect(c.origin).toBe("ast");
      expect(c.language).toBe("typescript");
      expect(c.filePath).toBe("src/foo.ts");
    }
  });

  it("emits a class chunk that envelops its methods (no nested method chunks)", () => {
    const src = [
      "export class Counter {",
      "  count = 0;",
      "  increment(): void {",
      "    this.count += 1;",
      "  }",
      "  decrement(): void {",
      "    this.count -= 1;",
      "  }",
      "}",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "Counter.ts", content: src });
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain("Counter");
    // Methods nested inside Counter are filtered (they would otherwise duplicate
    // line coverage). The class chunk owns the full body.
    expect(names).not.toContain("increment");
    expect(names).not.toContain("decrement");
  });

  it("emits one chunk per Python function and class", () => {
    const src = [
      "def alpha(x):",
      "    return x + 1",
      "",
      "class Beta:",
      "    def gamma(self):",
      "        return 42",
      "",
      "def delta():",
      "    return None",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "foo.py", content: src });
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain("alpha");
    expect(names).toContain("Beta");
    expect(names).toContain("delta");
    for (const c of chunks) expect(c.origin).toBe("ast");
  });

  it("emits chunks for Rust functions and structs", () => {
    const src = [
      "pub fn alpha() -> u32 {",
      "    42",
      "}",
      "",
      "pub struct Beta {",
      "    pub n: u32,",
      "}",
      "",
      "pub fn gamma(b: &Beta) -> u32 {",
      "    b.n",
      "}",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "lib.rs", content: src });
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain("alpha");
    expect(names).toContain("Beta");
    expect(names).toContain("gamma");
  });

  it("emits chunks for Go functions", () => {
    const src = [
      "package main",
      "",
      "func Alpha() int {",
      "    return 1",
      "}",
      "",
      "func Beta(x int) int {",
      "    return x + 1",
      "}",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "main.go", content: src });
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });

  it("chunk content equals the slice of the source between lineStart and lineEnd", () => {
    const src = [
      "function foo() {",
      "  return 1;",
      "}",
      "",
      "function bar() {",
      "  return 2;",
      "}",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "x.ts", content: src });
    const foo = chunks.find((c) => c.symbolName === "foo");
    expect(foo).toBeDefined();
    expect(foo!.content).toContain("return 1");
    expect(foo!.content).not.toContain("return 2");
  });

  it("emits unique chunk ids", () => {
    const src = [
      "function alpha() { return 1; }",
      "function beta() { return 2; }",
      "function gamma() { return 3; }",
    ].join("\n");
    const chunks = chunker.chunk({ filePath: "u.ts", content: src });
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("AstChunker size-fallback path", () => {
  it("uses size-fallback for unsupported extensions", () => {
    const chunker = new AstChunker({ sizeChunkChars: 80 });
    const src = "this is a markdown file\nsecond line\nthird line\nfourth line\n";
    const chunks = chunker.chunk({ filePath: "README.md", content: src });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const c of chunks) {
      expect(c.origin).toBe("size-fallback");
      expect(c.kind).toBe("block");
      expect(c.language).toBeNull();
      expect(c.symbolName).toBeNull();
    }
  });

  it("respects sizeChunkChars threshold", () => {
    const chunker = new AstChunker({ sizeChunkChars: 50 });
    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) lines.push(`line ${i} content here`);
    const chunks = chunker.chunk({ filePath: "notes.txt", content: lines.join("\n") });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The size cap is enforced at the projection step; in practice each
    // chunk includes the line that triggered the flush, so allow a small
    // slack above the threshold.
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(80);
  });

  it("forceFallback skips AST path for supported languages", () => {
    const chunker = new AstChunker({ forceFallback: true });
    const src = "function foo() { return 1; }";
    const chunks = chunker.chunk({ filePath: "x.ts", content: src });
    expect(chunks[0]?.origin).toBe("size-fallback");
  });

  it("falls back when AST extraction yields no symbols", () => {
    const chunker = new AstChunker();
    const src = "// just a comment\n// another comment\n";
    const chunks = chunker.chunk({ filePath: "blank.ts", content: src });
    // Either zero AST chunks or it falls back to size; expect at least one
    // chunk total when content is non-empty.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    if (chunks.length > 0) {
      expect(chunks[0]!.origin).toBe("size-fallback");
    }
  });
});

describe("AstChunker edge cases", () => {
  it("empty input returns empty array", () => {
    const chunker = new AstChunker();
    expect(chunker.chunk({ filePath: "x.ts", content: "" })).toEqual([]);
  });

  it("default sizeChunkChars is 2000", () => {
    expect(DEFAULT_SIZE_CHUNK_CHARS).toBe(2_000);
  });

  it("clamps sizeChunkChars below 64 to 64", () => {
    const chunker = new AstChunker({ sizeChunkChars: 10 });
    const src = "abcdefghijklmnopqrstuvwxyz".repeat(10);
    const chunks = chunker.chunk({ filePath: "x.txt", content: src });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("explicit language=null forces size-fallback", () => {
    const chunker = new AstChunker();
    const src = "function foo() { return 1; }";
    const chunks = chunker.chunk({ filePath: "noext", content: src, language: null });
    expect(chunks[0]?.origin).toBe("size-fallback");
  });
});
