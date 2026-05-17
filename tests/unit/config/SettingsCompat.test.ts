/**
 * v1.0.0 Phase 2.1 -- SettingsCompat tests
 *
 * Covers:
 *  - canonical key resolution (no legacy fallback, no warning)
 *  - legacy fallback when canonical is unset (warning fires)
 *  - canonical wins over legacy when both are set (no warning)
 *  - deprecation warning emits exactly once per (legacy key, session)
 *  - default returned when neither canonical nor legacy is set
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SettingsCompat,
  type ConfigInspection,
  type WorkspaceConfigurationLike,
} from "../../../src/config/SettingsCompat.js";

interface ConfigStore {
  [section: string]: { [leaf: string]: unknown };
}

function makeFactory(store: ConfigStore) {
  return (section?: string): WorkspaceConfigurationLike => {
    const bucket = store[section ?? ""] ?? {};
    return {
      get<T>(leaf: string): T | undefined {
        return bucket[leaf] as T | undefined;
      },
      inspect<T>(leaf: string): ConfigInspection<T> | undefined {
        if (leaf in bucket) {
          return { globalValue: bucket[leaf] as T };
        }
        return {};
      },
    };
  };
}

describe("SettingsCompat", () => {
  let warnings: string[];
  beforeEach(() => {
    warnings = [];
  });

  function makeShim(store: ConfigStore): SettingsCompat {
    return new SettingsCompat(makeFactory(store), (msg) => warnings.push(msg));
  }

  it("returns the canonical value when only the new key is set", () => {
    const shim = makeShim({
      "nexus.coding": { editMode: "auto" },
    });
    expect(shim.get<string>("nexus.coding.editMode", "ask")).toBe("auto");
    expect(warnings).toHaveLength(0);
  });

  it("falls back to the legacy key when the canonical key is unset", () => {
    const shim = makeShim({
      "gemma-code": { editMode: "plan" },
    });
    expect(shim.get<string>("nexus.coding.editMode", "ask")).toBe("plan");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("gemma-code.editMode");
    expect(warnings[0]).toContain("nexus.coding.editMode");
    expect(warnings[0]).toContain("v1.1.0");
  });

  it("canonical wins when both keys are set (no warning)", () => {
    const shim = makeShim({
      "nexus.coding": { editMode: "auto" },
      "gemma-code": { editMode: "plan" },
    });
    expect(shim.get<string>("nexus.coding.editMode", "ask")).toBe("auto");
    expect(warnings).toHaveLength(0);
  });

  it("returns the default when neither key is set", () => {
    const shim = makeShim({});
    expect(shim.get<string>("nexus.coding.editMode", "ask")).toBe("ask");
    expect(warnings).toHaveLength(0);
  });

  it("warns exactly once per legacy key in a single session", () => {
    const shim = makeShim({
      "gemma-code": { editMode: "plan" },
    });
    shim.get<string>("nexus.coding.editMode", "ask");
    shim.get<string>("nexus.coding.editMode", "ask");
    shim.get<string>("nexus.coding.editMode", "ask");
    expect(warnings).toHaveLength(1);
  });

  it("warns once per distinct legacy key (different keys -> different warnings)", () => {
    const shim = makeShim({
      "gemma-code": { editMode: "plan", modelName: "qwen2.5:7b" },
    });
    shim.get<string>("nexus.coding.editMode", "ask");
    shim.get<string>("nexus.llm.modelName", "gemma4:e4b");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("gemma-code.editMode");
    expect(warnings[1]).toContain("gemma-code.modelName");
  });

  it("resolves nested legacy keys (gemma-code.operationLog.enabled)", () => {
    const shim = makeShim({
      "gemma-code.operationLog": { enabled: true },
    });
    expect(shim.get<boolean>("nexus.operationLog.enabled", false)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("gemma-code.operationLog.enabled");
    expect(warnings[0]).toContain("nexus.operationLog.enabled");
  });

  it("treats workspaceFolderValue > workspaceValue > globalValue", () => {
    const shim = new SettingsCompat(
      (section): WorkspaceConfigurationLike => {
        if (section === "nexus.coding") {
          return {
            get: () => undefined,
            inspect: () => ({
              globalValue: "ask",
              workspaceValue: "auto",
              workspaceFolderValue: "plan",
            }),
          };
        }
        return { get: () => undefined, inspect: () => ({}) };
      },
      (msg) => warnings.push(msg),
    );
    expect(shim.get<string>("nexus.coding.editMode", "ask")).toBe("plan");
  });

  it("resetForTesting() clears the warned set", () => {
    const shim = makeShim({
      "gemma-code": { editMode: "plan" },
    });
    shim.get<string>("nexus.coding.editMode", "ask");
    expect(warnings).toHaveLength(1);
    shim.resetForTesting();
    shim.get<string>("nexus.coding.editMode", "ask");
    expect(warnings).toHaveLength(2);
  });

  it("returns default when canonical key is mapped but legacy is also missing", () => {
    const shim = makeShim({
      "nexus.coding": {}, // canonical section exists but key is unset
    });
    expect(shim.get<boolean>("nexus.coding.thinkingMode", false)).toBe(false);
    expect(warnings).toHaveLength(0);
  });
});
