import { describe, expect, it } from "vitest";

import { createUnconfinedBackend } from "../../../modules/coding/sandbox/backends/unconfined.js";
import { deriveDefaultPolicy } from "../../../modules/coding/sandbox/policy.js";
import {
  describeSandbox,
  sandboxRequiresEnhancedConfirmation,
  spawnSandboxed,
} from "../../../modules/coding/sandbox/spawnSandboxed.js";
import {
  UNCONFINED_TOKEN,
  type SandboxBackend,
  type SandboxCapability,
} from "../../../modules/coding/sandbox/types.js";

function unavailableBackend(): SandboxBackend {
  const capability: SandboxCapability = {
    platform: "linux",
    backendId: "linux-landlock",
    available: false,
    detail: "Landlock not in LSM list (degraded)",
    enforced: [],
    unenforced: ["filesystem", "network", "process-limits", "restricted-token"],
  };
  return {
    id: "linux-landlock",
    probe: () => capability,
    prepare: () => {
      throw new Error("OS backend must not prepare when unavailable");
    },
    spawn: () => {
      throw new Error("OS backend must not spawn when unavailable");
    },
    teardown: () => {
      throw new Error("OS backend must not teardown when unavailable");
    },
  };
}

function waitClose(child: { once: (ev: string, cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => child.once("close", resolve));
}

describe("degraded-mode contract", () => {
  it("states unconfined when the setting is off, without calling the OS backend", async () => {
    const logs: string[] = [];
    const { child, report } = spawnSandboxed({
      command: "echo hi",
      cwd: process.cwd(),
      env: process.env,
      enabled: false,
      backend: unavailableBackend(),
      policy: deriveDefaultPolicy(process.cwd()),
      log: {
        warn: (m) => logs.push(m),
        info: (m) => logs.push(`info:${m}`),
      },
    });
    await waitClose(child);
    expect(report.mode).toBe("unconfined");
    expect(report.summary).toContain(UNCONFINED_TOKEN);
    expect(report.summary).toMatch(/execSandbox is off/);
    expect(logs.some((l) => l.includes(UNCONFINED_TOKEN))).toBe(true);
  });

  it("states unconfined when the setting is on but the backend is missing", async () => {
    const logs: string[] = [];
    const { child, report } = spawnSandboxed({
      command: "echo hi",
      cwd: process.cwd(),
      env: process.env,
      enabled: true,
      backend: unavailableBackend(),
      policy: deriveDefaultPolicy(process.cwd()),
      log: {
        warn: (m) => logs.push(m),
        info: (m) => logs.push(`info:${m}`),
      },
    });
    await waitClose(child);
    expect(report.mode).toBe("unconfined");
    expect(report.enabled).toBe(true);
    expect(report.summary).toContain(UNCONFINED_TOKEN);
    expect(report.summary).toMatch(/Landlock not in LSM list/);
    expect(logs.some((l) => l.includes(UNCONFINED_TOKEN))).toBe(true);
  });

  it("never silently unconfined: describeSandbox includes the token when off", () => {
    const report = describeSandbox({
      enabled: false,
      backend: createUnconfinedBackend(),
    });
    expect(report.mode).toBe("unconfined");
    expect(report.summary).toContain(UNCONFINED_TOKEN);
  });

  it("asks the classifier for enhanced confirmation when enabled but not confined", () => {
    const report = describeSandbox({ enabled: true, backend: unavailableBackend() });
    expect(sandboxRequiresEnhancedConfirmation(report)).toBe(true);
    const off = describeSandbox({ enabled: false, backend: unavailableBackend() });
    expect(sandboxRequiresEnhancedConfirmation(off)).toBe(false);
  });
});
