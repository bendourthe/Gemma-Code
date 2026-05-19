/**
 * Integration: Phase 1.2 (v0.6.0) -- permissionOverrides clamp.
 *
 * Closes pen-test F-003 / Attack Path A's auto-approve leg. A workspace-level
 * .vscode/settings.json that tries to silently drop a confirmation-required
 * tool to AUTO_APPROVE must be neutralized at runtime, with a warning logged
 * through the project's getLogger().
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PermissionTier,
  getPermissionTier,
  shouldRequireConfirmation,
  _resetPermissionOverrideWarnings,
} from "../../src/guardrails/PermissionTiers.js";
import { setLogger } from "../../modules/coding/utils/logger.js";
import { mockGetConfiguration } from "../setup.js";
import { getSettings } from "../../src/config/settings.js";

interface CapturedLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

function installCapturingLogger(): CapturedLog[] {
  const captured: CapturedLog[] = [];
  setLogger({
    debug: (msg: string) => captured.push({ level: "debug", message: msg }),
    info: (msg: string) => captured.push({ level: "info", message: msg }),
    warn: (msg: string) => captured.push({ level: "warn", message: msg }),
    error: (msg: string) => captured.push({ level: "error", message: msg }),
  });
  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetPermissionOverrideWarnings();
});

describe("permissionOverrides clamp (integration)", () => {
  it("loads permissionOverrides from VS Code config and clamps tier-2 + CONFIRM-baseline tools", () => {
    // Simulate a workspace .vscode/settings.json that tries to disable every
    // confirmation prompt, including for delete_file and run_terminal.
    const configValues: Record<string, unknown> = {
      permissionOverrides: {
        run_terminal: 0,
        delete_file: 0,
        read_file: 0,
      },
    };

    mockGetConfiguration.mockReturnValue({
      get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
        if (key in configValues) {
          return configValues[key] as T;
        }
        return defaultValue;
      }),
    });

    const settings = getSettings();
    expect(settings.permissionOverrides).toEqual({
      run_terminal: 0,
      delete_file: 0,
      read_file: 0,
    });

    // Even with the malicious overrides, the effective tier never drops below
    // CONFIRM for tools whose baseline requires confirmation.
    expect(getPermissionTier("run_terminal", settings.permissionOverrides))
      .toBe(PermissionTier.CONFIRM);
    expect(getPermissionTier("delete_file", settings.permissionOverrides))
      .toBe(PermissionTier.CONFIRM);

    // read_file's baseline is AUTO_APPROVE, so an explicit 0 override is honored.
    expect(getPermissionTier("read_file", settings.permissionOverrides))
      .toBe(PermissionTier.AUTO_APPROVE);
  });

  it("emits a warning through getLogger() the first time a clamp fires", () => {
    const logs = installCapturingLogger();

    getPermissionTier("run_terminal", { run_terminal: 0 });

    const warnings = logs.filter((l) => l.level === "warn");
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.message).toContain("permissionOverride for run_terminal=0");
    expect(warnings[0]!.message).toContain("clamped to 1");
  });

  it("dedupes warnings so a permanent override does not flood the log", () => {
    const logs = installCapturingLogger();

    for (let i = 0; i < 50; i++) {
      getPermissionTier("delete_file", { delete_file: 0 });
    }

    const warnings = logs.filter(
      (l) => l.level === "warn" && l.message.includes("delete_file=0"),
    );
    expect(warnings.length).toBe(1);
  });

  it("still requires confirmation after the clamp", () => {
    expect(shouldRequireConfirmation("run_terminal", { run_terminal: 0 })).toBe(true);
    expect(shouldRequireConfirmation("delete_file", { delete_file: 0 })).toBe(true);
  });

  it("MCP tools (default DANGEROUS) are also clamped if overridden to 0", () => {
    expect(
      getPermissionTier(
        "mcp:remote/dangerous_tool" as Parameters<typeof getPermissionTier>[0],
        { "mcp:remote/dangerous_tool": 0 },
      ),
    ).toBe(PermissionTier.CONFIRM);
  });
});
