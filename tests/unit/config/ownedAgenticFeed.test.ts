/**
 * v2.4.6 Phase 4 -- owned agentic feed with injected catalog/probe.
 */

import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { CatalogFile } from "../../../core/registry/catalog";
import { listOwnedAgenticModels } from "../../../modules/coding/config/ownedAgenticFeed";

const CATALOG = {
  models: [
    {
      id: "gemma-4-12b-it-gguf",
      displayName: "Gemma 4 12B",
      task: "chat",
      agentic: true,
    },
    {
      id: "leftover-coder",
      displayName: "Leftover",
      task: "agentic",
      agentic: true,
    },
  ],
} as unknown as CatalogFile;

describe("listOwnedAgenticModels", () => {
  it("does not surface an installed-but-unowned fixture", async () => {
    const entries = await listOwnedAgenticModels({
      catalog: CATALOG,
      snapshot: {
        schemaVersion: 1,
        orderedIds: ["gemma-4-12b-it-gguf"],
        recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
        downloadedSinceInstall: [],
      },
      probe: {
        ollamaTags: new Set(["gemma-4-12b-it-gguf", "leftover-coder"]),
        weightsIds: new Set(),
      },
    });
    expect(entries.map((entry) => entry.id)).toEqual(["gemma-4-12b-it-gguf"]);
  });

  it("scans weights when no probe is injected", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nexus-feed-"));
    try {
      const entries = await listOwnedAgenticModels({
        catalog: CATALOG,
        snapshot: {
          schemaVersion: 1,
          orderedIds: ["gemma-4-12b-it-gguf"],
          recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
          downloadedSinceInstall: [],
        },
        homeDirFn: () => dir,
        ollamaTags: new Set(["gemma-4-12b-it-gguf"]),
      });
      expect(entries.map((entry) => entry.id)).toEqual(["gemma-4-12b-it-gguf"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
