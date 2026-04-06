import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditFileTool } from "../../../src/tools/handlers/filesystem.js";
import type { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import type { EditMode } from "../../../src/tools/types.js";
import { mockFs } from "../../setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_CONTENT = "const x = 1;\nconst y = 2;\n";

function textToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function makeGate(approved = true): ConfirmationGate {
  return {
    request: vi.fn().mockResolvedValue(approved),
    resolve: vi.fn(),
    requestDiffPreview: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConfirmationGate;
}

function makeParams(extra: Record<string, unknown> = {}) {
  return {
    _callId: "call-1",
    path: "test.ts",
    old_string: "const x = 1;",
    new_string: "const x = 99;",
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe("EditFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockResolvedValue(textToUint8(ORIGINAL_CONTENT));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.createDirectory.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------

  describe('"auto" mode', () => {
    it("writes the file without calling ConfirmationGate", async () => {
      const gate = makeGate();
      const tool = new EditFileTool(gate, "auto" as EditMode);

      const result = await tool.execute(makeParams());

      expect(result.success).toBe(true);
      expect(gate.request).not.toHaveBeenCalled();
      expect(gate.requestDiffPreview).not.toHaveBeenCalled();
      expect(vi.mocked(mockFs.writeFile)).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------

  describe('"ask" mode', () => {
    it("calls ConfirmationGate and writes on approval", async () => {
      const gate = makeGate(true);
      const tool = new EditFileTool(gate, "ask" as EditMode);

      const result = await tool.execute(makeParams());

      expect(gate.request).toHaveBeenCalledOnce();
      expect(result.success).toBe(true);
      expect(vi.mocked(mockFs.writeFile)).toHaveBeenCalledOnce();
    });

    it("skips the write and returns failure on rejection", async () => {
      const gate = makeGate(false);
      const tool = new EditFileTool(gate, "ask" as EditMode);

      const result = await tool.execute(makeParams());

      expect(gate.request).toHaveBeenCalledOnce();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/rejected/i);
      expect(vi.mocked(mockFs.writeFile)).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------

  describe('"manual" mode', () => {
    it("never writes the file and posts a diff preview", async () => {
      const gate = makeGate();
      const tool = new EditFileTool(gate, "manual" as EditMode);

      const result = await tool.execute(makeParams());

      expect(gate.requestDiffPreview).toHaveBeenCalledOnce();
      expect(gate.request).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/manual mode/i);
      expect(vi.mocked(mockFs.writeFile)).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------

  describe("parameter validation", () => {
    it("fails when old_string is not found in the file", async () => {
      const gate = makeGate();
      const tool = new EditFileTool(gate, "auto" as EditMode);

      const result = await tool.execute({
        ...makeParams(),
        old_string: "THIS_DOES_NOT_EXIST",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it("fails when old_string appears more than once", async () => {
      mockFs.readFile.mockResolvedValueOnce(textToUint8("dup\ndup\n"));
      const gate = makeGate();
      const tool = new EditFileTool(gate, "auto" as EditMode);

      const result = await tool.execute({
        ...makeParams(),
        old_string: "dup",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/appears \d+ times/i);
    });
  });
});
