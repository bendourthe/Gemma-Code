import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CreateFileTool,
  DeleteFileTool,
  ListDirectoryTool,
} from "../../../../src/tools/handlers/filesystem.js";
import { ConfirmationGate } from "../../../../src/tools/ConfirmationGate.js";
import { mockFs } from "../../../setup.js";

// Targeted error-path tests for v0.7.0 known-gaps Section 4.4 (287
// surviving mutants in filesystem.ts including 183 with no coverage at
// all; the largest no-coverage clusters are in create_file / delete_file
// / list_directory error branches). These tests pin those branches so
// Stryker mutants in the missing-parameter / disk-error / EACCES paths
// surface as failures.

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_001", ...overrides };
}

function makeGate(approved = true): ConfirmationGate {
  const gate = new ConfirmationGate(vi.fn());
  vi.spyOn(gate, "request").mockResolvedValue(approved);
  return gate;
}

function textToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateFileTool error paths", () => {
  it("returns failure when path parameter is missing", async () => {
    const tool = new CreateFileTool(makeGate(), "ask");
    const result = await tool.execute(params({ content: "data" }));
    expect(result.success).toBe(false);
  });

  it("returns failure when content parameter is missing", async () => {
    const tool = new CreateFileTool(makeGate(), "ask");
    const result = await tool.execute(params({ path: "new.ts" }));
    expect(result.success).toBe(false);
  });

  it("returns failure when the file already exists", async () => {
    // readFile resolving means the file exists; create must refuse.
    mockFs.readFile.mockResolvedValueOnce(textToUint8("existing"));
    const tool = new CreateFileTool(makeGate(), "ask");
    const result = await tool.execute(
      params({ path: "exists.ts", content: "x" }),
    );
    expect(result.success).toBe(false);
  });

  it("returns failure when writeFile rejects with a disk error", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    mockFs.createDirectory.mockResolvedValueOnce(undefined);
    mockFs.writeFile.mockRejectedValueOnce(new Error("ENOSPC: no space left"));

    const tool = new CreateFileTool(makeGate(), "ask");
    const result = await tool.execute(
      params({ path: "new.ts", content: "x" }),
    );
    expect(result.success).toBe(false);
  });

  it("returns failure when the user rejects the confirmation prompt", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const tool = new CreateFileTool(makeGate(false), "ask");
    const result = await tool.execute(
      params({ path: "new.ts", content: "x" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("DeleteFileTool error paths", () => {
  it("returns failure when path parameter is missing", async () => {
    const tool = new DeleteFileTool();
    const result = await tool.execute(params({}));
    expect(result.success).toBe(false);
  });

  it("returns failure when the underlying delete rejects with EACCES", async () => {
    mockFs.delete.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const tool = new DeleteFileTool();
    const result = await tool.execute(params({ path: "locked.ts" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("returns failure when the underlying delete rejects with ENOENT", async () => {
    mockFs.delete.mockRejectedValueOnce(new Error("ENOENT: no such file"));
    const tool = new DeleteFileTool();
    const result = await tool.execute(params({ path: "missing.ts" }));
    expect(result.success).toBe(false);
  });
});

describe("ListDirectoryTool error paths", () => {
  it("defaults missing path parameter to '.' rather than failing", async () => {
    mockFs.readDirectory.mockResolvedValueOnce([]);
    const tool = new ListDirectoryTool(makeGate());
    const result = await tool.execute(params({}));
    expect(result.success).toBe(true);
  });

  it("treats a readDirectory ENOENT as an empty directory (defensive walk)", async () => {
    mockFs.readDirectory.mockRejectedValueOnce(new Error("ENOENT"));
    const tool = new ListDirectoryTool(makeGate());
    const result = await tool.execute(params({ path: "missing" }));
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    const entries = parsed.entries ?? parsed.files ?? [];
    expect(entries).toEqual([]);
  });

  it("treats a readDirectory EACCES as an empty directory", async () => {
    mockFs.readDirectory.mockRejectedValueOnce(new Error("EACCES"));
    const tool = new ListDirectoryTool(makeGate());
    const result = await tool.execute(params({ path: "locked" }));
    expect(result.success).toBe(true);
  });

  it("returns success with empty entries on an empty directory", async () => {
    mockFs.readDirectory.mockResolvedValueOnce([]);
    const tool = new ListDirectoryTool(makeGate());
    const result = await tool.execute(params({ path: "empty" }));
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.entries ?? parsed.files ?? []).toEqual([]);
  });

  it("rejects a path matching the secret-path denylist without allow_secrets", async () => {
    const tool = new ListDirectoryTool(makeGate());
    const result = await tool.execute(params({ path: ".env" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/secret/i);
  });
});
