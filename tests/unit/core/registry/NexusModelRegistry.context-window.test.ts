import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CatalogFile } from "../../../../core/registry/catalog.js";
import { ModelStorage } from "../../../../core/registry/ModelStorage.js";
import { NexusModelRegistry } from "../../../../core/registry/NexusModelRegistry.js";

const CATALOG = {
  models: [
    {
      id: "lfm2.5:2.6b",
      family: "lfm2.5",
      name: "lfm2.5",
      tag: "2.6b",
      type: "llm",
      displayName: "LFM2.5 2.6B",
      contextWindow: 128000,
      source: { protocol: "ollama", url: "ollama://lfm2.5:2.6b" },
    },
    {
      id: "split-in-out",
      family: "split",
      name: "split",
      tag: "1",
      type: "llm",
      displayName: "Split",
      contextWindowIn: 32000,
      contextWindowOut: 8000,
      source: { protocol: "ollama", url: "ollama://split:1" },
    },
    {
      id: "sana-1.6b-4k",
      family: "sana",
      name: "sana",
      tag: "1.6b-4k",
      type: "image",
      displayName: "SANA 1.6B 4K",
      contextWindow: null,
      source: { protocol: "huggingface", repo: "example/sana" },
    },
  ],
} as unknown as CatalogFile;

describe("NexusModelRegistry list contextWindow (v2.2.7 Phase 1)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-ctx-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("marshals catalog windows and leaves null rows null", async () => {
    const storage = new ModelStorage(root);
    const registry = new NexusModelRegistry({ storage, catalog: CATALOG });
    const listed = await registry.list();
    const byId = new Map(listed.map((m) => [m.id, m]));
    expect(byId.get("lfm2.5:2.6b")?.contextWindow).toBe(128000);
    expect(byId.get("split-in-out")?.contextWindowIn).toBe(32000);
    expect(byId.get("split-in-out")?.contextWindowOut).toBe(8000);
    expect(byId.get("sana-1.6b-4k")?.contextWindow).toBeNull();
    expect(listed.some((m) => m.contextWindow === 0)).toBe(false);
  });
});
