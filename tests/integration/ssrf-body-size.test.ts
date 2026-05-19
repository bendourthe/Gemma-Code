/**
 * Integration: Phase 3 (v0.6.0) -- bounded response body size in
 * `fetchWithSsrfGuard`.
 *
 * Closes pen-test F-002 / Attack Path C. Verifies three regression cases:
 *   (a) a chunked body whose total size exceeds the cap is aborted mid-stream;
 *   (b) a body within the cap streams through cleanly;
 *   (c) a `Content-Length` header that exceeds the cap rejects pre-stream.
 *
 * Uses real `Response` objects (constructed locally) rather than msw so the
 * `Content-Length` short-circuit can be exercised independently of any HTTP
 * mock library that may rewrite headers based on body length.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import {
  fetchWithSsrfGuard,
  DEFAULT_MAX_BODY_BYTES,
} from "../../modules/coding/utils/ssrf.js";

const TEST_URL = "https://example.com/payload";
const ONE_MB = 1024 * 1024;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("fetchWithSsrfGuard body-size cap", () => {
  it("exposes the documented 5 MB default", () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(5 * 1024 * 1024);
  });

  it("aborts a chunked body that exceeds the cap mid-stream", async () => {
    const chunkSize = 256 * 1024; // 256 KB per chunk
    const totalChunks = 40; // ~10 MB total
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (this._sent === undefined) (this as { _sent?: number })._sent = 0;
        const self = this as { _sent: number };
        if (self._sent >= totalChunks) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize));
        self._sent += 1;
      },
    } as UnderlyingSource<Uint8Array>);

    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    await expect(
      fetchWithSsrfGuard(TEST_URL, { maxBodyBytes: 5 * ONE_MB }),
    ).rejects.toThrow(/Response body too large/);
  });

  it("returns a body strictly under the cap unchanged", async () => {
    const payload = new Uint8Array(4 * ONE_MB).fill(0x41);
    fetchMock.mockResolvedValueOnce(
      new Response(payload, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    const response = await fetchWithSsrfGuard(TEST_URL, {
      maxBodyBytes: 5 * ONE_MB,
    });
    expect(response.status).toBe(200);
    const buffered = new Uint8Array(await response.arrayBuffer());
    expect(buffered.byteLength).toBe(4 * ONE_MB);
    expect(buffered[0]).toBe(0x41);
    expect(buffered[buffered.byteLength - 1]).toBe(0x41);
  });

  it("rejects pre-stream when Content-Length exceeds the cap", async () => {
    // Construct a Response with an explicit Content-Length header that is
    // larger than the actual body; the guard must abort on the header alone.
    const small = new Uint8Array(8).fill(0x00);
    const headers = new Headers({
      "Content-Length": String(6 * ONE_MB),
      "Content-Type": "application/octet-stream",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(small, { status: 200, headers }),
    );

    await expect(
      fetchWithSsrfGuard(TEST_URL, { maxBodyBytes: 5 * ONE_MB }),
    ).rejects.toThrow(/Response body too large: 6291456 bytes \(max 5242880\)/);
  });

  it("accepts text bodies under the default 5 MB cap end-to-end", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: new Headers() }),
    );

    const response = await fetchWithSsrfGuard(TEST_URL);
    expect(await response.text()).toBe("ok");
  });
});
