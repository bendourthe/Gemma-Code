import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CATALOG_TAB_DEFS,
  catalogTabsFor,
  cardBadgeLabel,
  collapseAndSortModels,
  modelsOnTab,
  primaryCatalogTab,
  recommendationKind,
  sortModelsOnTab,
  visibleModelsOnTab,
} from "../src/shared/models/catalogTabs";
import {
  canonicalModelDisplayOrder,
  settingsModelDisplayOrder,
} from "../../core/registry/modelDisplayPolicy";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

function model(partial: Partial<ListedModelDto> & Pick<ListedModelDto, "id" | "displayName" | "installed" | "source">): ListedModelDto {
  return partial;
}

interface SortFixture {
  hostVramGB: number;
  gpuVendor: string;
  defaults: string[];
  recommendOrder: string[];
  models: ListedModelDto[];
  expectedIds: Record<string, string[]>;
  expectedInstallerIds: Record<string, string[]>;
  expectedSettingsIds: Record<string, string[]>;
  expectedSettingsIdsAfterGptOssDownload: Record<string, string[]>;
}

function fixture(name: string): SortFixture {
  return JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../../tests/fixtures/${name}`),
      "utf8",
    ),
  ) as SortFixture;
}

const GOLDEN = fixture("v2.2.8-catalog-tab-sort.json");
const GOLDEN_V229 = fixture("v2.2.9-catalog-tab-sort.json");

interface V241DisplayFixture {
  hostVramGB: number;
  gpuVendor: string;
  rows: ListedModelDto[];
  expectedInstaller: string[];
  expectedSettings: string[];
}

const DISPLAY_V241 = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../core/registry/model-display-order.fixture.json"),
    "utf8",
  ),
) as V241DisplayFixture;

function sortOptions(data: SortFixture) {
  return {
    hostVramGB: data.hostVramGB,
    gpuVendor: data.gpuVendor,
    defaults: new Set(data.defaults),
    recommendOrder: data.recommendOrder,
  };
}

describe("catalogTabs", () => {
  it("maps embed onto the Embeddings tab, and agentic-capable chat onto both Chat and Agentic", () => {
    expect(primaryCatalogTab({ task: "chat", type: "llm" })).toBe("chat");
    // v2.2.9 Phase 5 (T010): embeddings stop parking on Chat.
    expect(primaryCatalogTab({ task: "embed", type: "embed" })).toBe("embeddings");
    expect(primaryCatalogTab({ type: "embed" })).toBe("embeddings");
    expect(catalogTabsFor({ task: "embed", type: "embed" })).toEqual(["embeddings"]);
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

  it("derives Required / Recommended / Compatible from explicit tags", () => {
    expect(recommendationKind({ tags: ["required"] })).toBe("required");
    expect(recommendationKind({ type: "embed" })).toBe("compatible");
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

  it("shows every selectable row without family collapse or VRAM hiding", () => {
    const opts = sortOptions(GOLDEN);
    const chat = visibleModelsOnTab(GOLDEN.models, "chat", opts).map((m) => m.id);
    expect(chat).toContain("gemma-e2b");
    expect(chat).toContain("gemma-e4b");
    expect(chat).toContain("kimi-hidden");
    expect(chat).not.toContain("nomic-embed-text");
    expect(visibleModelsOnTab(GOLDEN.models, "embeddings", opts).map((m) => m.id)).toContain("nomic-embed-text");
  });

  it("puts the Embeddings tab first, before Chat (installer TYPE_TABS parity)", () => {
    expect(CATALOG_TAB_DEFS.map((d) => d.id)).toEqual([
      "embeddings",
      "chat",
      "agentic",
      "image",
      "video",
      "audio",
      "document",
    ]);
    expect(CATALOG_TAB_DEFS[0]!.label).toBe("Embeddings");
  });

  it("groups downloaded rows before compatible and incompatible rows", () => {
    const opts = sortOptions(GOLDEN_V229);
    const statusesFlipped = GOLDEN_V229.models.map((model) => ({
      ...model,
      installed: !model.installed,
      source: model.installed ? "catalog-only" as const : "registry" as const,
    }));
    const ordered = visibleModelsOnTab(statusesFlipped, "agentic", opts);
    const firstNotDownloaded = ordered.findIndex((model) => !model.installed);
    expect(firstNotDownloaded).toBeGreaterThan(0);
    expect(ordered.slice(0, firstNotDownloaded).every((model) => model.installed)).toBe(true);
  });

  it("moves gpt-oss into the downloaded partition once installed", () => {
    const models = GOLDEN_V229.models.map((m) =>
      m.id === "gpt-oss:20b" ? { ...m, installed: true, source: "registry" as const } : m,
    );
    expect(
      visibleModelsOnTab(models, "agentic", sortOptions(GOLDEN_V229)).map((m) => m.id),
    ).toEqual([
      "lfm2.5:2.6b",
      "gemma-4-12b-it-gguf",
      "gpt-oss:20b",
      "inkling-small",
    ]);
  });

  it("shares the v2.4.1 recommendation and availability contract", () => {
    const options = {
      hostVramGB: DISPLAY_V241.hostVramGB,
      gpuVendor: DISPLAY_V241.gpuVendor,
    };
    expect(canonicalModelDisplayOrder(DISPLAY_V241.rows, options).map((m) => m.id)).toEqual(
      DISPLAY_V241.expectedInstaller,
    );
    expect(settingsModelDisplayOrder(DISPLAY_V241.rows, options).map((m) => m.id)).toEqual(
      DISPLAY_V241.expectedSettings,
    );
    expect(visibleModelsOnTab(DISPLAY_V241.rows, "chat", options).map((m) => m.id)).toEqual(
      DISPLAY_V241.expectedSettings,
    );
  });

  it("lists the patient-tier Inkling-Small row on both surfaces (no env gate)", () => {
    expect(GOLDEN_V229.expectedInstallerIds.chat).toContain("inkling-small");
    expect(GOLDEN_V229.expectedSettingsIds.chat).toContain("inkling-small");
    const ids = visibleModelsOnTab(GOLDEN_V229.models, "chat", sortOptions(GOLDEN_V229)).map(
      (m) => m.id,
    );
    expect(ids).toContain("inkling-small");
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
