/**
 * v1.16.0 Phase 4.2 (adoption item A6) -- opt-in memory ingestion.
 *
 * The two behaviours that matter: nothing is written unless the toggle is
 * explicitly on, and a store rejection (which untrusted OCR text triggers
 * routinely) is reported as a normal outcome rather than an error.
 */

import { describe, it, expect, vi } from "vitest";

import {
  DEFAULT_MEMORY_INGEST_MAX_CHARS,
  createDocumentMemoryIngestor,
  type MemoryWriter,
} from "../../../../src/tools/handlers/documentMemoryIngestor.js";

function writer(impl?: MemoryWriter["save"]): MemoryWriter & { save: ReturnType<typeof vi.fn> } {
  return { save: vi.fn(impl ?? (async () => ({}))) } as never;
}

const ARGS = { text: "INVOICE 12345", sourcePath: "docs/invoice.pdf", engine: "rapidocr" };

describe("default-off behaviour", () => {
  it("writes nothing when the toggle is omitted", async () => {
    const store = writer();
    const result = await createDocumentMemoryIngestor({ store }).ingest(ARGS);
    expect(result.stored).toBe(false);
    expect(result.reason).toMatch(/memoryIngest\.enabled is false/);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("writes nothing when the toggle is explicitly false", async () => {
    const store = writer();
    await createDocumentMemoryIngestor({ store, enabled: false }).ingest(ARGS);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("writes when the toggle is on", async () => {
    const store = writer();
    const result = await createDocumentMemoryIngestor({ store, enabled: true }).ingest(ARGS);
    expect(result.stored).toBe(true);
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});

describe("what gets stored", () => {
  it("records the source file and engine in the content", async () => {
    const store = writer();
    await createDocumentMemoryIngestor({ store, enabled: true }).ingest(ARGS);
    const [content] = store.save.mock.calls[0] as [string];
    expect(content).toContain("docs/invoice.pdf");
    expect(content).toContain("rapidocr");
    expect(content).toContain("INVOICE 12345");
  });

  it("attaches provenance naming the tool", async () => {
    const store = writer();
    await createDocumentMemoryIngestor({ store, enabled: true, sessionId: "s1" }).ingest(ARGS);
    const call = store.save.mock.calls[0] as [string, string, string, { provenance: unknown }];
    expect(call[1]).toBe("fact");
    expect(call[2]).toBe("s1");
    expect(call[3].provenance).toMatchObject({
      sessionId: "s1",
      toolName: "parse_document",
      hookKind: "lifecycle.tool.post",
    });
  });

  it("truncates a very long document", async () => {
    const store = writer();
    await createDocumentMemoryIngestor({ store, enabled: true }).ingest({
      ...ARGS,
      text: "x".repeat(DEFAULT_MEMORY_INGEST_MAX_CHARS + 500),
    });
    const [content] = store.save.mock.calls[0] as [string];
    expect(content).toContain("[truncated]");
    expect(content.length).toBeLessThan(DEFAULT_MEMORY_INGEST_MAX_CHARS + 200);
  });

  it("honours a custom cap", async () => {
    const store = writer();
    await createDocumentMemoryIngestor({ store, enabled: true, maxChars: 10 }).ingest({
      ...ARGS,
      text: "abcdefghijklmnop",
    });
    expect((store.save.mock.calls[0] as [string])[0]).toContain("[truncated]");
  });

  it("declines empty text without calling the store", async () => {
    const store = writer();
    const result = await createDocumentMemoryIngestor({ store, enabled: true }).ingest({
      ...ARGS,
      text: "   ",
    });
    expect(result.stored).toBe(false);
    expect(result.reason).toMatch(/no text/);
    expect(store.save).not.toHaveBeenCalled();
  });
});

describe("store rejection is an expected outcome", () => {
  it("reports a prompt-injection rejection plainly, without throwing", async () => {
    const store = writer(async () => {
      throw new Error(
        "MemoryStore.save rejected: prompt-injection patterns detected (ignore-previous)",
      );
    });
    const result = await createDocumentMemoryIngestor({ store, enabled: true }).ingest(ARGS);
    expect(result.stored).toBe(false);
    expect(result.reason).toMatch(/prompt-injection markers/);
  });

  it("passes through any other store failure as the reason", async () => {
    const store = writer(async () => {
      throw new Error("database is locked");
    });
    const result = await createDocumentMemoryIngestor({ store, enabled: true }).ingest(ARGS);
    expect(result.stored).toBe(false);
    expect(result.reason).toBe("database is locked");
  });

  it("reads a live sessionId getter at ingest time", async () => {
    const store = writer();
    let current = "s-old";
    await createDocumentMemoryIngestor({
      store,
      enabled: true,
      sessionId: () => current,
    }).ingest(ARGS);
    current = "s-new";
    await createDocumentMemoryIngestor({
      store,
      enabled: true,
      sessionId: () => current,
    }).ingest(ARGS);
    expect((store.save.mock.calls[0] as [string, string, string])[2]).toBe("s-old");
    expect((store.save.mock.calls[1] as [string, string, string])[2]).toBe("s-new");
  });
});
