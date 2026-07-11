/**
 * Integration: Phase 3 (v0.5.0) — Brotli compression in OutputRedirector.
 *
 * Verifies the end-to-end compression flow: when a tool produces a payload
 * above the threshold, OutputRedirector stores it Brotli-compressed on disk,
 * tail_output and grep_output transparently decode it, and the round-trip is
 * byte-equivalent.
 *
 * The plan-level assertion (see docs/archive/v0/v0.5/plans/token-optimizer-adoption.md
 * Phase 1, sub-task 1.2) is: a 12 KB grep result is < 6 KB on disk after
 * compression.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  OutputRedirector,
  TailOutputTool,
  GrepOutputTool,
  COMPRESSED_FILE_SUFFIX,
} from "../../src/tools/OutputRedirector.js";
import {
  resetCompressionStats,
  getCompressionStats,
} from "../../modules/coding/utils/Compressor.js";

function buildGrepResult(byteTarget: number): string {
  // Realistic-shaped grep output: src-relative paths and a code excerpt per
  // line. This compresses well because the path prefix and structure repeat.
  const sample = [
    "src/utils/Compressor.ts:42: export async function compress(input: string): Promise<CompressionResult> {",
    "src/utils/Compressor.ts:51: const data = await _brotliCompressAsync(inputBuf, BROTLI_OPTIONS);",
    "src/utils/Compressor.ts:60: return { data, originalBytes, compressedBytes, ratio };",
    "src/tools/OutputRedirector.ts:185: filePath = path.join(this._outputDir, `${callId}.txt.br`);",
    "src/tools/OutputRedirector.ts:192: fs.writeFileSync(filePath, dataBuf);",
    "src/chat/ContextCompactor.ts:128: const cleared = message.content.replace(TOOL_RESULT_RE, summary);",
    "tests/unit/utils/Compressor.test.ts:88: expect(result.ratio).toBeGreaterThanOrEqual(0.5);",
  ];
  let out = "";
  let i = 0;
  while (Buffer.byteLength(out, "utf8") < byteTarget) {
    out += sample[i % sample.length] + "\n";
    i += 1;
  }
  return out;
}

describe("Tool-output compression integration", () => {
  let tmpDir: string;
  let redirector: OutputRedirector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-output-compress-"));
    // Threshold is 5000 chars so that any redirected payload here is large
    // enough to also pass the Compressor's 500 B threshold.
    redirector = new OutputRedirector(tmpDir, 5000);
    resetCompressionStats();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores a 12 KB grep result as < 6 KB on disk after compression", () => {
    const grepResult = buildGrepResult(12 * 1024);
    expect(Buffer.byteLength(grepResult, "utf8")).toBeGreaterThanOrEqual(12 * 1024);

    const result = redirector.redirect("grep_codebase", "grep-1", grepResult);
    expect(result).not.toBeNull();
    expect(result!.compressed).toBe(true);
    expect(result!.redirectedPath.endsWith(COMPRESSED_FILE_SUFFIX)).toBe(true);

    const onDisk = fs.statSync(result!.redirectedPath).size;
    expect(onDisk).toBeLessThan(6 * 1024);

    const stats = getCompressionStats();
    expect(stats.originalBytes).toBeGreaterThan(0);
    expect(stats.compressedBytes).toBeGreaterThan(0);
    expect(stats.compressedBytes).toBeLessThan(stats.originalBytes);
  });

  it("tail_output transparently reads a compressed redirected file", async () => {
    const grepResult = buildGrepResult(12 * 1024);
    const result = redirector.redirect("grep_codebase", "grep-tail", grepResult)!;
    expect(result.compressed).toBe(true);

    const tailTool = new TailOutputTool(redirector);
    const toolResult = await tailTool.execute({
      _callId: "x",
      path: result.redirectedPath,
      lines: 5,
    });
    expect(toolResult.success).toBe(true);
    const parsed = JSON.parse(toolResult.output) as { content: string; lines: number };
    // Last line of grepResult should appear in the tail.
    const lastLines = grepResult.split("\n").slice(-5).join("\n");
    expect(parsed.content).toBe(lastLines);
  });

  it("grep_output transparently searches a compressed redirected file", async () => {
    const grepResult = buildGrepResult(12 * 1024);
    const result = redirector.redirect("grep_codebase", "grep-grep", grepResult)!;
    expect(result.compressed).toBe(true);

    const grepTool = new GrepOutputTool(redirector);
    const toolResult = await grepTool.execute({
      _callId: "y",
      path: result.redirectedPath,
      pattern: "Compressor\\.ts",
      max_results: 3,
    });
    expect(toolResult.success).toBe(true);
    const parsed = JSON.parse(toolResult.output) as { matches: string };
    expect(parsed.matches).toContain("Compressor.ts");
  });

  it("preserves byte-equivalent round-trip for UTF-8 with emoji and CJK", () => {
    const block = "世界 🌍 日本語 漢字 🎉🚀✨ Lorem ipsum dolor sit amet. ";
    let payload = "";
    while (Buffer.byteLength(payload, "utf8") < 8 * 1024) payload += block;

    const result = redirector.redirect("read_file", "utf8-roundtrip", payload)!;
    expect(result.compressed).toBe(true);

    const decoded = OutputRedirector.readDecoded(result.redirectedPath);
    expect(decoded).toBe(payload);
  });

  it("writes plain .txt when payload is below the 500 B compression threshold", () => {
    // 200-char output below the redirector's 5000-char redirect threshold
    // is also below the Compressor's 500 B threshold once redirected manually.
    const small = "x".repeat(400);
    const result = redirector.redirect("run_terminal", "small-plain", small)!;
    expect(result.compressed).toBe(false);
    expect(result.redirectedPath.endsWith(COMPRESSED_FILE_SUFFIX)).toBe(false);
    expect(fs.readFileSync(result.redirectedPath, "utf-8")).toBe(small);
  });
});
