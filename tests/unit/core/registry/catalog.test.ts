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
});
