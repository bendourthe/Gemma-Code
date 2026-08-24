/**
 * v1.15.0 Phase 4 (Issue 3) -- sidecar ModelsService (reconcile + probes).
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ModelsService,
  queryOllamaTags,
  resolveCatalog,
  scanWeightsIds,
} from "../sidecar/src/models/modelsService";
import type { CatalogFile } from "../../core/registry/catalog";
import type { ListedModel, NexusModelRegistry } from "../../core/registry/NexusModelRegistry";

const CATALOG = {
  models: [
    { id: "gemma-4-12b-it-gguf", source: { protocol: "ollama", url: "ollama://gemma4:12b" } },
  ],
} as unknown as CatalogFile;

function fakeRegistry(
  listed: ListedModel[],
  onRemove?: (id: string) => void,
): NexusModelRegistry {
  return {
    list: async () => listed,
    remove: async (id: string) => {
      onRemove?.(id);
    },
  } as unknown as NexusModelRegistry;
}

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

const throwingFetch = (async () => {
  throw new Error("no ollama");
}) as unknown as typeof fetch;

describe("queryOllamaTags", () => {
  it("returns the set of model names", async () => {
    const fetchFn = (async () =>
      okJson({ models: [{ name: "gemma4:12b" }, { name: "llama3.1:8b" }] })) as unknown as typeof fetch;
    expect(await queryOllamaTags("http://x", fetchFn)).toEqual(
      new Set(["gemma4:12b", "llama3.1:8b"]),
    );
  });

  it("returns empty when Ollama is unreachable", async () => {
    expect(await queryOllamaTags("http://x", throwingFetch)).toEqual(new Set());
  });
});

describe("scanWeightsIds", () => {
  it("lists weight directory names, empty when the dir is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-models-"));
    expect(await scanWeightsIds(root)).toEqual(new Set());
    await fs.mkdir(path.join(root, "weights", "realvisxl-v5"), { recursive: true });
    await fs.mkdir(path.join(root, "weights", "sana-video-2b-720p"), { recursive: true });
    expect(await scanWeightsIds(root)).toEqual(new Set(["realvisxl-v5", "sana-video-2b-720p"]));
  });
});

describe("ModelsService.list", () => {
  it("reconciles a catalog-only entry present in Ollama to installed", async () => {
    const listed = [
      {
        id: "gemma-4-12b-it-gguf",
        displayName: "Gemma 4 12B",
        installed: false,
        source: "catalog-only",
        type: "llm",
      },
    ] as ListedModel[];
    const svc = new ModelsService({
      registry: fakeRegistry(listed),
      catalog: CATALOG,
      modelsRoot: "/nonexistent-models-root",
      fetchFn: (async () => okJson({ models: [{ name: "gemma4:12b" }] })) as unknown as typeof fetch,
      loadSnapshot: async () => null,
    });
    const out = await svc.list();
    expect(out[0]).toMatchObject({
      id: "gemma-4-12b-it-gguf",
      installed: true,
      source: "registry",
    });
  });
});

describe("ModelsService.diskUsage / remove", () => {
  it("sums installed registry model sizes", async () => {
    const listed = [
      { id: "a", displayName: "A", installed: true, source: "registry", sizeBytes: 100 },
      { id: "b", displayName: "B", installed: false, source: "catalog-only", sizeBytes: 999 },
    ] as ListedModel[];
    const svc = new ModelsService({
      registry: fakeRegistry(listed),
      catalog: CATALOG,
      modelsRoot: "/nonexistent-models-root",
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    expect((await svc.diskUsage()).usedBytes).toBe(100);
  });

  it("delegates remove to the registry", async () => {
    const removed: string[] = [];
    const svc = new ModelsService({
      registry: fakeRegistry([], (id) => removed.push(id)),
      catalog: CATALOG,
      modelsRoot: "/x",
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    await svc.remove("gemma-4-12b-it-gguf");
    expect(removed).toEqual(["gemma-4-12b-it-gguf"]);
  });

  it("marks snapshot-selected Qwen 3.5 4B as selectedAtInstall when Ollama lacks the tag", async () => {
    const listed = [
      {
        id: "qwen3.5:4b",
        displayName: "Qwen 3.5 4B",
        installed: false,
        source: "catalog-only",
        type: "llm",
        origin: "China",
        releaseDate: "2026-02-01",
        uncensored: false,
      },
    ] as ListedModel[];
    const svc = new ModelsService({
      registry: fakeRegistry(listed),
      catalog: { models: [{ id: "qwen3.5:4b", source: { protocol: "ollama", url: "ollama://qwen3.5:4b" } }] } as unknown as CatalogFile,
      modelsRoot: "/nonexistent-models-root",
      fetchFn: throwingFetch,
      loadSnapshot: async () => ({
        schemaVersion: 1,
        orderedIds: ["qwen3.5:4b"],
        recommendedByTask: {},
        downloadedSinceInstall: [],
      }),
    });
    const out = await svc.list();
    expect(out[0]).toMatchObject({
      id: "qwen3.5:4b",
      installed: false,
      selectedAtInstall: true,
      origin: "China",
      releaseDate: "2026-02-01",
      uncensored: false,
    });
  });
});

// v2.2.0 Phase 1 (1.1): catalog resolution surfaces failures instead of
// silently degrading to an empty catalog (the packaged-app "0 models" bug).
describe("resolveCatalog", () => {
  it("captures a load error for a missing NEXUS_CATALOG_PATH override", async () => {
    const prev = process.env.NEXUS_CATALOG_PATH;
    process.env.NEXUS_CATALOG_PATH = path.join(
      os.tmpdir(),
      "nexus-absent",
      "catalog.json",
    );
    try {
      const resolved = await resolveCatalog();
      expect(resolved.error).not.toBeNull();
      expect(resolved.file.models).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.NEXUS_CATALOG_PATH;
      else process.env.NEXUS_CATALOG_PATH = prev;
    }
  });

  it("captures a parse/validation error for a corrupt catalog file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-catalog-"));
    const corrupt = path.join(dir, "catalog.json");
    await fs.writeFile(corrupt, "{not json");
    const prev = process.env.NEXUS_CATALOG_PATH;
    process.env.NEXUS_CATALOG_PATH = corrupt;
    try {
      const resolved = await resolveCatalog();
      expect(resolved.error).not.toBeNull();
      expect(resolved.file.models).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.NEXUS_CATALOG_PATH;
      else process.env.NEXUS_CATALOG_PATH = prev;
    }
  });

  it("loads the real repo catalog with a null error", async () => {
    // The shipped catalog is the strongest fixture: this is exactly the file
    // the esbuild step copies next to the sidecar bundle.
    const repoCatalog = path.resolve(__dirname, "../../core/registry/catalog.json");
    const prev = process.env.NEXUS_CATALOG_PATH;
    process.env.NEXUS_CATALOG_PATH = repoCatalog;
    try {
      const resolved = await resolveCatalog();
      expect(resolved.error).toBeNull();
      expect(resolved.file.models.length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.NEXUS_CATALOG_PATH;
      else process.env.NEXUS_CATALOG_PATH = prev;
    }
  });
});
