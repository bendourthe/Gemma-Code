import { describe, expect, it } from "vitest";

import {
  FOLLOWUP_IMG2IMG_STRENGTH,
  pngToDataUrl,
  resolveFollowUpSourceImage,
  stripToRawImageBytes,
} from "../src/modules/image/followUpSource";

describe("followUpSource", () => {
  it("prefers in-session PNG bytes over a filesystem lastOutputRef", () => {
    expect(
      resolveFollowUpSourceImage({
        lastPngBase64: "PNGB64==",
        lastOutputRef: "/tmp/fox.png",
      }),
    ).toBe("data:image/png;base64,PNGB64==");
    expect(FOLLOWUP_IMG2IMG_STRENGTH).toBeLessThan(0.75);
  });

  it("keeps a user attachment ahead of the last output", () => {
    expect(
      resolveFollowUpSourceImage({
        attachment: "data:image/png;base64,ATT",
        lastPngBase64: "PNGB64==",
        lastOutputRef: "/tmp/fox.png",
      }),
    ).toBe("data:image/png;base64,ATT");
  });

  it("strips a data URL to raw bytes for segment", () => {
    expect(stripToRawImageBytes(pngToDataUrl("AAA"))).toBe("AAA");
  });
});
