import { describe, expect, it } from "vitest";

import { studioPersistUsage } from "../src/shared/studio/studioTurnUsage";

describe("studioPersistUsage", () => {
  it("estimates user prompt tokens and does not count a visual unit", () => {
    const usage = studioPersistUsage({ role: "user", content: "abcd" });
    expect(usage.inputTokens).toBe(1);
    expect(usage.tokensEstimated).toBe(true);
    expect(usage.visualUnits).toBe(0);
  });

  it("counts a usable mediaRef as one visual unit and a stub without media as zero", () => {
    expect(
      studioPersistUsage({ role: "assistant", content: "", mediaRef: "/tmp/fox.png" }).visualUnits,
    ).toBe(1);
    expect(studioPersistUsage({ role: "assistant", content: "stub" }).visualUnits).toBe(0);
  });
});
