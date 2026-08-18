import { describe, expect, it } from "vitest";

import { formatSandboxSummary, inferSandboxMode, reportFromCapability } from "../../../modules/coding/sandbox/report.js";
import { UNCONFINED_TOKEN, type SandboxCapability } from "../../../modules/coding/sandbox/types.js";

const cap: SandboxCapability = {
  platform: "darwin",
  backendId: "macos-seatbelt",
  available: true,
  detail: "sandbox-exec present",
  enforced: ["filesystem", "network"],
  unenforced: ["process-limits", "restricted-token"],
};

describe("formatSandboxSummary", () => {
  it("uses the unconfined token when the setting is off", () => {
    const text = formatSandboxSummary({
      enabled: false,
      mode: "unconfined",
      backendId: "none",
      detail: "off",
      unenforced: [],
    });
    expect(text).toContain(UNCONFINED_TOKEN);
    expect(text).toMatch(/execSandbox is off/);
  });

  it("states partial confinement with unenforced dimensions", () => {
    const text = formatSandboxSummary({
      enabled: true,
      mode: "partial",
      backendId: "windows-job",
      detail: "job object",
      unenforced: ["filesystem", "network"],
    });
    expect(text).toMatch(/partial/);
    expect(text).toMatch(/filesystem/);
    expect(text).not.toContain(`sandbox: ${UNCONFINED_TOKEN}`);
  });

  it("states partial confinement even when every listed dimension is enforced", () => {
    const text = formatSandboxSummary({
      enabled: true,
      mode: "partial",
      backendId: "windows-job",
      detail: "job object",
      unenforced: [],
    });
    expect(text).toMatch(/partial \(windows-job; job object\)/);
  });
});

describe("inferSandboxMode", () => {
  it("is unconfined when nothing is enforced even if the probe says available", () => {
    expect(
      inferSandboxMode(true, {
        platform: "linux",
        backendId: "linux-landlock",
        available: true,
        detail: "empty",
        enforced: [],
        unenforced: ["filesystem", "network"],
      }),
    ).toBe("unconfined");
  });

  it("is partial when only process limits are enforced", () => {
    expect(
      inferSandboxMode(true, {
        platform: "win32",
        backendId: "windows-job",
        available: true,
        detail: "job",
        enforced: ["process-limits"],
        unenforced: ["filesystem", "network"],
      }),
    ).toBe("partial");
  });
});

describe("reportFromCapability", () => {
  it("is unconfined when disabled even if a backend is available", () => {
    const report = reportFromCapability(false, cap);
    expect(report.mode).toBe("unconfined");
    expect(report.summary).toContain(UNCONFINED_TOKEN);
  });

  it("is confined when filesystem and network are enforced, even if job limits are N/A", () => {
    const report = reportFromCapability(true, cap);
    expect(report.mode).toBe("confined");
  });
});
