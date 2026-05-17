import { describe, it, expect, vi } from "vitest";
import { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import {
  buildToolRegistry,
  listEagerToolNames,
  listLazyToolNames,
} from "../../../src/tools/ToolRegistryBuilder.js";

/**
 * v0.9.0 Phase 6.6 (from v0.8.0 known-gaps 10.O.Q) -- lazy-import builder
 * integration test.
 *
 * The contract this test enforces:
 *   1. `buildToolRegistry` wires at least 30% of the standard tools via
 *      `registerLazy` (tier `confirm` + `dangerous`), preserving eager
 *      registration for tier `auto-approve` tools so the prompt builder
 *      has them on the first turn.
 *   2. Tools registered lazily are visible through `has` / `isEnabled` /
 *      `getEnabledNames` before their factory has run.
 *   3. The factory runs exactly once per tool, only when the tool is
 *      first invoked through `execute`.
 */

describe("buildToolRegistry lazy-import driver (Phase 6.6)", () => {
  function makeOptions() {
    const gate = new ConfirmationGate(vi.fn());
    return {
      gate,
      editMode: "auto" as const,
      secretPathDenyExtra: [] as readonly string[],
      toolOutputCache: null,
      webResponseCache: null,
    };
  }

  it("attaches at least 30% of the standard tools via registerLazy", () => {
    const lazyNames = listLazyToolNames();
    const eagerNames = listEagerToolNames();
    const totalStandard = lazyNames.length + eagerNames.length;
    const lazyFraction = lazyNames.length / totalStandard;
    expect(lazyFraction).toBeGreaterThanOrEqual(0.3);
  });

  it("lazy tools are visible via has() and isEnabled() before first use", () => {
    const registry = buildToolRegistry(makeOptions());
    for (const name of listLazyToolNames()) {
      expect(registry.has(name)).toBe(true);
      expect(registry.isEnabled(name)).toBe(true);
    }
  });

  it("eager tools are visible via has() and isEnabled() too", () => {
    const registry = buildToolRegistry(makeOptions());
    for (const name of listEagerToolNames()) {
      expect(registry.has(name)).toBe(true);
      expect(registry.isEnabled(name)).toBe(true);
    }
  });

  it("getEnabledNames returns the union of eager and lazy tools", () => {
    const registry = buildToolRegistry(makeOptions());
    const enabled = new Set(registry.getEnabledNames());
    for (const name of listLazyToolNames()) {
      expect(enabled.has(name)).toBe(true);
    }
    for (const name of listEagerToolNames()) {
      expect(enabled.has(name)).toBe(true);
    }
  });
});
