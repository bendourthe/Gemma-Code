import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const APP_SOURCE = readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");

describe("Phase 5 App occupancy wiring", () => {
  it("feeds free rather than total VRAM to submit gates", () => {
    expect(APP_SOURCE).toContain("setHostVramFreeGB(");
    expect(APP_SOURCE).toContain("hostVramFreeGB={hostVramFreeGB}");
  });

  it("polls the Studio scheduler snapshot and passes the active job", () => {
    expect(APP_SOURCE).toContain("fetchSchedulerSnapshot()");
    expect(APP_SOURCE).toContain("activeSchedulerJob={activeSchedulerJob}");
  });

  it("passes the resolved diffusion tier to both Studio pages", () => {
    expect(APP_SOURCE.split("diffusionTier={classifyDiffusionTier(hostVramGB ?? 0)}")).toHaveLength(3);
  });

  it("shares remembered switch pairs for this App session only", () => {
    expect(APP_SOURCE).toContain("useRef<ResidencySessionMemory>(new Set()).current");
    expect(APP_SOURCE).toContain("residencyMemory={residencyMemory}");
  });
});
