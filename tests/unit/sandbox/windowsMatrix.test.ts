import { describe, expect, it } from "vitest";

import { probeWindowsJob } from "../../../modules/coding/sandbox/backends/windowsJob.js";
import {
  WINDOWS_ENFORCEMENT_MATRIX,
  WINDOWS_UNENFORCED_DIMENSIONS,
  formatWindowsMatrixMarkdown,
} from "../../../modules/coding/sandbox/windowsMatrix.js";

describe("WINDOWS_ENFORCEMENT_MATRIX", () => {
  it("states filesystem and network as not kernel-enforced", () => {
    expect(WINDOWS_UNENFORCED_DIMENSIONS).toContain("filesystem");
    expect(WINDOWS_UNENFORCED_DIMENSIONS).toContain("network");
    const fs = WINDOWS_ENFORCEMENT_MATRIX.find((r) => r.dimension === "filesystem");
    const net = WINDOWS_ENFORCEMENT_MATRIX.find((r) => r.dimension === "network");
    expect(fs?.enforced).toBe(false);
    expect(net?.enforced).toBe(false);
    expect(WINDOWS_ENFORCEMENT_MATRIX.find((r) => r.dimension === "process-limits")?.enforced).toBe(
      true,
    );
  });

  it("renders a markdown table that says NO for unenforced dimensions", () => {
    const md = formatWindowsMatrixMarkdown();
    expect(md).toMatch(/filesystem/);
    expect(md).toMatch(/\| NO \|/);
  });
});

describe("probeWindowsJob", () => {
  it("is unavailable on non-win32 platforms", () => {
    const cap = probeWindowsJob("linux");
    expect(cap.available).toBe(false);
  });
});
