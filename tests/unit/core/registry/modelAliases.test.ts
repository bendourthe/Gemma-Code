import { describe, expect, it } from "vitest";
import {
  DuplicateModelAliasError,
  aliasesFor,
  buildAliasTable,
  foldModelId,
  lookupAlias,
  unknownModelIdError,
} from "../../../../core/registry/modelAliases.js";
import type { CatalogFile } from "../../../../core/registry/catalog.js";

function spec(partial: {
  id: string;
  displayName?: string;
  type?: "llm" | "image";
  family?: string;
  source: { protocol: "ollama" | "huggingface"; url?: string; repo?: string };
}): CatalogFile["models"][number] {
  return {
    id: partial.id,
    family: partial.family ?? "gemma4",
    name: partial.id.split(":")[0] ?? partial.id,
    tag: partial.id.split(":")[1] ?? "latest",
    type: partial.type ?? "llm",
    displayName: partial.displayName ?? partial.id,
    source: partial.source,
  } as CatalogFile["models"][number];
}

describe("model alias table", () => {
  it("folds gemma-4-12b-it-gguf and gemma4:12b to the same runtime record", () => {
    const a = lookupAlias("gemma-4-12b-it-gguf");
    const b = lookupAlias("gemma4:12b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).toEqual(b);
    expect(a?.runtimeId).toBe("gemma4:12b");
    expect(foldModelId("gemma-4-12b-it-gguf")).toBe("gemma4:12b");
    expect(foldModelId("gemma4:12b")).toBe("gemma4:12b");
  });

  it("folds Qwen 3.5 4B/9B and LFM2.5 catalog ids to their Ollama tags", () => {
    expect(lookupAlias("qwen3.5:4b")?.runtimeId).toBe("qwen3.5:4b");
    expect(lookupAlias("qwen3.5:9b")?.runtimeId).toBe("qwen3.5:9b");
    const lfm = lookupAlias("lfm2.5:2.6b");
    expect(lfm?.runtimeId).toBe("hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M");
    expect(lookupAlias(lfm!.runtimeId)).toEqual(lfm);
  });

  it("keeps coding LLM ids as aliases of the matching catalog row", () => {
    const rec = lookupAlias("gemma4:e4b");
    expect(rec?.catalogId).toBe("gemma4:e4b");
    expect(rec?.codingId).toBe("gemma4:e4b");
    expect(rec?.coding?.id).toBe("gemma4:e4b");
  });

  it("covers diffusion catalog ids used by Image/Video pickers", () => {
    expect(lookupAlias("sana-1.6b-int4")?.type).toBe("image");
    expect(lookupAlias("sana-1.6b-4k")?.type).toBe("image");
    expect(lookupAlias("longcat-video-avatar-1.5")?.type).toBe("video");
    expect(lookupAlias("sana-video-2b-720p")?.type).toBe("video");
    expect(lookupAlias("wan2.2-ti2v-5b")?.type).toBe("video");
  });

  it("does not silently fold unknown ids to gemma4:e4b", () => {
    expect(lookupAlias("not-a-model")).toBeUndefined();
    expect(foldModelId("not-a-model")).toBe("not-a-model");
    expect(foldModelId("not-a-model")).not.toBe("gemma4:e4b");
    const err = unknownModelIdError("not-a-model");
    expect(err.message).toMatch(/Unknown model id: not-a-model/);
    expect(err.message).toMatch(/gemma-4-12b-it-gguf/);
  });

  it("aliasesFor includes catalog id and Ollama tag", () => {
    const aliases = aliasesFor("gemma-4-12b-it-gguf");
    expect(aliases).toEqual(expect.arrayContaining(["gemma-4-12b-it-gguf", "gemma4:12b"]));
  });

  it("allows dual-tier siblings that share an Ollama tag", () => {
    const catalog: CatalogFile = {
      models: [
        spec({
          id: "native",
          source: { protocol: "ollama", url: "ollama://shared:tag" },
        }),
        spec({
          id: "offload",
          source: { protocol: "ollama", url: "ollama://shared:tag" },
        }),
      ],
    };
    const table = buildAliasTable(catalog, []);
    expect(table.byAlias.get("native")?.runtimeId).toBe("shared:tag");
    expect(table.byAlias.get("offload")?.runtimeId).toBe("shared:tag");
    expect(table.byAlias.get("shared:tag")?.catalogId).toBe("native");
    expect(table.byAlias.get("offload")?.aliases).toContain("shared:tag");
  });

  it("maps Nemotron native and offload catalog ids to the shared Ollama tag", () => {
    expect(lookupAlias("nemotron-lightning:30b-a3b")?.runtimeId).toBe(
      "nemotron-3.5-lightning:30b",
    );
    expect(lookupAlias("nemotron-lightning:30b-a3b-offload")?.runtimeId).toBe(
      "nemotron-3.5-lightning:30b",
    );
    expect(foldModelId("nemotron-3.5-lightning:30b")).toBe("nemotron-3.5-lightning:30b");
    expect(aliasesFor("nemotron-lightning:30b-a3b-offload")).toEqual(
      expect.arrayContaining([
        "nemotron-lightning:30b-a3b-offload",
        "nemotron-3.5-lightning:30b",
      ]),
    );
  });

  it("throws when the same alias maps to two different runtime ids", () => {
    const catalog: CatalogFile = {
      models: [
        spec({
          id: "one",
          source: { protocol: "ollama", url: "ollama://alpha:1" },
        }),
        spec({
          id: "alpha:1",
          source: { protocol: "ollama", url: "ollama://beta:1" },
        }),
      ],
    };
    expect(() => buildAliasTable(catalog, [])).toThrow(DuplicateModelAliasError);
  });
});
