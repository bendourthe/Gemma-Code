import { describe, expect, it } from "vitest";
import { isUsableImageBase64, isUsableVideoPath } from "../src/shared/studio/usablePayload";

const ONE_BY_ONE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
describe("usablePayload", () => {
  it("rejects empty, whitespace, and invalid base64", () => {
    expect(isUsableImageBase64("")).toBe(false);
    expect(isUsableImageBase64("   ")).toBe(false);
    expect(isUsableImageBase64("!!!")).toBe(false);
    expect(isUsableImageBase64(null)).toBe(false);
  });

  it("rejects a 1x1 PNG and accepts a larger PNG or opaque base64 stub", () => {
    expect(isUsableImageBase64(ONE_BY_ONE)).toBe(false);
    expect(isUsableImageBase64("PNG==")).toBe(true);
  });

  it("rejects blank video paths", () => {
    expect(isUsableVideoPath("")).toBe(false);
    expect(isUsableVideoPath("  ")).toBe(false);
    expect(isUsableVideoPath("/tmp/out.mp4")).toBe(true);
  });
});
