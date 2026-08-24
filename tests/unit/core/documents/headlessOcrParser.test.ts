/**
 * v1.20.0 Phase 1 (A1) -- bytes-in OCR parser adapter.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DOCUMENT_PARSER_BUSY,
  createHeadlessOcrParser,
} from "../../../../core/documents/headlessOcrParser.js";
import { OcrParseManager, resetOcrJobIdFactory, setOcrJobIdFactory } from "../../../../core/documents/OcrParseManager.js";
import { InMemoryOcrRuntime } from "../../../../core/documents/OcrRuntimeClient.js";

function okEnvelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    engine: "stub",
    text: "hello",
    markdown: null,
    pageCount: 1,
    pages: [{ index: 0, text: "hello" }],
    ...over,
  };
}

let runtime: InMemoryOcrRuntime;

beforeEach(() => {
  let n = 0;
  setOcrJobIdFactory(() => `job-${++n}`);
  runtime = new InMemoryOcrRuntime();
  runtime.setResponse("parse", okEnvelope());
});

afterEach(() => resetOcrJobIdFactory());

describe("createHeadlessOcrParser", () => {
  it("forwards base64 (never a path) and returns the parse envelope", async () => {
    const parser = createHeadlessOcrParser(new OcrParseManager(runtime), { pollMs: 0 });
    const result = await parser.parse("QUFB", { maxPages: 3 });
    expect(result.engine).toBe("stub");
    expect(result.text).toBe("hello");
    expect(result.pageCount).toBe(1);
    const request = (runtime.lastParams as { request: Record<string, unknown> }).request;
    expect(request.documentBase64).toBe("QUFB");
    expect(request.maxPages).toBe(3);
    expect(request).not.toHaveProperty("path");
  });

  it("rejects an empty payload", async () => {
    const parser = createHeadlessOcrParser(new OcrParseManager(runtime), { pollMs: 0 });
    await expect(parser.parse("")).rejects.toThrow(/documentBase64/);
  });

  it("surfaces a runtime error envelope as a thrown Error", async () => {
    runtime.setResponse("parse", { ok: false, error: "engine-unavailable", message: "install RapidOCR" });
    const parser = createHeadlessOcrParser(new OcrParseManager(runtime), { pollMs: 0 });
    await expect(parser.parse("QUFB")).rejects.toThrow(/install RapidOCR/);
  });

  it("rejects a second overlapping parse instead of interleaving RPCs", async () => {
    const original = runtime.call.bind(runtime);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.call = async (method, params) => {
      if (method === "parse") await gate;
      return original(method, params);
    };

    const parser = createHeadlessOcrParser(new OcrParseManager(runtime), { pollMs: 0 });
    const first = parser.parse("QUFB");
    await new Promise((r) => setTimeout(r, 0));
    await expect(parser.parse("QkJC")).rejects.toThrow(DOCUMENT_PARSER_BUSY);
    release();
    await expect(first).resolves.toMatchObject({ text: "hello" });
  });
});
