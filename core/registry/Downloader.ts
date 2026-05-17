/**
 * v1.0.0 Phase 5.2 -- resumable + SHA-256-verified HTTP downloader.
 *
 * Streams an HTTP body to `~/.nexus/models/_tmp/<sha256>.part`, sending a
 * `Range: bytes=<offset>-` header when a partial file already exists. Hashes
 * the entire payload (including any pre-existing prefix) and refuses to
 * promote the file unless the digest matches `expectedSha256`. On success
 * the `.part` file is renamed into the storage layer's blob path.
 *
 * Cancellation: pass `signal` (an `AbortSignal`). When aborted, the partial
 * file is preserved so a subsequent call resumes from the same offset.
 *
 * Progress events fire every 256 KB OR every 500 ms, whichever first.
 * Consumers receive `{ downloaded, total | null }` where `total` is the
 * sum of the prefix size and the `Content-Length` (or `Content-Range`
 * total) returned by the server, or `null` when neither header is present.
 *
 * No external library: uses Node's native `fetch` plus `crypto.createHash`.
 */

import { promises as fs, createWriteStream, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { Readable } from "node:stream";

import type { ModelStorage } from "./ModelStorage.js";

const PROGRESS_BYTES = 256 * 1024;
const PROGRESS_MS = 500;
const SHA256_RE = /^[a-f0-9]{64}$/;

export class DigestMismatch extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`Downloader: SHA-256 mismatch (expected ${expected}, got ${actual})`);
    this.name = "DigestMismatch";
  }
}

export interface DownloadOptions {
  resumeFrom?: number;
  signal?: AbortSignal;
  onProgress?: (bytes: number, total: number | null) => void;
  /**
   * Injectable fetch impl for tests. Defaults to the global `fetch`.
   */
  fetch?: typeof fetch;
  /**
   * Injectable clock for tests. Defaults to `Date.now`.
   */
  now?: () => number;
}

export interface DownloadResult {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export class Downloader {
  constructor(private readonly _storage: ModelStorage) {}

  async download(
    url: string,
    expectedSha256: string,
    opts: DownloadOptions = {},
  ): Promise<DownloadResult> {
    if (!SHA256_RE.test(expectedSha256)) {
      throw new Error(`Downloader: expected sha256 is malformed: ${expectedSha256}`);
    }
    await this._storage.ensureLayout();
    const tmpPath = path.join(this._storage.tmpDir(), `${expectedSha256}.part`);
    const fetchImpl = opts.fetch ?? (globalThis.fetch as typeof fetch);
    const now = opts.now ?? Date.now;

    // Determine how far the .part already extends.
    let prefix = 0;
    try {
      const stat = await fs.stat(tmpPath);
      if (stat.isFile()) prefix = stat.size;
    } catch {
      // first attempt -- no .part yet
    }
    if (typeof opts.resumeFrom === "number" && opts.resumeFrom >= 0) {
      prefix = opts.resumeFrom;
    }

    // Hash the existing prefix (if any) so the final digest covers the whole file.
    const hash = createHash("sha256");
    if (prefix > 0) {
      await streamThroughHash(createReadStream(tmpPath, { end: prefix - 1 }), hash);
    }

    const headers: Record<string, string> = {};
    if (prefix > 0) headers["Range"] = `bytes=${prefix}-`;
    const res = await fetchImpl(url, { headers, signal: opts.signal });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Downloader: HTTP ${res.status} for ${url}`);
    }
    if (prefix > 0 && res.status !== 206) {
      // Server ignored the Range header and re-sent the whole file. Reset
      // both the prefix hash and the .part file.
      hash.destroy();
      const freshHash = createHash("sha256");
      await fs.rm(tmpPath, { force: true });
      return this._stream(res, expectedSha256, tmpPath, freshHash, 0, opts, now);
    }
    return this._stream(res, expectedSha256, tmpPath, hash, prefix, opts, now);
  }

  private async _stream(
    res: Response,
    expectedSha256: string,
    tmpPath: string,
    hash: ReturnType<typeof createHash>,
    prefix: number,
    opts: DownloadOptions,
    now: () => number,
  ): Promise<DownloadResult> {
    const contentLength = parseContentLength(res, prefix);
    const total = contentLength === null ? null : contentLength;
    const out = createWriteStream(tmpPath, { flags: prefix > 0 ? "a" : "w" });

    if (!res.body) {
      out.end();
      throw new Error("Downloader: response has no body");
    }

    let downloaded = prefix;
    let lastProgressBytes = prefix;
    let lastProgressAt = now();
    const onProgress = opts.onProgress;
    const fireProgress = (): void => {
      if (!onProgress) return;
      onProgress(downloaded, total);
      lastProgressBytes = downloaded;
      lastProgressAt = now();
    };

    try {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (opts.signal?.aborted) {
          await safeEnd(out);
          throw new DOMException("Aborted", "AbortError");
        }
        const chunk = Buffer.from(value);
        hash.update(chunk);
        downloaded += chunk.length;
        const canWrite = out.write(chunk);
        if (!canWrite) {
          await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        }
        const bytesSince = downloaded - lastProgressBytes;
        const msSince = now() - lastProgressAt;
        if (bytesSince >= PROGRESS_BYTES || msSince >= PROGRESS_MS) {
          fireProgress();
        }
      }
    } catch (err) {
      await safeEnd(out);
      throw err;
    }

    await safeEnd(out);
    fireProgress();

    const actual = hash.digest("hex");
    if (actual !== expectedSha256) {
      await fs.rm(tmpPath, { force: true });
      throw new DigestMismatch(expectedSha256, actual);
    }

    const finalPath = this._storage.blobPath(expectedSha256);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.rename(tmpPath, finalPath);
    return { path: finalPath, sha256: actual, bytes: downloaded };
  }
}

function parseContentLength(res: Response, prefix: number): number | null {
  const range = res.headers.get("content-range");
  if (range) {
    // bytes <start>-<end>/<total>
    const m = /\/(\d+)$/.exec(range);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  const cl = res.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n)) return prefix + n;
  }
  return null;
}

function safeEnd(out: NodeJS.WritableStream): Promise<void> {
  return new Promise<void>((resolve) => {
    out.end(() => resolve());
  });
}

function streamThroughHash(stream: Readable, hash: ReturnType<typeof createHash>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
}
