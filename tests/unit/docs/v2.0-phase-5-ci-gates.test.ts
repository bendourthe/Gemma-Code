import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("v2.0.0 Phase 5 CI hardware-gates doc", () => {
  const body = readFileSync(
    path.resolve("docs/v2/v2.0/ci-hardware-gates.md"),
    "utf8",
  );

  it("names the local opt-in flags for browser, audio, and patient-tier", () => {
    expect(body).toContain("NEXUS_BROWSER_PLAYWRIGHT=1");
    expect(body).toContain("NEXUS_AUDIO_STUB=1");
    expect(body).toContain("NEXUS_PATIENT_TIER_ADAPTER");
  });
});
