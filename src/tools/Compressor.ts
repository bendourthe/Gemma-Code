import * as crypto from "crypto";
import * as zlib from "zlib";
import { promisify } from "util";

/**
 * Phase 3 (v0.5.0) — Brotli-based tool-output compressor.
 *
 * Self-contained: depends only on Node's built-in `zlib` and `crypto`. No new
 * npm dependencies. Offline-first by construction (no network paths).
 *
 * Public surface:
 *   - shouldCompress(input)        — gate at 500 bytes + 20% savings probe
 *   - compress / decompress        — async Brotli round-trip at quality 4, text mode
 *   - compressSync / decompressSync — sync siblings; compressSync rejects > 4 KB
 *   - getCompressionStats / resetCompressionStats — module-level telemetry
 *
 * Telemetry counters mirror the established `getTruncationStats()` pattern in
 * OutputRedirector (Phase 2). Four events are tracked:
 *   - original_bytes          (cumulative pre-compression UTF-8 bytes)
 *   - compressed_bytes        (cumulative post-compression bytes)
 *   - skipped_below_threshold (calls where input < 500 B)
 *   - skipped_low_savings     (calls where probe ratio < 20%)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressedToolOutput {
  readonly encoding: "br";
  readonly data: Buffer;
  readonly originalBytes: number;
}

export type MaybeCompressed = string | CompressedToolOutput;

export interface CompressionResult {
  readonly data: Buffer;
  readonly originalBytes: number;
  readonly compressedBytes: number;
  /** Compression ratio: 1 - compressedBytes/originalBytes (e.g. 0.7 = 70% saved). */
  readonly ratio: number;
}

export interface CompressionStats {
  readonly originalBytes: number;
  readonly compressedBytes: number;
  readonly skippedBelowThreshold: number;
  readonly skippedLowSavings: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Inputs at or above this many UTF-8 bytes are eligible for compression. */
export const MIN_COMPRESS_BYTES = 500;

/** Compression must save at least this fraction (20%) to be considered worthwhile. */
export const MIN_SAVINGS_RATIO = 0.2;

/** compressSync hard cap on input size; larger inputs must use async compress(). */
export const SYNC_COMPRESS_CEILING = 4 * 1024;

/** Brotli quality level — 4 balances throughput and ratio for tool outputs. */
export const BROTLI_QUALITY = 4;

const BROTLI_OPTIONS = {
  params: {
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
  },
};

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

const _stats = {
  originalBytes: 0,
  compressedBytes: 0,
  skippedBelowThreshold: 0,
  skippedLowSavings: 0,
};

/** Snapshot of cumulative compression telemetry. */
export function getCompressionStats(): CompressionStats {
  return { ..._stats };
}

/** Reset telemetry counters (test-only helper). */
export function resetCompressionStats(): void {
  _stats.originalBytes = 0;
  _stats.compressedBytes = 0;
  _stats.skippedBelowThreshold = 0;
  _stats.skippedLowSavings = 0;
}

// ---------------------------------------------------------------------------
// Probe LRU
// ---------------------------------------------------------------------------

const PROBE_CACHE_CAPACITY = 64;
const PROBE_KEY_BYTES = 4 * 1024;

const _probeCache = new Map<string, boolean>();

function _probeKey(input: string | Buffer): string {
  const head = Buffer.isBuffer(input)
    ? input.subarray(0, PROBE_KEY_BYTES)
    : Buffer.from(input.slice(0, PROBE_KEY_BYTES), "utf8");
  // SHA-256 fingerprint for the in-memory probe LRU. No security claim is
  // attached; the upgrade from SHA-1 silences audit-tool noise per pen-test
  // F-010.
  return crypto.createHash("sha256").update(head).digest("hex");
}

function _probeRemember(key: string, value: boolean): void {
  if (_probeCache.has(key)) _probeCache.delete(key);
  _probeCache.set(key, value);
  if (_probeCache.size > PROBE_CACHE_CAPACITY) {
    const oldest = _probeCache.keys().next().value;
    if (oldest !== undefined) _probeCache.delete(oldest);
  }
}

/** Reset the probe cache (test-only helper). */
export function resetProbeCache(): void {
  _probeCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _brotliCompressAsync = promisify(zlib.brotliCompress);
const _brotliDecompressAsync = promisify(zlib.brotliDecompress);

function _toBuffer(input: string | Buffer): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
}

function _byteLength(input: string | Buffer): number {
  return Buffer.isBuffer(input) ? input.length : Buffer.byteLength(input, "utf8");
}

// ---------------------------------------------------------------------------
// Public API — shouldCompress
// ---------------------------------------------------------------------------

/**
 * Returns true when `input` is large enough and compresses well enough to be
 * worth the round-trip cost. Probes Brotli at quality 4 in BROTLI_MODE_TEXT and
 * caches the verdict via a 64-entry LRU keyed by SHA-1 of the first 4 KB so
 * callers can ask twice for free.
 *
 * Updates the `skippedBelowThreshold` and `skippedLowSavings` counters when the
 * verdict is `false`, so observers can distinguish "too small to bother"
 * from "compresses poorly".
 */
export function shouldCompress(input: string | Buffer): boolean {
  if (input === null || input === undefined) {
    throw new TypeError("shouldCompress: input must be a string or Buffer");
  }
  const size = _byteLength(input);
  if (size < MIN_COMPRESS_BYTES) {
    _stats.skippedBelowThreshold += 1;
    return false;
  }

  const key = _probeKey(input);
  const cached = _probeCache.get(key);
  if (cached !== undefined) {
    if (!cached) _stats.skippedLowSavings += 1;
    return cached;
  }

  const probeBuf = _toBuffer(input);
  const probed = zlib.brotliCompressSync(probeBuf, BROTLI_OPTIONS);
  const ratio = 1 - probed.length / probeBuf.length;
  const verdict = ratio >= MIN_SAVINGS_RATIO;
  _probeRemember(key, verdict);
  if (!verdict) _stats.skippedLowSavings += 1;
  return verdict;
}

// ---------------------------------------------------------------------------
// Public API — compress / decompress
// ---------------------------------------------------------------------------

/** Brotli-compress a string at quality 4, text mode. */
export async function compress(input: string): Promise<CompressionResult> {
  if (typeof input !== "string") {
    throw new TypeError("compress: input must be a string");
  }
  const inputBuf = Buffer.from(input, "utf8");
  const data = (await _brotliCompressAsync(inputBuf, BROTLI_OPTIONS)) as Buffer;
  const originalBytes = inputBuf.length;
  const compressedBytes = data.length;
  _stats.originalBytes += originalBytes;
  _stats.compressedBytes += compressedBytes;
  return {
    data,
    originalBytes,
    compressedBytes,
    ratio: originalBytes === 0 ? 0 : 1 - compressedBytes / originalBytes,
  };
}

/** Inverse of `compress`. Returns the original UTF-8 string. */
export async function decompress(buffer: Buffer): Promise<string> {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("decompress: input must be a Buffer");
  }
  const out = (await _brotliDecompressAsync(buffer)) as Buffer;
  return out.toString("utf8");
}

/**
 * Synchronous Brotli compression. Refuses inputs larger than
 * SYNC_COMPRESS_CEILING (4 KB) — those callers must use the async `compress`.
 */
export function compressSync(input: string): CompressionResult {
  if (typeof input !== "string") {
    throw new TypeError("compressSync: input must be a string");
  }
  const inputBuf = Buffer.from(input, "utf8");
  if (inputBuf.length > SYNC_COMPRESS_CEILING) {
    throw new RangeError(
      `compressSync: input is ${inputBuf.length} bytes which exceeds the sync ceiling of ${SYNC_COMPRESS_CEILING}. ` +
        `Use the async compress() instead.`,
    );
  }
  const data = zlib.brotliCompressSync(inputBuf, BROTLI_OPTIONS);
  const originalBytes = inputBuf.length;
  const compressedBytes = data.length;
  _stats.originalBytes += originalBytes;
  _stats.compressedBytes += compressedBytes;
  return {
    data,
    originalBytes,
    compressedBytes,
    ratio: originalBytes === 0 ? 0 : 1 - compressedBytes / originalBytes,
  };
}

/** Synchronous inverse of `compressSync` / `compress`. */
export function decompressSync(buffer: Buffer): string {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("decompressSync: input must be a Buffer");
  }
  const out = zlib.brotliDecompressSync(buffer);
  return out.toString("utf8");
}

/**
 * Sync compression for callers that legitimately need it on inputs above
 * SYNC_COMPRESS_CEILING (e.g. OutputRedirector, which is itself synchronous and
 * sits off the hot tool-execution path). Updates module telemetry just like
 * `compressSync`. General callers should prefer the async `compress`.
 */
export function compressSyncLarge(input: string): CompressionResult {
  if (typeof input !== "string") {
    throw new TypeError("compressSyncLarge: input must be a string");
  }
  const inputBuf = Buffer.from(input, "utf8");
  const data = zlib.brotliCompressSync(inputBuf, BROTLI_OPTIONS);
  const originalBytes = inputBuf.length;
  const compressedBytes = data.length;
  _stats.originalBytes += originalBytes;
  _stats.compressedBytes += compressedBytes;
  return {
    data,
    originalBytes,
    compressedBytes,
    ratio: originalBytes === 0 ? 0 : 1 - compressedBytes / originalBytes,
  };
}

// ---------------------------------------------------------------------------
// Public API — decode helper for downstream consumers
// ---------------------------------------------------------------------------

/**
 * Idempotent decoder for tool-output values that may or may not be compressed.
 * Strings pass through unchanged; CompressedToolOutput values are
 * Brotli-decompressed back to their original UTF-8 string.
 */
export async function decode(value: MaybeCompressed): Promise<string> {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && value.encoding === "br") {
    return decompress(value.data);
  }
  throw new TypeError("decode: value must be a string or CompressedToolOutput");
}

/** Synchronous variant of `decode`. */
export function decodeSync(value: MaybeCompressed): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && value.encoding === "br") {
    return decompressSync(value.data);
  }
  throw new TypeError("decodeSync: value must be a string or CompressedToolOutput");
}

/** Type guard for `CompressedToolOutput`. */
export function isCompressedToolOutput(value: unknown): value is CompressedToolOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { encoding?: unknown }).encoding === "br" &&
    Buffer.isBuffer((value as { data?: unknown }).data)
  );
}
