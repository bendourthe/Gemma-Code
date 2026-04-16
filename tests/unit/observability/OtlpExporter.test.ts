import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  OtlpExporter,
  parseOtlpHeaders,
} from "../../../src/observability/OtlpExporter.js";
import type { Span } from "../../../src/observability/TraceStore.js";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function makeSpan(overrides?: Partial<Span>): Span {
  return {
    traceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    spanId: "11111111-2222-3333-4444-555555555555",
    parentSpanId: null,
    name: "test_span",
    kind: "tool_call",
    startTime: 1700000000000,
    endTime: 1700000001000,
    durationMs: 1000,
    status: "ok",
    attributes: { toolName: "read_file", success: true },
    events: [],
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// OtlpExporter
// -------------------------------------------------------------------------

describe("OtlpExporter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exporter: OtlpExporter;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    exporter = new OtlpExporter({
      endpoint: "http://localhost:4318/v1/traces",
      batchSize: 3,
      flushIntervalMs: 60_000,
    });
  });

  afterEach(() => {
    exporter.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Buffer and flush
  // -------------------------------------------------------------------------

  describe("enqueueSpan / flush", () => {
    it("buffers spans until batchSize is reached", () => {
      exporter.enqueueSpan(makeSpan({ name: "s1" }));
      exporter.enqueueSpan(makeSpan({ name: "s2" }));

      expect(exporter.bufferSize).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("auto-flushes when batchSize is reached", async () => {
      // Use real timers for this test to avoid fake-timer conflicts with async flush.
      vi.useRealTimers();
      exporter.dispose(); // clear previous exporter with fake timer
      exporter = new OtlpExporter({
        endpoint: "http://localhost:4318/v1/traces",
        batchSize: 3,
        flushIntervalMs: 600_000,
      });

      exporter.enqueueSpan(makeSpan({ name: "s1" }));
      exporter.enqueueSpan(makeSpan({ name: "s2" }));
      exporter.enqueueSpan(makeSpan({ name: "s3" }));

      // Wait for the async flush to settle.
      await new Promise((r) => setTimeout(r, 50));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(exporter.bufferSize).toBe(0);

      vi.useFakeTimers(); // restore for other tests
    });

    it("manual flush sends buffered spans", async () => {
      exporter.enqueueSpan(makeSpan());
      await exporter.flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(exporter.bufferSize).toBe(0);
    });

    it("flush is a no-op when buffer is empty", async () => {
      await exporter.flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // OTLP format conversion
  // -------------------------------------------------------------------------

  describe("OTLP format", () => {
    it("sends valid OTLP JSON to the endpoint", async () => {
      exporter.enqueueSpan(makeSpan());
      await exporter.flush();

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:4318/v1/traces");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.resourceSpans).toHaveLength(1);
      expect(body.resourceSpans[0].scopeSpans[0].scope.name).toBe(
        "gemma-code",
      );
      expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    });

    it("maps span fields to OTLP fields correctly", async () => {
      exporter.enqueueSpan(
        makeSpan({
          name: "my_tool",
          kind: "tool_call",
          status: "ok",
          startTime: 1700000000000,
          endTime: 1700000001000,
        }),
      );
      await exporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

      expect(otlpSpan.name).toBe("my_tool");
      expect(otlpSpan.kind).toBe(1); // INTERNAL
      expect(otlpSpan.status.code).toBe(1); // OK
      expect(otlpSpan.startTimeUnixNano).toBe("1700000000000000000");
    });

    it("maps llm_call kind to SPAN_KIND_CLIENT", async () => {
      exporter.enqueueSpan(makeSpan({ kind: "llm_call" }));
      await exporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];
      expect(otlpSpan.kind).toBe(3); // CLIENT
    });

    it("maps error status correctly", async () => {
      exporter.enqueueSpan(makeSpan({ status: "error" }));
      await exporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];
      expect(otlpSpan.status.code).toBe(2); // ERROR
    });

    it("converts attributes to OTLP key-value format", async () => {
      exporter.enqueueSpan(
        makeSpan({
          attributes: { name: "test", count: 42, flag: true },
        }),
      );
      await exporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

      expect(attrs).toContainEqual({
        key: "name",
        value: { stringValue: "test" },
      });
      expect(attrs).toContainEqual({
        key: "count",
        value: { intValue: 42 },
      });
      expect(attrs).toContainEqual({
        key: "flag",
        value: { boolValue: true },
      });
    });

    it("includes parentSpanId when present", async () => {
      exporter.enqueueSpan(
        makeSpan({ parentSpanId: "pppppppp-qqqq-rrrr-ssss-tttttttttttt" }),
      );
      await exporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];
      expect(otlpSpan.parentSpanId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Periodic flush
  // -------------------------------------------------------------------------

  describe("periodic flush timer", () => {
    it("flushes on interval", async () => {
      exporter.enqueueSpan(makeSpan());

      // Advance past the flush interval
      await vi.advanceTimersByTimeAsync(60_000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("handles network errors gracefully", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network unreachable"));

      exporter.enqueueSpan(makeSpan());
      // Should not throw
      await expect(exporter.flush()).resolves.not.toThrow();
      expect(exporter.bufferSize).toBe(0); // buffer is cleared even on error
    });

    it("handles non-ok HTTP responses gracefully", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      exporter.enqueueSpan(makeSpan());
      await expect(exporter.flush()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe("dispose", () => {
    it("clears the flush timer and flushes remaining spans", async () => {
      exporter.enqueueSpan(makeSpan());
      exporter.dispose();

      await vi.runAllTimersAsync();

      // The dispose flush should have been called
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Custom headers
  // -------------------------------------------------------------------------

  describe("custom headers", () => {
    it("sends custom headers in requests", async () => {
      exporter.dispose(); // dispose the default exporter
      exporter = new OtlpExporter({
        endpoint: "http://localhost:4318/v1/traces",
        headers: { Authorization: "Bearer test-token" },
        batchSize: 10,
        flushIntervalMs: 600_000,
      });

      exporter.enqueueSpan(makeSpan());
      await exporter.flush();

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers["Authorization"]).toBe("Bearer test-token");
    });
  });
});

// -------------------------------------------------------------------------
// parseOtlpHeaders
// -------------------------------------------------------------------------

describe("parseOtlpHeaders", () => {
  it("parses comma-separated key=value pairs", () => {
    const result = parseOtlpHeaders("Auth=Bearer token,X-Custom=val");
    expect(result).toEqual({
      Auth: "Bearer token",
      "X-Custom": "val",
    });
  });

  it("returns empty object for empty string", () => {
    expect(parseOtlpHeaders("")).toEqual({});
  });

  it("handles values with equals signs", () => {
    const result = parseOtlpHeaders("key=a=b=c");
    expect(result).toEqual({ key: "a=b=c" });
  });

  it("trims whitespace", () => {
    const result = parseOtlpHeaders(" key = value , other = val2 ");
    expect(result).toEqual({ key: "value", other: "val2" });
  });
});
