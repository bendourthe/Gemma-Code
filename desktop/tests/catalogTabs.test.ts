import { describe, expect, it } from "vitest";

import {
  catalogTabsFor,
  modelsOnTab,
  primaryCatalogTab,
  recommendationKind,
} from "../src/shared/models/catalogTabs";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

function model(partial: Partial<ListedModelDto> & Pick<ListedModelDto, "id" | "displayName" | "installed" | "source">): ListedModelDto {
  return partial;
}

describe("catalogTabs", () => {
  it("maps task chat and embed onto Chat, and agentic-capable chat onto both Chat and Agentic", () => {
    expect(primaryCatalogTab({ task: "chat", type: "llm" })).toBe("chat");
    expect(primaryCatalogTab({ task: "embed", type: "embed" })).toBe("chat");
    expect(catalogTabsFor({ task: "chat", type: "llm", agentic: true })).toEqual(["chat", "agentic"]);
    expect(catalogTabsFor({ task: "agentic", type: "llm" })).toEqual(["agentic"]);
  });

  it("maps image / video / audio / document by task or type", () => {
    expect(primaryCatalogTab({ task: "image", type: "image" })).toBe("image");
    expect(primaryCatalogTab({ type: "video" })).toBe("video");
    expect(primaryCatalogTab({ type: "audio" })).toBe("audio");
    expect(primaryCatalogTab({ type: "document" })).toBe("document");
  });

  it("lands unknown tasks in Other instead of dropping the row", () => {
    const mystery = model({
      id: "mystery",
      displayName: "Mystery",
      installed: true,
      source: "external",
    });
    expect(primaryCatalogTab(mystery)).toBe("other");
    expect(modelsOnTab([mystery], "other").map((m) => m.id)).toEqual(["mystery"]);
  });

  it("derives Required / Recommended / Compatible from tags and embed type", () => {
    expect(recommendationKind({ tags: ["required"] })).toBe("required");
    expect(recommendationKind({ type: "embed" })).toBe("required");
    expect(recommendationKind({ tags: ["recommended"] })).toBe("recommended");
    expect(recommendationKind({})).toBe("compatible");
  });
});
