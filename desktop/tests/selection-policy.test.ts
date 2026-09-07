import { describe, expect, it } from "vitest";

import type { ListedModelDto } from "../src/pages/settings/modelsTypes";
import {
  installedForTask,
  recommendOrderForTask,
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

function model(
  partial: Partial<ListedModelDto> & Pick<ListedModelDto, "id">,
): ListedModelDto {
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
    expect(installedForTask(models, "chat", SNAPSHOT).map((m) => m.id)).toEqual(
      ["lfm2.5:1.2b", "qwen2.5-coder:7b"],
    );
  });

  it("preserves installer order then in-app downloads", () => {
    const models = [
      model({ id: "qwen2.5-coder:7b" }),
      model({ id: "lfm2.5:1.2b" }),
    ];
    expect(installedForTask(models, "chat", SNAPSHOT).map((m) => m.id)).toEqual(
      ["lfm2.5:1.2b", "qwen2.5-coder:7b"],
    );
  });

  it("without a snapshot, keeps the picker empty (fail closed)", () => {
    const models = [model({ id: "gemma4:e4b" }), model({ id: "lfm2.5:1.2b" })];
    expect(installedForTask(models, "chat", null).map((m) => m.id)).toEqual([]);
  });

  it("prefers recommended over leftover favorite unless applyFavorite is set", () => {
    const ready = [model({ id: "a" }), model({ id: "b" }), model({ id: "c" })];
    expect(resolveDefaultId(ready, { favorite: "c", recommended: "b" })).toBe(
      "b",
    );
    expect(
      resolveDefaultId(ready, {
        favorite: "c",
        recommended: "b",
        applyFavorite: true,
      }),
    ).toBe("c");
    expect(
      resolveDefaultId(ready, { favorite: "missing", recommended: "b" }),
    ).toBe("b");
    expect(resolveDefaultId(ready, {})).toBe("a");
    expect(resolveDefaultId([], {})).toBe("");
  });

  it("defaults a 16 GB agentic empty session to gemma-4-12b-it-gguf not gpt-oss", () => {
    const ready = [
      model({ id: "gpt-oss:20b", task: "agentic" }),
      model({ id: "lfm2.5:2.6b", task: "agentic" }),
      model({ id: "gemma-4-12b-it-gguf", task: "agentic" }),
    ];
    const snap: SelectionSnapshot = {
      schemaVersion: 1,
      orderedIds: ["gpt-oss:20b", "lfm2.5:2.6b", "gemma-4-12b-it-gguf"],
      recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
      downloadedSinceInstall: [],
    };
    expect(
      resolveDefaultId(ready, {
        favorite: "gpt-oss:20b",
        recommended: snap.recommendedByTask.agentic,
      }),
    ).toBe("gemma-4-12b-it-gguf");
    expect(recommendOrderForTask(snap, "agentic")[0]).toBe(
      "gemma-4-12b-it-gguf",
    );
  });

  it("orders chat, image, and video recommend ids first", () => {
    const snap: SelectionSnapshot = {
      schemaVersion: 1,
      orderedIds: ["other-chat", "other-image", "other-video"],
      recommendedByTask: {
        chat: "gemma-4-12b-it-gguf",
        image: "realvisxl-v5",
        video: "wan2.1-t2v-1.3b",
      },
      downloadedSinceInstall: [],
    };
    expect(recommendOrderForTask(snap, "chat")[0]).toBe("gemma-4-12b-it-gguf");
    expect(recommendOrderForTask(snap, "image")[0]).toBe("realvisxl-v5");
    expect(recommendOrderForTask(snap, "video")[0]).toBe("wan2.1-t2v-1.3b");
  });

  it("ownedIdSet is empty when no snapshot so leftovers cannot leak", () => {
    expect([...ownedIdSet(null)]).toEqual([]);
    expect([...ownedIdSet(SNAPSHOT)]).toEqual([
      "lfm2.5:1.2b",
      "sana-1.5-1.6b",
      "qwen2.5-coder:7b",
    ]);
  });
});

// v2.4.8 Phase 5 (T021): operator evidence (2026-09-06). The on-disk snapshot
// listed gpt-oss:20b as the agentic recommendation above the catalog-tagged
// Gemma 4 12B, and the Agents session opened on gpt-oss with it listed first.
describe("selectionPolicy v2.4.8 picker order and catalog-endorsed default", () => {
  const STALE: SelectionSnapshot = {
    schemaVersion: 1,
    orderedIds: [
      "gemma-4-12b-it-gguf",
      "inkling-small",
      "gpt-oss:20b",
      "lfm2.5:2.6b",
      "qwen3.5:4b",
    ],
    recommendedByTask: { chat: "embeddinggemma", agentic: "gpt-oss:20b" },
    downloadedSinceInstall: [],
  };
  const READY = [
    model({ id: "gpt-oss:20b", displayName: "gpt-oss 20B", task: "agentic", releaseDate: "2025-08-05" }),
    model({ id: "qwen3.5:4b", displayName: "Qwen 3.5 4B", task: "chat", releaseDate: "2026-02-01" }),
    model({ id: "inkling-small", displayName: "Inkling-Small", task: "chat", releaseDate: "2026-07-01" }),
    model({ id: "lfm2.5:2.6b", displayName: "LFM2.5 2.6B", task: "agentic", releaseDate: "2026-08-04" }),
    model({
      id: "gemma-4-12b-it-gguf",
      displayName: "Gemma 4 12B",
      task: "chat",
      tags: ["recommended"],
      releaseDate: "2026-05-01",
    }),
  ];

  it("lists the catalog-recommended model first even when the snapshot orders it later", () => {
    const ids = installedForTask(READY, "chat", STALE).map((m) => m.id);
    expect(ids[0]).toBe("gemma-4-12b-it-gguf");
    // Then installer order for the untagged rest.
    expect(ids).toEqual([
      "gemma-4-12b-it-gguf",
      "inkling-small",
      "gpt-oss:20b",
      "lfm2.5:2.6b",
      "qwen3.5:4b",
    ]);
  });

  it("defaults to the catalog-endorsed row when the snapshot names an untagged one", () => {
    const ready = installedForTask(READY, "chat", STALE);
    expect(
      resolveDefaultId(ready, { recommended: STALE.recommendedByTask.agentic }),
    ).toBe("gemma-4-12b-it-gguf");
    // A snapshot pick that is not even installed falls through to ready[0].
    expect(
      resolveDefaultId(ready, { recommended: STALE.recommendedByTask.chat }),
    ).toBe("gemma-4-12b-it-gguf");
  });

  it("still honors the snapshot pick when it is itself tagged or nothing is tagged", () => {
    const tagged = installedForTask(READY, "chat", STALE);
    expect(resolveDefaultId(tagged, { recommended: "gemma-4-12b-it-gguf" })).toBe(
      "gemma-4-12b-it-gguf",
    );
    const untagged = READY.filter((m) => !m.tags);
    expect(resolveDefaultId(untagged, { recommended: "gpt-oss:20b" })).toBe(
      "gpt-oss:20b",
    );
  });

  it("lets an explicit favorite win over both", () => {
    const ready = installedForTask(READY, "chat", STALE);
    expect(
      resolveDefaultId(ready, {
        favorite: "lfm2.5:2.6b",
        recommended: "gpt-oss:20b",
        applyFavorite: true,
      }),
    ).toBe("lfm2.5:2.6b");
  });
});
