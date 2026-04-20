import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  OutputRedirector,
  TailOutputTool,
  GrepOutputTool,
} from "../../../src/tools/OutputRedirector.js";

describe("OutputRedirector", () => {
  let tmpDir: string;
  let redirector: OutputRedirector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "output-redir-"));
    redirector = new OutputRedirector(tmpDir, 100);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------

  describe("shouldRedirect()", () => {
    it("returns false for output below threshold", () => {
      expect(redirector.shouldRedirect("short")).toBe(false);
    });

    it("returns false for output exactly at threshold", () => {
      const exact = "a".repeat(100);
      expect(redirector.shouldRedirect(exact)).toBe(false);
    });

    it("returns true for output exceeding threshold", () => {
      const long = "a".repeat(101);
      expect(redirector.shouldRedirect(long)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe("redirect()", () => {
    it("writes file and returns correct metadata", () => {
      const output = "line1\nline2\nline3\nline4\nline5";
      const result = redirector.redirect("run_terminal", "call-1", output);

      expect(result).not.toBeNull();
      expect(result!.lineCount).toBe(5);
      expect(result!.charCount).toBe(output.length);
      expect(result!.redirectedPath).toContain("call-1.txt");

      // Verify file was written.
      const content = fs.readFileSync(result!.redirectedPath, "utf-8");
      expect(content).toBe(output);
    });

    it("includes a preview in the summary", () => {
      const output = "x".repeat(200);
      const result = redirector.redirect("grep_codebase", "call-2", output);

      expect(result).not.toBeNull();
      expect(result!.summary).toContain("[Output redirected to");
      expect(result!.summary).toContain("Use tail_output or grep_output");
      expect(result!.summary).toContain("Preview");
    });

    it("creates the output directory if missing", () => {
      const nested = path.join(tmpDir, "deep", "nested");
      const nestedRedirector = new OutputRedirector(nested, 10);
      const result = nestedRedirector.redirect("read_file", "call-3", "a".repeat(20));

      expect(result).not.toBeNull();
      expect(fs.existsSync(result!.redirectedPath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe("readTail()", () => {
    it("returns the last N lines", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      const filePath = path.join(tmpDir, "tail-test.txt");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, lines.join("\n"), "utf-8");

      const tail = redirector.readTail(filePath, 5);
      expect(tail).toContain("line 16");
      expect(tail).toContain("line 20");
      expect(tail).not.toContain("line 15");
    });

    it("returns entire content when lines exceeds file length", () => {
      const filePath = path.join(tmpDir, "short.txt");
      fs.writeFileSync(filePath, "one\ntwo\n", "utf-8");

      const tail = redirector.readTail(filePath, 100);
      expect(tail).toContain("one");
      expect(tail).toContain("two");
    });
  });

  // -------------------------------------------------------------------------

  describe("grepOutput()", () => {
    it("finds matching lines with line numbers", () => {
      const content = "apple\nbanana\napricot\nblueberry\navocado";
      const filePath = path.join(tmpDir, "grep-test.txt");
      fs.writeFileSync(filePath, content, "utf-8");

      const matches = redirector.grepOutput(filePath, "^a", 10);
      expect(matches).toContain("1: apple");
      expect(matches).toContain("3: apricot");
      expect(matches).toContain("5: avocado");
      expect(matches).not.toContain("banana");
    });

    it("respects maxResults limit", () => {
      const content = "a\na\na\na\na";
      const filePath = path.join(tmpDir, "many.txt");
      fs.writeFileSync(filePath, content, "utf-8");

      const matches = redirector.grepOutput(filePath, "a", 2);
      const matchLines = matches.split("\n");
      expect(matchLines).toHaveLength(2);
    });

    it("returns no-match message for unmatched pattern", () => {
      const filePath = path.join(tmpDir, "nomatch.txt");
      fs.writeFileSync(filePath, "hello world", "utf-8");

      const matches = redirector.grepOutput(filePath, "zzz", 10);
      expect(matches).toContain("No matches found");
    });
  });

  // -------------------------------------------------------------------------

  describe("cleanup()", () => {
    it("removes all files in the output directory", () => {
      redirector.redirect("run_terminal", "c1", "x".repeat(200));
      redirector.redirect("run_terminal", "c2", "y".repeat(200));

      const outDir = path.join(tmpDir, ".gemma-code-output");
      expect(fs.readdirSync(outDir).length).toBe(2);

      redirector.cleanup();
      expect(fs.readdirSync(outDir).length).toBe(0);
    });

    it("is a no-op when output directory does not exist", () => {
      // Should not throw.
      const freshRedirector = new OutputRedirector(path.join(tmpDir, "nope"));
      freshRedirector.cleanup();
    });
  });
});

// ---------------------------------------------------------------------------

describe("TailOutputTool", () => {
  let tmpDir: string;
  let redirector: OutputRedirector;
  let tool: TailOutputTool;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tail-tool-"));
    redirector = new OutputRedirector(tmpDir, 10);
    tool = new TailOutputTool(redirector);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns last N lines of a file", async () => {
    const filePath = path.join(tmpDir, "data.txt");
    fs.writeFileSync(filePath, "a\nb\nc\nd\ne\n", "utf-8");

    const result = await tool.execute({ path: filePath, lines: 3 });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.content).toContain("d");
    expect(parsed.content).toContain("e");
  });

  it("returns error for missing path parameter", async () => {
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("path");
  });

  it("returns error for nonexistent file", async () => {
    const result = await tool.execute({ path: "/nonexistent/file.txt" });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("GrepOutputTool", () => {
  let tmpDir: string;
  let redirector: OutputRedirector;
  let tool: GrepOutputTool;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grep-tool-"));
    redirector = new OutputRedirector(tmpDir, 10);
    tool = new GrepOutputTool(redirector);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds regex matches in a file", async () => {
    const filePath = path.join(tmpDir, "data.txt");
    fs.writeFileSync(filePath, "error: foo\ninfo: bar\nerror: baz\n", "utf-8");

    const result = await tool.execute({ path: filePath, pattern: "error" });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.matches).toContain("1: error: foo");
    expect(parsed.matches).toContain("3: error: baz");
  });

  it("returns error for missing path", async () => {
    const result = await tool.execute({ pattern: "test" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("path");
  });

  it("returns error for missing pattern", async () => {
    const result = await tool.execute({ path: "/some/file.txt" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("pattern");
  });
});
