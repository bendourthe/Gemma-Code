import { describe, it, expect } from "vitest";
import {
  ModelCatalog,
  type LlmCatalogEntry,
  type ModelFamily,
} from "../../../../core/registry/ModelCatalog.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ModelCatalog", () => {
  it("listLlm returns at least the seven Phase 3 entries", () => {
    const ids = ModelCatalog.listLlm().map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "gemma4:e4b",
        "llama3.1:8b",
        "llama3.2:3b",
        "llama3.3:70b",
        "qwen2.5:7b",
        "qwen2.5-coder:7b",
        "deepseek-coder:6.7b",
      ]),
    );
  });

  it("listFamilies covers gemma/llama/qwen/deepseek/lfm2.5/hermes/muse-glimmer/nemotron-lightning", () => {
    const families = ModelCatalog.listFamilies().sort();
    expect(families).toEqual([
      "deepseek",
      "gemma",
      "hermes",
      "lfm2.5",
      "llama",
      "muse-glimmer",
      "nemotron-lightning",
      "qwen",
    ] as ModelFamily[]);
  });

  it("byId / get / byFamily expose the right slices", () => {
    expect(ModelCatalog.byId("gemma4:e4b")?.family).toBe("gemma");
    expect(ModelCatalog.byId("does-not-exist")).toBeUndefined();
    expect(() => ModelCatalog.get("does-not-exist")).toThrow(/unknown model id/);
    const llama = ModelCatalog.byFamily("llama").map((e) => e.id);
    expect(llama).toEqual(
      expect.arrayContaining(["llama3.1:8b", "llama3.2:3b", "llama3.3:70b"]),
    );
  });

  it("each entry exposes sampling defaults + promptFormat + toolFormat", () => {
    for (const entry of ModelCatalog.listLlm()) {
      expect(entry.sampling.temperature).toBeGreaterThanOrEqual(0);
      expect(entry.sampling.contextLength).toBeGreaterThanOrEqual(1024);
      expect(["gemma4", "llama3", "qwen", "deepseek", "lfm"]).toContain(entry.promptFormat);
      expect([
        "gemma4-xml",
        "llama3-json",
        "qwen-json",
        "deepseek-json",
        "lfm-pythonic",
      ]).toContain(entry.toolFormat);
    }
  });

  it("recommendedFor('coding') surfaces at least one entry tagged for coding", () => {
    const rec = ModelCatalog.recommendedFor("coding");
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((e) => e.tags.includes("coding"))).toBe(true);
  });

  it("recommendedFor('chat') filters to chat-tagged recommendations", () => {
    const rec = ModelCatalog.recommendedFor("chat");
    for (const e of rec) {
      expect(e.tags).toContain("recommended");
      expect(e.tags).toContain("chat");
    }
  });

  it("does not list LFM2.5-8B-A1B after the Phase 3 decline", () => {
    expect(ModelCatalog.byId("lfm2.5:8b-a1b")).toBeUndefined();
    expect(ModelCatalog.listLlm().some((e) => /8b-a1b/i.test(e.id))).toBe(false);
  });

  it("stays in sync with the canonical core/registry/models.json", () => {
    const jsonPath = resolve(__dirname, "../../../../core/registry/models.json");
    const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      llm: { id: string; family: ModelFamily; promptFormat: string; toolFormat: string }[];
    };
    const tsIds = ModelCatalog.listLlm().map((e: LlmCatalogEntry) => e.id).sort();
    const jsonIds = raw.llm.map((e) => e.id).sort();
    expect(tsIds).toEqual(jsonIds);
    for (const j of raw.llm) {
      const t = ModelCatalog.byId(j.id);
      expect(t).toBeDefined();
      expect(t?.family).toBe(j.family);
      expect(t?.promptFormat).toBe(j.promptFormat);
      expect(t?.toolFormat).toBe(j.toolFormat);
    }
  });
});
