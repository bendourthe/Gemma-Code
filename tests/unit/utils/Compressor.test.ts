import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "crypto";
import {
  shouldCompress,
  compress,
  decompress,
  compressSync,
  decompressSync,
  decode,
  decodeSync,
  isCompressedToolOutput,
  resetCompressionStats,
  resetProbeCache,
  getCompressionStats,
  MIN_COMPRESS_BYTES,
  SYNC_COMPRESS_CEILING,
  type CompressedToolOutput,
} from "../../../modules/coding/utils/Compressor.js";

const LOREM_PARAGRAPH =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris " +
  "nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in " +
  "reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla " +
  "pariatur. Excepteur sint occaecat cupidatat non proident, sunt in " +
  "culpa qui officia deserunt mollit anim id est laborum. ";

function lorem(byteTarget: number): string {
  let out = "";
  while (Buffer.byteLength(out, "utf8") < byteTarget) {
    out += LOREM_PARAGRAPH;
  }
  return out;
}

describe("Compressor", () => {
  beforeEach(() => {
    resetCompressionStats();
    resetProbeCache();
  });

  // -------------------------------------------------------------------------
  // shouldCompress
  // -------------------------------------------------------------------------

  describe("shouldCompress()", () => {
    it("rejects null/undefined input with TypeError", () => {
      expect(() => shouldCompress(null as unknown as string)).toThrow(TypeError);
      expect(() => shouldCompress(undefined as unknown as string)).toThrow(TypeError);
    });

    it("returns false for an empty string and increments skippedBelowThreshold", () => {
      expect(shouldCompress("")).toBe(false);
      expect(getCompressionStats().skippedBelowThreshold).toBe(1);
    });

    it("returns false for a 100-byte input (below MIN_COMPRESS_BYTES)", () => {
      const input = "a".repeat(100);
      expect(Buffer.byteLength(input, "utf8")).toBeLessThan(MIN_COMPRESS_BYTES);
      expect(shouldCompress(input)).toBe(false);
      expect(getCompressionStats().skippedBelowThreshold).toBe(1);
    });

    it("returns true for 10 KB lorem-ipsum (high compressibility)", () => {
      const input = lorem(10 * 1024);
      expect(shouldCompress(input)).toBe(true);
    });

    it("returns false for high-entropy random bytes (low savings)", () => {
      // Raw random bytes have ~8 bits/byte of entropy; Brotli cannot beat the
      // 20% savings bar on truly random data.
      const input = crypto.randomBytes(2 * 1024);
      expect(shouldCompress(input)).toBe(false);
      expect(getCompressionStats().skippedLowSavings).toBeGreaterThanOrEqual(1);
    });

    it("caches probe results so repeated calls do not re-probe", () => {
      const input = lorem(2 * 1024);
      // Prime the cache.
      expect(shouldCompress(input)).toBe(true);
      const before = getCompressionStats();
      // Call again — must hit the LRU and not change skipped counters.
      expect(shouldCompress(input)).toBe(true);
      const after = getCompressionStats();
      expect(after.skippedBelowThreshold).toBe(before.skippedBelowThreshold);
      expect(after.skippedLowSavings).toBe(before.skippedLowSavings);
    });

    it("accepts a Buffer input", () => {
      const buf = Buffer.from(lorem(2 * 1024), "utf8");
      expect(shouldCompress(buf)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // compress / decompress (async)
  // -------------------------------------------------------------------------

  describe("compress() / decompress()", () => {
    it("compresses a 10 KB lorem-ipsum payload by at least 50%", async () => {
      const input = lorem(10 * 1024);
      const result = await compress(input);
      expect(result.originalBytes).toBe(Buffer.byteLength(input, "utf8"));
      expect(result.compressedBytes).toBeLessThanOrEqual(result.originalBytes / 2);
      expect(result.ratio).toBeGreaterThanOrEqual(0.5);
    });

    it("round-trips UTF-8 with emoji and CJK characters byte-for-byte", async () => {
      const input =
        "Hello 世界 🌍! 日本語のテキスト " +
        "with emoji 🎉🚀✨ and 漢字混合 — " +
        lorem(2 * 1024);
      const { data } = await compress(input);
      const decoded = await decompress(data);
      expect(decoded).toBe(input);
    });

    it("rejects non-string input", async () => {
      await expect(compress(42 as unknown as string)).rejects.toBeInstanceOf(TypeError);
      await expect(compress(null as unknown as string)).rejects.toBeInstanceOf(TypeError);
    });

    it("decompress rejects non-Buffer input", async () => {
      await expect(decompress("not a buffer" as unknown as Buffer)).rejects.toBeInstanceOf(
        TypeError,
      );
    });

    it("updates originalBytes / compressedBytes telemetry", async () => {
      const input = lorem(4 * 1024);
      await compress(input);
      const stats = getCompressionStats();
      expect(stats.originalBytes).toBe(Buffer.byteLength(input, "utf8"));
      expect(stats.compressedBytes).toBeGreaterThan(0);
      expect(stats.compressedBytes).toBeLessThan(stats.originalBytes);
    });
  });

  // -------------------------------------------------------------------------
  // compressSync / decompressSync
  // -------------------------------------------------------------------------

  describe("compressSync() / decompressSync()", () => {
    it("round-trips an ASCII string under the sync ceiling", () => {
      const input = lorem(1 * 1024);
      const { data } = compressSync(input);
      expect(decompressSync(data)).toBe(input);
    });

    it("round-trips emoji and CJK in sync mode", () => {
      const input = "短い文字列 🎉";
      const { data } = compressSync(input);
      expect(decompressSync(data)).toBe(input);
    });

    it("rejects inputs above the sync ceiling with RangeError", () => {
      const tooBig = "a".repeat(SYNC_COMPRESS_CEILING + 1);
      expect(() => compressSync(tooBig)).toThrow(RangeError);
    });

    it("rejects non-string input with TypeError", () => {
      expect(() => compressSync(123 as unknown as string)).toThrow(TypeError);
    });

    it("decompressSync rejects non-Buffer input", () => {
      expect(() => decompressSync("oops" as unknown as Buffer)).toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------------
  // decode / decodeSync
  // -------------------------------------------------------------------------

  describe("decode() / decodeSync()", () => {
    it("passes through plain strings idempotently (async)", async () => {
      expect(await decode("plain text")).toBe("plain text");
    });

    it("passes through plain strings idempotently (sync)", () => {
      expect(decodeSync("plain text")).toBe("plain text");
    });

    it("decompresses a CompressedToolOutput back to its original string", async () => {
      const input = lorem(2 * 1024);
      const { data, originalBytes } = await compress(input);
      const wrapped: CompressedToolOutput = { encoding: "br", data, originalBytes };
      expect(await decode(wrapped)).toBe(input);
      expect(decodeSync(wrapped)).toBe(input);
    });

    it("rejects non-string non-CompressedToolOutput values", async () => {
      await expect(decode(42 as unknown as string)).rejects.toBeInstanceOf(TypeError);
      expect(() => decodeSync(42 as unknown as string)).toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------------
  // isCompressedToolOutput
  // -------------------------------------------------------------------------

  describe("isCompressedToolOutput()", () => {
    it("returns true for a valid CompressedToolOutput", async () => {
      const { data, originalBytes } = await compress(lorem(2 * 1024));
      expect(isCompressedToolOutput({ encoding: "br", data, originalBytes })).toBe(true);
    });

    it("returns false for plain strings, nulls, and wrong shapes", () => {
      expect(isCompressedToolOutput("hello")).toBe(false);
      expect(isCompressedToolOutput(null)).toBe(false);
      expect(isCompressedToolOutput({ encoding: "gz", data: Buffer.alloc(1) })).toBe(false);
      expect(isCompressedToolOutput({ encoding: "br", data: "not a buffer" })).toBe(false);
    });
  });
});
