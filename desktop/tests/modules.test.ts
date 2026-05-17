import { describe, expect, it } from "vitest";
import { MODULES, MODULE_IDS, isModuleId, moduleList } from "../src/types/modules";

describe("modules registry", () => {
  it("exposes a descriptor for every id", () => {
    for (const id of MODULE_IDS) {
      const m = MODULES[id];
      expect(m.id).toBe(id);
      expect(m.label).toBeTruthy();
      expect(m.route.startsWith("/")).toBe(true);
      expect(m.accentVar.startsWith("--accent-")).toBe(true);
      expect(m.accentSoftVar.endsWith("-soft")).toBe(true);
    }
  });

  it("moduleList returns the ids in canonical order", () => {
    expect(moduleList.map((m) => m.id)).toEqual(["chatbot", "coding", "image", "video"]);
  });

  it("isModuleId rejects unknown ids", () => {
    expect(isModuleId("coding")).toBe(true);
    expect(isModuleId("foo")).toBe(false);
  });
});
