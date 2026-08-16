import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Force the findFiles fallback; a host with `rg` on PATH would search the
// mock workspace root and return zero matches (see filesystem.test.ts).
vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  }),
}));

import { GrepCodebaseTool } from "../../../../src/tools/handlers/filesystem.js";
import { mockFs, MOCK_WORKSPACE_ROOT } from "../../../setup.js";
import { mockOf } from "../../../helpers/factories.js";

const ROOT = MOCK_WORKSPACE_ROOT;

function call(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_grep", pattern: "match", ...extra };
}

async function mockFindFiles(uris: string[]): Promise<void> {
  const { findFiles } = await import("vscode").then((m) => m.workspace);
  vi.mocked(findFiles).mockResolvedValueOnce(
    uris.map((p) => mockOf<import("vscode").Uri>({ fsPath: p, toString: () => p })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GrepCodebaseTool — max_results / next_offset pagination", () => {
  it("returns next_offset when more matches remain after the page", async () => {
    await mockFindFiles([`${ROOT}/src/many.ts`]);
    const content = Array.from({ length: 200 }, (_, i) => `match line ${i}`).join("\n");
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(call({ max_results: 50 }));
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.matches).toHaveLength(50);
    expect(typeof parsed.next_offset).toBe("string");
    expect(parsed.truncation_hint).toContain("next_offset");
  });

  it("omits next_offset when fewer matches than max_results exist", async () => {
    await mockFindFiles([`${ROOT}/src/few.ts`]);
    const content = "match a\nmatch b\nmatch c\n";
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(call({ max_results: 50 }));
    const parsed = JSON.parse(result.output);
    expect(parsed.matches.length).toBe(3);
    expect(parsed.next_offset).toBeUndefined();
  });

  it("continues from the cursor returned by the prior call", async () => {
    // First call: produce 200 matches, take first 50 + cursor.
    await mockFindFiles([`${ROOT}/src/many.ts`]);
    const content = Array.from({ length: 200 }, (_, i) => `match line ${i}`).join("\n");
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const first = await tool.execute(call({ max_results: 50 }));
    const firstParsed = JSON.parse(first.output);
    const cursor = firstParsed.next_offset;
    expect(typeof cursor).toBe("string");

    // Second call: pass next_offset, expect a different page.
    await mockFindFiles([`${ROOT}/src/many.ts`]);
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));
    const second = await tool.execute(call({ max_results: 50, next_offset: cursor }));
    const secondParsed = JSON.parse(second.output);
    expect(secondParsed.matches[0].line).toBeGreaterThan(firstParsed.matches[0].line);
    expect(secondParsed.matches[0].line).toBe(firstParsed.matches[49].line + 1);
  });

  it("rejects an invalid next_offset cursor with an actionable error", async () => {
    const tool = new GrepCodebaseTool();
    const result = await tool.execute(call({ next_offset: "not-base64-!@#" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("next_offset");
    expect(result.error).toContain("Usage:");
  });

  it("rejects a non-string next_offset with an actionable error", async () => {
    const tool = new GrepCodebaseTool();
    const result = await tool.execute(call({ next_offset: 42 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("next_offset");
    expect(result.error).toContain("Usage:");
  });

  it("clamps max_results=600 to the per-call ceiling and emits a warning", async () => {
    await mockFindFiles([`${ROOT}/src/many.ts`]);
    const content = "match here\n".repeat(10);
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(call({ max_results: 600 }));
    const parsed = JSON.parse(result.output);
    expect(parsed.warning).toContain("clamped");
    expect(parsed.warning).toContain("500");
  });

  it("rejects max_results <= 0 with an actionable error", async () => {
    const tool = new GrepCodebaseTool();
    const result = await tool.execute(call({ max_results: 0 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("max_results");
    expect(result.error).toContain("Usage:");
  });
});
