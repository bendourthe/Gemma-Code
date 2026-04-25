import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { DeleteFileTool } from "../../../../src/tools/handlers/filesystem.js";
import { mockFs } from "../../../setup.js";

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_dry_delete", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteFileTool dry_run", () => {
  it("returns size and SHA-256 without invoking the delete API", async () => {
    const content = Buffer.from("hello world\n", "utf-8");
    mockFs.stat.mockResolvedValueOnce({ type: 1, size: content.length });
    mockFs.readFile.mockResolvedValueOnce(new Uint8Array(content));

    const tool = new DeleteFileTool();
    const result = await tool.execute(
      params({ path: "doomed.txt", dry_run: true }),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("=== DRY RUN: no deletion occurred ===");
    expect(result.output).toContain(`Size: ${content.length}`);
    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(result.output).toContain(`Content SHA-256: ${expectedHash}`);
    expect(mockFs.delete).not.toHaveBeenCalled();
  });

  it("hashes only the first 1 MB and labels the field accordingly", async () => {
    // Simulate a 1.5 MB file: the spec caps the hash at the first 1 MB.
    const oneMb = 1024 * 1024;
    const big = Buffer.alloc(oneMb + 512_000, 0x41); // 'A' bytes
    mockFs.stat.mockResolvedValueOnce({ type: 1, size: big.length });
    mockFs.readFile.mockResolvedValueOnce(new Uint8Array(big));

    const tool = new DeleteFileTool();
    const result = await tool.execute(
      params({ path: "big.bin", dry_run: true }),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Content SHA-256 (first 1 MB):");
    const expectedHash = createHash("sha256")
      .update(big.subarray(0, oneMb))
      .digest("hex");
    expect(result.output).toContain(expectedHash);
    expect(mockFs.delete).not.toHaveBeenCalled();
  });

  it("does not unlink the file across many fuzz-shaped inputs (adversarial)", async () => {
    const tool = new DeleteFileTool();
    const fuzzPaths = [
      "a.txt",
      "src/extension.ts",
      ".env",
      "deeply/nested/path/with-symbols_!@#.txt",
      "x".repeat(200) + ".log",
      "spaces in name.md",
    ];

    for (const p of fuzzPaths) {
      const content = Buffer.from(`payload-${p}`, "utf-8");
      mockFs.stat.mockResolvedValueOnce({ type: 1, size: content.length });
      mockFs.readFile.mockResolvedValueOnce(new Uint8Array(content));
      const result = await tool.execute(params({ path: p, dry_run: true }));
      expect(result.success).toBe(true);
    }

    expect(mockFs.delete).not.toHaveBeenCalled();
  });

  it("falls through to the delete path when dry_run is omitted", async () => {
    mockFs.delete.mockResolvedValueOnce(undefined);

    const tool = new DeleteFileTool();
    const result = await tool.execute(params({ path: "old.ts" }));

    expect(result.success).toBe(true);
    expect(mockFs.delete).toHaveBeenCalledOnce();
  });

  it("falls through to the delete path when dry_run is explicitly false", async () => {
    mockFs.delete.mockResolvedValueOnce(undefined);

    const tool = new DeleteFileTool();
    const result = await tool.execute(params({ path: "old.ts", dry_run: false }));

    expect(result.success).toBe(true);
    expect(mockFs.delete).toHaveBeenCalledOnce();
  });

  it("returns a failure with usage hint when stat fails on dry-run", async () => {
    mockFs.stat.mockRejectedValueOnce(new Error("FileNotFound"));

    const tool = new DeleteFileTool();
    const result = await tool.execute(
      params({ path: "ghost.txt", dry_run: true }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to stat/);
    expect(mockFs.delete).not.toHaveBeenCalled();
  });
});
