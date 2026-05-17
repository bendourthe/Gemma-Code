import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { ModelStorage } from "../../../../core/registry/ModelStorage.js";
import { Downloader, DigestMismatch } from "../../../../core/registry/Downloader.js";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function makeResponse(body: Buffer, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  }) as Response;
}

describe("Downloader", () => {
  let root: string;
  let storage: ModelStorage;
  let dl: Downloader;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-dl-"));
    storage = new ModelStorage(root);
    await storage.ensureLayout();
    dl = new Downloader(storage);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("downloads + verifies a full payload", async () => {
    const body = Buffer.from("hello downloader");
    const sha = sha256(body);
    const fakeFetch: typeof fetch = async (_url, _init) =>
      makeResponse(body, { headers: { "content-length": String(body.length) } });
    const result = await dl.download("https://example.test/x", sha, { fetch: fakeFetch });
    expect(result.sha256).toBe(sha);
    expect(result.bytes).toBe(body.length);
    expect(await storage.hasBlob(sha)).toBe(true);
  });

  it("rejects an SHA-256 mismatch and removes the .part file", async () => {
    const body = Buffer.from("payload");
    const expected = "0".repeat(64);
    const fakeFetch: typeof fetch = async () => makeResponse(body);
    await expect(
      dl.download("https://example.test/x", expected, { fetch: fakeFetch }),
    ).rejects.toBeInstanceOf(DigestMismatch);
    const partPath = path.join(storage.tmpDir(), `${expected}.part`);
    await expect(fs.stat(partPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed expected sha256", async () => {
    await expect(
      dl.download("https://example.test/x", "not-a-sha", { fetch: (async () => makeResponse(Buffer.alloc(0))) as typeof fetch }),
    ).rejects.toThrow(/malformed/);
  });

  it("resumes a partial download (server honors Range)", async () => {
    const full = Buffer.from("0123456789ABCDEF".repeat(16));
    const sha = sha256(full);
    const partPath = path.join(storage.tmpDir(), `${sha}.part`);
    const prefix = full.subarray(0, 100);
    await fs.writeFile(partPath, prefix);

    const seenHeaders: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      Object.assign(seenHeaders, headers);
      const rest = full.subarray(100);
      return makeResponse(rest, {
        status: 206,
        headers: {
          "content-length": String(rest.length),
          "content-range": `bytes 100-${full.length - 1}/${full.length}`,
        },
      });
    };

    const result = await dl.download("https://example.test/x", sha, { fetch: fakeFetch });
    expect(seenHeaders["Range"]).toBe(`bytes=100-`);
    expect(result.sha256).toBe(sha);
    expect(result.bytes).toBe(full.length);
  });

  it("handles a server that ignores Range (no 206)", async () => {
    const full = Buffer.from("FULL".repeat(64));
    const sha = sha256(full);
    const partPath = path.join(storage.tmpDir(), `${sha}.part`);
    await fs.writeFile(partPath, Buffer.from("stale prefix"));

    const fakeFetch: typeof fetch = async () =>
      makeResponse(full, { status: 200, headers: { "content-length": String(full.length) } });

    const result = await dl.download("https://example.test/x", sha, { fetch: fakeFetch });
    expect(result.sha256).toBe(sha);
    expect(result.bytes).toBe(full.length);
  });

  it("fires progress events at byte thresholds", async () => {
    const body = Buffer.alloc(700 * 1024, 0x41);
    const sha = sha256(body);
    const events: Array<{ b: number; t: number | null }> = [];
    const fakeFetch: typeof fetch = async () =>
      makeResponse(body, { headers: { "content-length": String(body.length) } });
    await dl.download("https://example.test/x", sha, {
      fetch: fakeFetch,
      onProgress: (b, t) => events.push({ b, t }),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]?.b).toBe(body.length);
  });

  it("propagates AbortSignal", async () => {
    const body = Buffer.alloc(1024 * 1024, 0x42);
    const sha = sha256(body);
    const controller = new AbortController();
    const fakeFetch: typeof fetch = async () => {
      controller.abort();
      return makeResponse(body, { headers: { "content-length": String(body.length) } });
    };
    await expect(
      dl.download("https://example.test/x", sha, { fetch: fakeFetch, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws when server returns non-2xx", async () => {
    const sha = "a".repeat(64);
    const fakeFetch: typeof fetch = async () => new Response(null, { status: 500 }) as Response;
    await expect(
      dl.download("https://example.test/x", sha, { fetch: fakeFetch }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
