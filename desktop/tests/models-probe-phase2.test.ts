/**
 * v2.2.0 Phase 2 (2.1) -- sidecar-side probe: marker scanning, models-root
 * override, and the catalog-failure synthesis path through ModelsService.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MODEL_ID_MARKER,
  ModelsService,
  defaultModelsRoot,
  scanWeightsIds,
  scanWeightsMarkerIds,
} from "../sidecar/src/models/modelsService";
import type { CatalogFile } from "../../core/registry/catalog";
import type { ListedModel, NexusModelRegistry } from "../../core/registry/NexusModelRegistry";

const throwingFetch = (async () => {
  throw new Error("no ollama");
}) as unknown as typeof fetch;

function fakeRegistry(listed: ListedModel[]): NexusModelRegistry {
  return { list: async () => listed, remove: async () => {} } as unknown as NexusModelRegistry;
}

async function makeWeightsTree(
  dirs: Record<string, string | null>,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-weights-"));
  for (const [dirName, markerId] of Object.entries(dirs)) {
    const dir = path.join(root, "weights", dirName);
    await fs.mkdir(dir, { recursive: true });
    if (markerId !== null) {
      await fs.writeFile(path.join(dir, MODEL_ID_MARKER), `${markerId}\n`);
    }
  }
  return root;
}

describe("defaultModelsRoot", () => {
  it("defaults to <home>/.nexus/models", () => {
    expect(defaultModelsRoot(() => "/home/u", {})).toBe(
      path.join("/home/u", ".nexus", "models"),
    );
  });

  it("honours NEXUS_MODELS_ROOT so a custom models_root install is visible", () => {
    expect(defaultModelsRoot(() => "/home/u", { NEXUS_MODELS_ROOT: "/data/models" })).toBe(
      "/data/models",
    );
  });

  it("ignores a blank override", () => {
    expect(defaultModelsRoot(() => "/home/u", { NEXUS_MODELS_ROOT: "   " })).toBe(
      path.join("/home/u", ".nexus", "models"),
    );
  });
});

describe("scanWeightsMarkerIds", () => {
  it("reads the true catalog id out of each marker file", async () => {
    const root = await makeWeightsTree({
      "sam2-hiera-tiny": "sam2:hiera-tiny",
      "sana-1.6b-2k": "sana-1.6b-2k",
    });
    const ids = await scanWeightsMarkerIds(root);
    expect([...ids].sort()).toEqual(["sam2:hiera-tiny", "sana-1.6b-2k"]);
  });

  it("skips directories with no marker (pre-v2.2.0 installs)", async () => {
    const root = await makeWeightsTree({ "ltx-video": null, "sana-1.6b-2k": "sana-1.6b-2k" });
    const ids = await scanWeightsMarkerIds(root);
    expect([...ids]).toEqual(["sana-1.6b-2k"]);
    // ...but the directory itself is still discoverable by name.
    expect([...(await scanWeightsIds(root))].sort()).toEqual(["ltx-video", "sana-1.6b-2k"]);
  });

  it("returns empty for a missing weights root instead of throwing", async () => {
    const ids = await scanWeightsMarkerIds(path.join(os.tmpdir(), "nexus-absent-root"));
    expect(ids.size).toBe(0);
  });
});

describe("ModelsService.list (Phase 2)", () => {
  it("flips a sanitized-directory model to installed", async () => {
    const root = await makeWeightsTree({ "sam2-hiera-tiny": null });
    const catalog = {
      models: [{ id: "sam2:hiera-tiny", source: { protocol: "huggingface" } }],
    } as unknown as CatalogFile;
    const svc = new ModelsService({
      registry: fakeRegistry([
        { id: "sam2:hiera-tiny", displayName: "SAM2", installed: false, source: "catalog-only" } as unknown as ListedModel,
      ]),
      catalog,
      modelsRoot: root,
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    const listed = await svc.list();
    expect(listed[0]?.installed).toBe(true);
  });

  it("synthesizes rows from disk when the catalog failed to load", async () => {
    // The catalog-load-failed case: zero catalog rows to flip. Pre-v2.2.0 this
    // returned an empty list, hiding every model the user actually had.
    const root = await makeWeightsTree({ "sana-1.6b-2k": "sana-1.6b-2k", "ltx-video": null });
    const svc = new ModelsService({
      registry: fakeRegistry([]),
      catalog: { models: [] } as unknown as CatalogFile,
      modelsRoot: root,
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    const listed = await svc.list();
    expect(listed.map((m) => m.id).sort()).toEqual(["ltx-video", "sana-1.6b-2k"]);
    expect(listed.every((m) => m.installed)).toBe(true);
  });

  it("does not synthesize when the catalog loaded normally", async () => {
    const root = await makeWeightsTree({ "unknown-extra-dir": null });
    const catalog = {
      models: [{ id: "sana-1.6b-2k", source: { protocol: "huggingface" } }],
    } as unknown as CatalogFile;
    const svc = new ModelsService({
      registry: fakeRegistry([
        { id: "sana-1.6b-2k", displayName: "SANA", installed: false, source: "catalog-only" } as unknown as ListedModel,
      ]),
      catalog,
      modelsRoot: root,
      fetchFn: throwingFetch,
      loadSnapshot: async () => null,
    });
    const listed = await svc.list();
    expect(listed.map((m) => m.id)).toEqual(["sana-1.6b-2k"]);
  });
});
