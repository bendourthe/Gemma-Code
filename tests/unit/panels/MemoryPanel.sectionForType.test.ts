import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: () => null,
    }),
  },
}));

import {
  DEFAULT_PROMOTION_MAPPING,
  sectionForType,
} from "../../../src/panels/MemoryPanel.js";

describe("sectionForType (v0.8.0 Phase 5.10)", () => {
  it("maps known SQL types to the documented sections", () => {
    expect(sectionForType("decision")).toBe("Decisions");
    expect(sectionForType("preference")).toBe("Preferences");
    expect(sectionForType("error_resolution")).toBe("Corrections");
    expect(sectionForType("file_pattern")).toBe("Patterns");
  });

  it("falls back to Preferences for unknown types", () => {
    expect(sectionForType("invented-type")).toBe("Preferences");
    expect(sectionForType("")).toBe("Preferences");
  });

  it("honours a valid override map", () => {
    const override = { preference: "Patterns" as const };
    expect(sectionForType("preference", override)).toBe("Patterns");
    // Other types still pull from defaults.
    expect(sectionForType("decision", override)).toBe("Decisions");
  });

  it("ignores invalid override values", () => {
    // @ts-expect-error -- deliberately bad value to assert defensive parsing.
    expect(sectionForType("preference", { preference: "BogusSection" })).toBe(
      "Preferences",
    );
  });

  it("exposes the default mapping as a frozen object", () => {
    expect(DEFAULT_PROMOTION_MAPPING.decision).toBe("Decisions");
    expect(Object.isFrozen(DEFAULT_PROMOTION_MAPPING)).toBe(true);
  });
});
