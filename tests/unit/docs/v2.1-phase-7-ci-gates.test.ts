import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("v2.1.0 Phase 7 CI hardware-gates doc", () => {
  const body = readFileSync(path.resolve("docs/v2/v2.1/ci-hardware-gates.md"), "utf8");

  it("names local opt-in flags for live tuning and documents streaming as hardware-gated", () => {
    expect(body).toContain("NEXUS_TUNING_LIVE=1");
    expect(body).toContain("layer streaming");
    expect(body).toContain("tuning-live.yml");
  });
});
