import { describe, expect, it } from "vitest";

import { capVideoFrames, enforceVisualBudget } from "../../../../core/chat/visualBudget.js";
import { kindFromMime, validateImageBytes } from "../../../../core/chat/attachments.js";
import { createMinimalPng } from "../../../../core/image/WorkflowMetadata.js";
import { DEFAULT_VISUAL_TOKEN_BUDGET } from "../../../../core/chat/vision.js";

function oversizedPng(): Uint8Array {
  const bytes = new Uint8Array(createMinimalPng());
  bytes[16] = 0;
  bytes[17] = 0;
  bytes[18] = 0x10;
  bytes[19] = 0;
  bytes[20] = 0;
  bytes[21] = 0;
  bytes[22] = 0x10;
  bytes[23] = 0;
  return bytes;
}

describe("validateImageBytes", () => {
  it("accepts a real PNG and rejects truncated or mismatched bytes", () => {
    expect(validateImageBytes(new Uint8Array(createMinimalPng()), "image/png").kind).toBe("image");
    expect(validateImageBytes(new Uint8Array([1, 2, 3])).kind).toBe("rejected");
    expect(validateImageBytes(new TextEncoder().encode("not-a-png!"), "image/png").kind).toBe(
      "rejected",
    );
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(validateImageBytes(jpeg, "image/png").reason).toMatch(/does not match/);
  });

  it("maps mime types to attachment kinds", () => {
    expect(kindFromMime("image/png")).toBe("image");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("audio/wav")).toBe("audio");
    expect(kindFromMime("application/pdf")).toBe("document");
  });
});

describe("enforceVisualBudget", () => {
  it("skips a PNG whose pixel count exceeds the budget", () => {
    const result = enforceVisualBudget(
      [{ bytes: oversizedPng(), mime: "image/png" }],
      DEFAULT_VISUAL_TOKEN_BUDGET,
    );
    expect(result.images).toHaveLength(0);
    expect(result.notices.some((n) => n.includes("exceeds"))).toBe(true);
  });

  it("keeps only maxImages and records extra-attachment notices", () => {
    const png = new Uint8Array(createMinimalPng());
    const result = enforceVisualBudget(
      [
        { bytes: png, mime: "image/png" },
        { bytes: png, mime: "image/png" },
      ],
      { ...DEFAULT_VISUAL_TOKEN_BUDGET, maxImages: 1 },
    );
    expect(result.images).toHaveLength(1);
    expect(result.notices.some((n) => n.includes("Kept the first"))).toBe(true);
  });

  it("rejects malformed magic instead of forwarding bytes", () => {
    const result = enforceVisualBudget(
      [{ bytes: new TextEncoder().encode("not-a-png!"), mime: "image/png" }],
      DEFAULT_VISUAL_TOKEN_BUDGET,
    );
    expect(result.images).toHaveLength(0);
    expect(result.rejected.length).toBeGreaterThan(0);
  });
});

describe("capVideoFrames", () => {
  it("truncates to maxVideoFrames and explains the sample", () => {
    const capped = capVideoFrames(20, { ...DEFAULT_VISUAL_TOKEN_BUDGET, maxVideoFrames: 8 });
    expect(capped.keep).toBe(8);
    expect(capped.notice).toMatch(/Sampled 8 of 20/);
    expect(capVideoFrames(3, DEFAULT_VISUAL_TOKEN_BUDGET).notice).toBeUndefined();
  });
});
