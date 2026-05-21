import { describe, it, expect } from "vitest";
import { ModelCatalog } from "../../../../core/registry/ModelCatalog.js";
import {
  ACTIVE_MODEL_SETTING_KEY,
  listModelDropdownEntries,
  projectModelDropdownEntries,
  resolveActiveModelId,
} from "../../../../core/coding/ModelDropdown.js";

describe("listModelDropdownEntries", () => {
  it("returns every text model in the canonical catalog", () => {
    const entries = listModelDropdownEntries();
    const ids = entries.map((e) => e.id);
    for (const expected of ModelCatalog.listLlm().map((m) => m.id)) {
      expect(ids).toContain(expected);
    }
  });

  it("hoists recommended entries to the top of the list", () => {
    const entries = listModelDropdownEntries();
    const recommendedTrailing = entries.findIndex((e) => !e.recommended);
    if (recommendedTrailing === -1) return;
    for (let i = recommendedTrailing; i < entries.length; i += 1) {
      expect(entries[i]?.recommended).toBe(false);
    }
  });

  it("projects the 'chat' capability for every text LLM in the catalog", () => {
    // Per Phase 11.1: a model is chat-capable when any of the chat / tool-use
    // / coding tags is present (every text LLM in the catalog satisfies at
    // least one of those).
    const entries = listModelDropdownEntries({ capability: "chat" });
    expect(entries.length).toBeGreaterThanOrEqual(ModelCatalog.listLlm().length);
  });

  it("filtering on 'tool-use' returns only models tagged tool-use", () => {
    const entries = listModelDropdownEntries({ capability: "tool-use" });
    for (const e of entries) {
      expect(e.capabilities).toContain("tool-use");
    }
  });

  it("includes the three models named in the acceptance criterion", () => {
    const entries = listModelDropdownEntries({ capability: "chat" });
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("gemma4:e4b");
    expect(ids).toContain("llama3.1:8b");
    expect(ids).toContain("qwen2.5-coder:7b");
  });
});

describe("projectModelDropdownEntries", () => {
  it("is pure with respect to a supplied catalog snapshot", () => {
    const snapshot = [
      {
        id: "m1",
        displayName: "M1",
        family: "gemma" as const,
        runtime: "ollama" as const,
        vramGb: 1,
        tags: Object.freeze(["chat", "recommended"]),
        sampling: { temperature: 0, topP: 1, topK: 1, contextLength: 1024 },
        promptFormat: "gemma4" as const,
        toolFormat: "gemma4-xml" as const,
      },
      {
        id: "m2",
        displayName: "M2",
        family: "qwen" as const,
        runtime: "ollama" as const,
        vramGb: 1,
        tags: Object.freeze(["coding"]),
        sampling: { temperature: 0, topP: 1, topK: 1, contextLength: 1024 },
        promptFormat: "qwen" as const,
        toolFormat: "qwen-json" as const,
      },
    ];
    const entries = projectModelDropdownEntries(snapshot, { capability: "chat" });
    expect(entries.map((e) => e.id)).toEqual(["m1", "m2"]);
  });
});

describe("resolveActiveModelId", () => {
  const entries = [
    {
      id: "a",
      displayName: "A",
      family: "gemma" as const,
      capabilities: Object.freeze(["chat" as const]),
      recommended: true,
    },
    {
      id: "b",
      displayName: "B",
      family: "qwen" as const,
      capabilities: Object.freeze(["chat" as const]),
      recommended: false,
    },
  ];

  it("returns the stored id when it matches an entry", () => {
    expect(resolveActiveModelId("b", entries)).toBe("b");
  });

  it("falls back to the first entry when the stored id is missing", () => {
    expect(resolveActiveModelId(null, entries)).toBe("a");
    expect(resolveActiveModelId("", entries)).toBe("a");
  });

  it("falls back to the first entry when the stored id is no longer in the catalog", () => {
    expect(resolveActiveModelId("ghost", entries)).toBe("a");
  });

  it("returns null when there are no entries at all", () => {
    expect(resolveActiveModelId("any", [])).toBeNull();
  });

  it("exposes the canonical settings key", () => {
    expect(ACTIVE_MODEL_SETTING_KEY).toBe("nexus.coding.activeModel");
  });
});
