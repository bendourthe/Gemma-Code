/**
 * v1.15.0 Phase 4 (Issue 3) -- sidecar ModelsService (reconcile + probes).
 */

import { describe, it, expect, vi } from "vitest";
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

  it("collects the model field when name is absent (newer Ollama /api/tags)", async () => {
    const fetchFn = (async () =>
      okJson({ models: [{ model: "gemma4:12b" }] })) as unknown as typeof fetch;
    expect(await queryOllamaTags("http://x", fetchFn)).toEqual(new Set(["gemma4:12b"]));
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

  it("marks gemma-4-12b-it-gguf installed when /api/tags only has model, not name", async () => {
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
      fetchFn: (async () => okJson({ models: [{ model: "gemma4:12b" }] })) as unknown as typeof fetch,
      loadSnapshot: async () => null,
    });
    const out = await svc.list();
    expect(out[0]).toMatchObject({
      id: "gemma-4-12b-it-gguf",
      installed: true,
      source: "registry",
    });
  });

  it("copies catalog contextWindow onto the DTO as null rather than 0 or 128000", async () => {
    const listed = [
      {
        id: "lfm2.5:2.6b",
        displayName: "LFM2.5 2.6B",
        installed: false,
        source: "catalog-only",
        type: "llm",
        contextWindow: 128000,
      },
      {
        id: "sana-1.6b-4k",
        displayName: "SANA 1.6B 4K",
        installed: false,
        source: "catalog-only",
        type: "image",
        contextWindow: null,
      },
    ] as ListedModel[];
    const svc = new ModelsService({
      registry: fakeRegistry(listed),
      catalog: CATALOG,
      modelsRoot: "/nonexistent-models-root",
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    const out = await svc.list();
    expect(out[0]?.contextWindow).toBe(128000);
    expect(out[1]?.contextWindow).toBeNull();
  });
});

describe("ModelsService.diskUsage / remove", () => {
  it("measures actual model files and excludes temporary partial downloads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-model-usage-"));
    await fs.mkdir(path.join(root, "weights", "a"), { recursive: true });
    await fs.mkdir(path.join(root, "_tmp"), { recursive: true });
    await fs.writeFile(path.join(root, "weights", "a", "model.bin"), Buffer.alloc(100));
    await fs.writeFile(path.join(root, "_tmp", "partial.bin"), Buffer.alloc(999));
    const svc = new ModelsService({
      registry: fakeRegistry([]),
      catalog: CATALOG,
      modelsRoot: root,
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    const usage = await svc.diskUsage();
    expect(usage.usedBytes).toBe(100);
    expect(usage.modelBytes).toBe(100);
    expect(usage.measurementPath).toBe(path.resolve(root));
    expect(Number.isNaN(Date.parse(usage.measuredAt))).toBe(false);
  });

  it("shares an in-flight disk measurement across concurrent callers", async () => {
    let resolveMeasurement!: (value: Awaited<ReturnType<ModelsService["diskUsage"]>>) => void;
    const measureDisk = vi.fn(
      () => new Promise<Awaited<ReturnType<ModelsService["diskUsage"]>>>((resolve) => {
        resolveMeasurement = resolve;
      }),
    );
    const svc = new ModelsService({
      registry: fakeRegistry([]),
      catalog: CATALOG,
      modelsRoot: "/x",
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
      measureDisk,
    });
    const first = svc.diskUsage();
    const second = svc.diskUsage();
    const expected = {
      usedBytes: 10,
      modelBytes: 10,
      freeBytes: 90,
      capacityBytes: 100,
      measurementPath: "/x",
      measuredAt: "2026-08-29T00:00:00.000Z",
    };
    resolveMeasurement(expected);
    await expect(Promise.all([first, second])).resolves.toEqual([expected, expected]);
    expect(measureDisk).toHaveBeenCalledTimes(1);
  });

  it("returns the last measurement when a refresh exceeds its response bound", async () => {
    const first = {
      usedBytes: 10,
      modelBytes: 10,
      freeBytes: 90,
      capacityBytes: 100,
      measurementPath: "/x",
      measuredAt: "2026-08-29T00:00:00.000Z",
    };
    const never = new Promise<Awaited<ReturnType<ModelsService["diskUsage"]>>>(() => undefined);
    const measureDisk = vi.fn()
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(never);
    const svc = new ModelsService({
      registry: fakeRegistry([]),
      catalog: CATALOG,
      modelsRoot: "/x",
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
      measureDisk,
      diskMeasurementTimeoutMs: 5,
    });
    await expect(svc.diskUsage()).resolves.toEqual(first);
    await expect(svc.diskUsage()).resolves.toEqual(first);
    expect(measureDisk).toHaveBeenCalledTimes(2);
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
