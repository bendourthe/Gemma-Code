import { describe, expect, it } from "vitest";

import type { ListedModelDto } from "../src/pages/settings/modelsTypes";
import {
  installedForTask,
  resolveDefaultId,
  ownedIdSet,
} from "../src/shared/models/selectionPolicy";
import type { SelectionSnapshot } from "../src/shared/models/selectionPolicy";

const SNAPSHOT: SelectionSnapshot = {
  schemaVersion: 1,
  orderedIds: ["lfm2.5:1.2b", "sana-1.5-1.6b"],
  recommendedByTask: { chat: "lfm2.5:1.2b", image: "sana-1.5-1.6b" },
  downloadedSinceInstall: ["qwen2.5-coder:7b"],
};

function model(partial: Partial<ListedModelDto> & Pick<ListedModelDto, "id">): ListedModelDto {
  return {
    displayName: partial.id,
    type: "llm",
    installed: true,
    source: "registry",
    ...partial,
  };
}

describe("selectionPolicy", () => {
  it("drops leftover installed ids that are not in this install snapshot", () => {
    const models = [
      model({ id: "gemma4:e4b", type: "llm" }),
      model({ id: "lfm2.5:1.2b", type: "llm" }),
      model({ id: "qwen2.5-coder:7b", type: "llm" }),
    ];
    expect(installedForTask(models, "chat", SNAPSHOT).map((m) => m.id)).toEqual([
      "lfm2.5:1.2b",
      "qwen2.5-coder:7b",
    ]);
  });

  it("preserves installer order then in-app downloads", () => {
    const models = [
      model({ id: "qwen2.5-coder:7b" }),
      model({ id: "lfm2.5:1.2b" }),
    ];
    expect(installedForTask(models, "chat", SNAPSHOT).map((m) => m.id)).toEqual([
      "lfm2.5:1.2b",
      "qwen2.5-coder:7b",
    ]);
  });

  it("without a snapshot, keeps the probe installed set (migration window)", () => {
    const models = [model({ id: "gemma4:e4b" }), model({ id: "lfm2.5:1.2b" })];
    expect(installedForTask(models, "chat", null).map((m) => m.id)).toEqual([
      "gemma4:e4b",
      "lfm2.5:1.2b",
    ]);
  });

  it("resolves favorite, then recommended, then first", () => {
    const ready = [model({ id: "a" }), model({ id: "b" }), model({ id: "c" })];
    expect(resolveDefaultId(ready, { favorite: "c", recommended: "b" })).toBe("c");
    expect(resolveDefaultId(ready, { favorite: "missing", recommended: "b" })).toBe("b");
    expect(resolveDefaultId(ready, {})).toBe("a");
    expect(resolveDefaultId([], {})).toBe("");
  });

  it("ownedIdSet is null when no snapshot so callers can skip the intersect", () => {
    expect(ownedIdSet(null)).toBeNull();
    expect([...ownedIdSet(SNAPSHOT)!]).toEqual(["lfm2.5:1.2b", "sana-1.5-1.6b", "qwen2.5-coder:7b"]);
  });
});
