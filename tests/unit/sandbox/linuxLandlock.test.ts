import { describe, expect, it } from "vitest";

import { probeLinuxLandlock } from "../../../modules/coding/sandbox/backends/linuxLandlock.js";

describe("probeLinuxLandlock", () => {
  it("is unavailable on non-linux platforms", () => {
    const cap = probeLinuxLandlock("win32");
    expect(cap.available).toBe(false);
    expect(cap.backendId).toBe("linux-landlock");
    expect(cap.detail).toMatch(/Linux/);
  });
});
