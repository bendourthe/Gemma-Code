import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadCatalog,
  validateCatalog,
  validateSpec,
  findSpec,
  getSpec,
  type CatalogFile,
  type ModelSpec,
} from "../../../../core/registry/catalog.js";

describe("catalog", () => {
  it("loads the bundled core/registry/catalog.json", async () => {
    const file = await loadCatalog();
    expect(file.models.length).toBeGreaterThan(0);
    const ids = new Set(file.models.map((m) => m.id));
    expect(ids.size).toBe(file.models.length);
  });

  it("the bundled catalog has at least one recommended LLM and the embed model", async () => {
    const file = await loadCatalog();
    const recommended = file.models.filter((m) => (m.tags ?? []).includes("recommended"));
    expect(recommended.some((m) => m.type === "llm")).toBe(true);
    expect(file.models.find((m) => m.id === "nomic-embed-text")).toBeDefined();
  });

  it("validateSpec accepts a well-formed ollama entry", () => {
    const spec: ModelSpec = {
      id: "x:1",
      family: "x",
      name: "x",
      tag: "1",
      type: "llm",
      displayName: "X 1",
      source: { protocol: "ollama", url: "ollama://x:1" },
    };
    expect(() => validateSpec(spec)).not.toThrow();
  });

  it("validateSpec rejects missing identity", () => {
    expect(() => validateSpec({ id: "", family: "", name: "", tag: "", type: "llm", displayName: "", source: { protocol: "ollama" } } as ModelSpec)).toThrow();
  });

  it("validateSpec rejects unsupported type", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "audio" as ModelSpec["type"],
        displayName: "X",
        source: { protocol: "ollama" },
      }),
    ).toThrow(/invalid type/);
  });

  it("validateSpec requires url for non-ollama protocols", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "image",
        displayName: "X",
        source: { protocol: "huggingface" },
      }),
    ).toThrow(/requires source\.url/);
  });

  it("validateSpec rejects malformed source.sha256", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "image",
        displayName: "X",
        source: { protocol: "url", url: "https://x/y", sha256: "nope" },
      }),
    ).toThrow(/malformed source\.sha256/);
  });

  it("validateCatalog rejects duplicate ids", () => {
    const cat: CatalogFile = {
      models: [
        { id: "x", family: "x", name: "x", tag: "1", type: "llm", displayName: "X", source: { protocol: "ollama" } },
        { id: "x", family: "x", name: "x", tag: "2", type: "llm", displayName: "X2", source: { protocol: "ollama" } },
      ],
    };
    expect(() => validateCatalog(cat)).toThrow(/duplicate id/);
  });

  it("validateCatalog rejects a missing models array", () => {
    expect(() => validateCatalog({} as CatalogFile)).toThrow();
  });

  it("loadCatalog rejects an invalid JSON file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-cat-"));
    try {
      const file = path.join(tmp, "catalog.json");
      await fs.writeFile(file, JSON.stringify({ models: [{ id: "a" }] }));
      await expect(loadCatalog(file)).rejects.toThrow();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("findSpec / getSpec resolve by id", async () => {
    const file = await loadCatalog();
    expect(findSpec(file, "gemma4:e4b")?.id).toBe("gemma4:e4b");
    expect(findSpec(file, "nope:1")).toBeUndefined();
    expect(() => getSpec(file, "nope:1")).toThrow();
  });

  it("registers the Gemma 4 12B-IT GGUF entry (v1.5.0 Phase 1 T001)", async () => {
    const file = await loadCatalog();
    const gguf = findSpec(file, "gemma-4-12b-it-gguf");
    expect(gguf).toBeDefined();
    expect(gguf?.type).toBe("llm");
    expect(gguf?.family).toBe("gemma4");
    // Item 32 acceptance: 256K context + native multimodal flag for Phase 5.
    expect(gguf?.contextWindow).toBe(262_144);
    expect(gguf?.multimodal).toBe(true);
    // Runnable via Ollama against the Unsloth HF GGUF repo.
    expect(gguf?.source.protocol).toBe("ollama");
    expect(gguf?.source.url).toBe("ollama://hf.co/unsloth/gemma-4-12b-it-GGUF");
    expect(gguf?.tags).toContain("recommended");
    expect(gguf?.tags).toContain("multimodal");
  });

  it("validateSpec accepts the controlnet + vae types introduced in v1.1.0 Phase 12", () => {
    const cn: ModelSpec = {
      id: "cn:x",
      family: "sana",
      name: "sana-controlnet",
      tag: "pose",
      type: "controlnet",
      displayName: "SANA-ControlNet Pose",
      source: {
        protocol: "huggingface",
        url: "https://huggingface.co/x/resolve/main/y.safetensors",
      },
    };
    expect(() => validateSpec(cn)).not.toThrow();
    const vae: ModelSpec = {
      id: "vae:x",
      family: "sana",
      name: "dc-ae",
      tag: "f32c32",
      type: "vae",
      displayName: "DC-AE",
      source: {
        protocol: "huggingface",
        url: "https://huggingface.co/x/resolve/main/y.safetensors",
      },
    };
    expect(() => validateSpec(vae)).not.toThrow();
  });

  it("bundled catalog carries the full SANA family from Phase 12", async () => {
    const file = await loadCatalog();
    const ids = new Set(file.models.map((m) => m.id));
    expect(ids).toEqual(
      expect.objectContaining({}),
    );
    // sub-task 12.1 acceptance: every SANA entry registered
    for (const id of [
      "sana-1.6b-1024",
      "sana-sprint-1024",
      "sana-1.6b-2k",
      "sana-1.6b-4k",
      "sana-1.6b-int4",
      "dc-ae-f32c32-sana-1.1",
      "sana-controlnet-pose",
      "sana-controlnet-depth",
      "sana-controlnet-canny",
      "sana-video-2b-720p",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    const dcae = file.models.find((m) => m.id === "dc-ae-f32c32-sana-1.1");
    expect(dcae?.type).toBe("vae");
    const cnPose = file.models.find((m) => m.id === "sana-controlnet-pose");
    expect(cnPose?.type).toBe("controlnet");
    const sana = file.models.find((m) => m.id === "sana-1.6b-1024");
    expect(sana?.type).toBe("image");
    expect(sana?.license).toBe("Apache-2.0");
    const sanaInt4 = file.models.find((m) => m.id === "sana-1.6b-int4");
    expect(sanaInt4?.runtimeDeps).toEqual(["nunchaku"]);
  });
});
