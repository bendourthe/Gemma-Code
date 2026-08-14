/**
 * v1.16.0 Phase 4 (adoption item A6) -- the `parse_document` agent tool.
 *
 * The plan's stability gate is a security gate, so that is what these assert:
 * a path-traversal or secret-path attempt is BLOCKED, and parsed content is
 * redacted before it can reach the model. The untrusted-content annotation
 * itself is applied by AgentLoop and is covered by the routing test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ParseDocumentTool,
  PARSE_DOCUMENT_MAX_PAGES,
  type DocumentParser,
  type ParsedDocumentResult,
} from "../../../../src/tools/handlers/parseDocument.js";
import { ConfirmationGate } from "../../../../src/tools/ConfirmationGate.js";
import { mockFs } from "../../../setup.js";

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_001", path: "docs/invoice.pdf", ...overrides };
}

function makeGate(approved = true): ConfirmationGate {
  const gate = new ConfirmationGate(vi.fn());
  vi.spyOn(gate, "request").mockResolvedValue(approved);
  return gate;
}

/** A parser that records what it was handed and returns a scripted result. */
function fakeParser(
  over: Partial<ParsedDocumentResult> = {},
): DocumentParser & { lastBase64: string | null; lastMaxPages: number | undefined } {
  const state = { lastBase64: null as string | null, lastMaxPages: undefined as number | undefined };
  return {
    get lastBase64() {
      return state.lastBase64;
    },
    get lastMaxPages() {
      return state.lastMaxPages;
    },
    async parse(documentBase64, opts) {
      state.lastBase64 = documentBase64;
      state.lastMaxPages = opts?.maxPages;
      return {
        engine: "rapidocr",
        text: "INVOICE 12345",
        markdown: null,
        pageCount: 1,
        ...over,
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.readFile.mockResolvedValue(new TextEncoder().encode("%PDF-1.7 fake"));
});

describe("parse_document parameter validation", () => {
  it("fails without a path", async () => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() });
    const result = await tool.execute({ _callId: "c" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Missing required parameter: path/);
  });

  it.each([0, -1, 1.5, "3"])("rejects an invalid max_pages of %s", async (bad) => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() });
    const result = await tool.execute(params({ max_pages: bad }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/max_pages/);
  });

  it("clamps max_pages to the per-call cap", async () => {
    const parser = fakeParser();
    const tool = new ParseDocumentTool({ resolveParser: () => parser });
    await tool.execute(params({ max_pages: 10_000 }));
    expect(parser.lastMaxPages).toBe(PARSE_DOCUMENT_MAX_PAGES);
  });
});

describe("parse_document security guards", () => {
  it("BLOCKS a secret-path file without allow_secrets", async () => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, makeGate());
    const result = await tool.execute(params({ path: ".env" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/secret/i);
    // Never reached the filesystem.
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });

  it("asks for confirmation on a secret path with allow_secrets", async () => {
    const gate = makeGate(true);
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, gate);
    const result = await tool.execute(params({ path: ".env", allow_secrets: true }));
    expect(gate.request).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("BLOCKS a secret path when the user rejects the prompt", async () => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, makeGate(false));
    const result = await tool.execute(params({ path: ".env", allow_secrets: true }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rejected/i);
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });

  it("BLOCKS a path-traversal attempt outside the workspace", async () => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, makeGate());
    const result = await tool.execute(params({ path: "../../../etc/passwd" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the workspace/i);
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });

  it("REDACTS a secret found in the parsed text", async () => {
    const parser = fakeParser({
      text: "Key: ghp_0123456789abcdefghijklmnopqrstuvwxyz end",
    });
    const tool = new ParseDocumentTool({ resolveParser: () => parser }, makeGate());
    const result = await tool.execute(params());
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("ghp_0123456789abcdef");
    expect(result.output).toContain("<redacted>");
  });

  it("hands the parser base64, never a path", async () => {
    const parser = fakeParser();
    const tool = new ParseDocumentTool({ resolveParser: () => parser }, makeGate());
    await tool.execute(params());
    expect(parser.lastBase64).toBe(Buffer.from("%PDF-1.7 fake").toString("base64"));
  });
});

describe("parse_document results", () => {
  it("returns the extracted text with engine and page count", async () => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, makeGate());
    const result = await tool.execute(params());
    expect(result.success).toBe(true);
    expect(result.output).toContain("INVOICE 12345");
    expect(result.output).toContain("rapidocr");
  });

  it("prefers layout-preserving markdown when present", async () => {
    const parser = fakeParser({ markdown: "# Heading\n\nbody", text: "flat" });
    const tool = new ParseDocumentTool({ resolveParser: () => parser }, makeGate());
    const result = await tool.execute(params());
    expect(result.output).toContain("# Heading");
  });

  it("reports an empty document as success with an explanation", async () => {
    const parser = fakeParser({ text: "", markdown: null });
    const tool = new ParseDocumentTool({ resolveParser: () => parser }, makeGate());
    const result = await tool.execute(params());
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/no text/i);
  });

  it("fails cleanly when the file is unreadable", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, makeGate());
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found or unreadable/i);
  });

  it("fails with an actionable message when no model is installed", async () => {
    const tool = new ParseDocumentTool(
      {
        resolveParser: () => {
          throw new Error("the RapidOCR document model is not installed");
        },
      },
      makeGate(),
    );
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Settings > Models/);
  });
});

describe("parse_document memory ingestion", () => {
  it("notes when the text was stored", async () => {
    const tool = new ParseDocumentTool(
      {
        resolveParser: () => fakeParser(),
        ingestToMemory: { ingest: async () => ({ stored: true }) },
      },
      makeGate(),
    );
    const result = await tool.execute(params());
    expect(result.output).toContain("[stored in memory]");
  });

  it("notes the reason when storage declined", async () => {
    const tool = new ParseDocumentTool(
      {
        resolveParser: () => fakeParser(),
        ingestToMemory: {
          ingest: async () => ({ stored: false, reason: "toggle is false" }),
        },
      },
      makeGate(),
    );
    const result = await tool.execute(params());
    expect(result.output).toContain("not stored in memory: toggle is false");
  });

  it("still succeeds when ingestion throws", async () => {
    const tool = new ParseDocumentTool(
      {
        resolveParser: () => fakeParser(),
        ingestToMemory: {
          ingest: async () => {
            throw new Error("db locked");
          },
        },
      },
      makeGate(),
    );
    const result = await tool.execute(params());
    // A memory failure must never fail the parse.
    expect(result.success).toBe(true);
    expect(result.output).toContain("INVOICE 12345");
    expect(result.output).toContain("db locked");
  });

  it("writes nothing when no ingestor is wired", async () => {
    const tool = new ParseDocumentTool({ resolveParser: () => fakeParser() }, makeGate());
    const result = await tool.execute(params());
    expect(result.output).not.toContain("memory");
  });
});
