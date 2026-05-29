import { describe, it, expect } from "vitest";
import { tokenize } from "../../../../core/observability/TokenCost.js";

describe("tokenize (TokenCost)", () => {
  it("returns 0 for the empty string", () => {
    expect(tokenize("")).toBe(0);
  });

  it("uses ceil(utf8_bytes / 4) for ASCII-only text", () => {
    // "hello" = 5 ASCII bytes -> ceil(5/4) = 2.
    expect(tokenize("hello")).toBe(2);
    // 8 ASCII bytes -> exactly 2 (no ceil rounding).
    expect(tokenize("abcdefgh")).toBe(2);
    // 1 byte -> ceil(1/4) = 1.
    expect(tokenize("a")).toBe(1);
  });

  it("counts multi-byte UTF-8 (Latin accents) by byte length, not char length", () => {
    // Each accented char is 2 UTF-8 bytes: "eee" with accents = 6 bytes.
    const accented = "éèê"; // é è ê
    expect(Buffer.byteLength(accented, "utf8")).toBe(6);
    expect(tokenize(accented)).toBe(2); // ceil(6/4)
  });

  it("under-estimates emoji + CJK text relative to char count", () => {
    // Emoji is 4 UTF-8 bytes; each CJK char is 3 bytes.
    const mixed = "\u{1F600}你好"; // 😀你好 = 4 + 3 + 3 = 10 bytes
    expect(Buffer.byteLength(mixed, "utf8")).toBe(10);
    expect(tokenize(mixed)).toBe(3); // ceil(10/4) = 3, well under the 3-char count's real token cost
  });
});
