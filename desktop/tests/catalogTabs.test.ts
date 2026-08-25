import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  catalogTabsFor,
  cardBadgeLabel,
  collapseAndSortModels,
  modelsOnTab,
  primaryCatalogTab,
  recommendationKind,
  sortModelsOnTab,
  visibleModelsOnTab,
} from "../src/shared/models/catalogTabs";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

function model(partial: Partial<ListedModelDto> & Pick<ListedModelDto, "id" | "displayName" | "installed" | "source">): ListedModelDto {
  return partial;
}

const GOLDEN = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/v2.2.8-catalog-tab-sort.json"),
    "utf8",
  ),
) as {
  hostVramGB: number;
  gpuVendor: string;
  defaults: string[];
  recommendOrder: string[];
  models: ListedModelDto[];
  expectedIds: Record<string, string[]>;
};

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

  it("never shows Compatible on an over-budget SANA 4K card", () => {
    expect(
      cardBadgeLabel({ tags: [], vramGB: 20, type: "image", task: "image" }, 16),
    ).toBe("Needs 20 GB VRAM");
    expect(cardBadgeLabel({ tags: ["recommended"], vramGB: 6, type: "llm" }, 16)).toBe(
      "Recommended",
    );
    expect(cardBadgeLabel({ tags: [], type: "llm" }, 16)).toBe("");
  });

  it("sorts Required, Recommended, Compatible-that-fits, then over-budget by date", () => {
    const rows = [
      model({
        id: "sana-1.6b-4k",
        displayName: "SANA 1.6B 4K",
        installed: false,
        source: "catalog-only",
        task: "image",
        type: "image",
        vramGB: 20,
        releaseDate: "2025-09-10",
      }),
      model({
        id: "older-rec",
        displayName: "Older recommended",
        installed: false,
        source: "catalog-only",
        task: "image",
        type: "image",
        tags: ["recommended"],
        vramGB: 8,
        releaseDate: "2024-01-01",
      }),
      model({
        id: "newer-rec",
        displayName: "Newer recommended",
        installed: false,
        source: "catalog-only",
        task: "image",
        type: "image",
        tags: ["recommended"],
        vramGB: 8,
        releaseDate: "2026-05-01",
      }),
      model({
        id: "embed-req",
        displayName: "Embed",
        installed: false,
        source: "catalog-only",
        task: "embed",
        type: "embed",
        tags: ["required"],
        vramGB: 1,
      }),
    ];
    expect(sortModelsOnTab(rows, 16).map((m) => m.id)).toEqual([
      "embed-req",
      "newer-rec",
      "older-rec",
      "sana-1.6b-4k",
    ]);
  });

  it("matches the shared v2.2.8 golden fixture (hideBelow + family collapse + over-budget last)", () => {
    const opts = {
      hostVramGB: GOLDEN.hostVramGB,
      gpuVendor: GOLDEN.gpuVendor,
      defaults: new Set(GOLDEN.defaults),
      recommendOrder: GOLDEN.recommendOrder,
    };
    expect(visibleModelsOnTab(GOLDEN.models, "chat", opts).map((m) => m.id)).toEqual(
      GOLDEN.expectedIds.chat,
    );
    expect(visibleModelsOnTab(GOLDEN.models, "image", opts).map((m) => m.id)).toEqual(
      GOLDEN.expectedIds.image,
    );
    expect(GOLDEN.expectedIds.chat).not.toContain("gemma-e2b");
    expect(GOLDEN.expectedIds.chat).not.toContain("kimi-hidden");
  });

  it("does not hide an already-downloaded row below hideBelowVramGB", () => {
    const rows = [
      model({
        id: "kimi-hidden",
        displayName: "Kimi Large",
        family: "kimi",
        type: "llm",
        task: "chat",
        installed: true,
        source: "registry",
        vramGB: 24,
        hideBelowVramGB: 20,
      }),
    ];
    expect(collapseAndSortModels(rows, { hostVramGB: 8, gpuVendor: "nvidia" }).map((m) => m.id)).toEqual([
      "kimi-hidden",
    ]);
  });
});
