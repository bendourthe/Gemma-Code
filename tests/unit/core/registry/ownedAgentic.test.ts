/**
 * v2.4.6 Phase 4 -- owned agentic allowlist for the VS Code coding host.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { CatalogFile } from "../../../../core/registry/catalog";
import type { InstalledProbe } from "../../../../core/registry/installedProbe";
import {
  defaultOwnedAgenticId,
  enumerateOwnedAgenticModels,
  isAgenticSpec,
  resolveCodingModelSelection,
  resolveOwnedAgenticId,
  EMPTY_OWNED_AGENTIC_MESSAGE,
  UNKNOWN_OWNED_AGENTIC_MESSAGE,
} from "../../../../core/registry/ownedAgentic";
import {
  emptySelectionSnapshot,
  loadSelectionSnapshot,
  ownedIdSet,
  parseSelectionSnapshot,
  recommendOrderForTask,
  type SelectionSnapshot,
} from "../../../../core/registry/ownedSelection";
import {
  collectWeightsProbe,
  MODEL_ID_MARKER,
  modelsRoot,
  scanWeightsIds,
  scanWeightsMarkerIds,
} from "../../../../core/registry/scanWeightsProbe";

const UNOWNED_INSTALLED = "leftover-coder";
const IMAGE_LEFTOVER = "juggernaut-xl-v9";

const CATALOG = {
  models: [
    {
      id: "gemma-4-12b-it-gguf",
      displayName: "Gemma 4 12B",
      task: "chat",
      agentic: true,
    },
    {
      id: "qwen2.5-coder:14b",
      displayName: "Qwen2.5 Coder 14B",
      task: "agentic",
      agentic: true,
    },
    {
      id: UNOWNED_INSTALLED,
      displayName: "Leftover Coder",
      task: "agentic",
      agentic: true,
    },
    {
      id: IMAGE_LEFTOVER,
      displayName: "Juggernaut XL v9",
      task: "image",
      agentic: false,
    },
    {
      id: "catalog-only-coder",
      displayName: "Catalog Only Coder",
      task: "agentic",
      agentic: true,
    },
  ],
} as unknown as CatalogFile;

function probeWith(...ids: string[]): InstalledProbe {
  return {
    ollamaTags: new Set(ids),
    weightsIds: new Set(),
  };
}

function snapshot(partial: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    schemaVersion: 1,
    orderedIds: partial.orderedIds ?? [],
    recommendedByTask: partial.recommendedByTask ?? {},
    downloadedSinceInstall: partial.downloadedSinceInstall ?? [],
  };
}

describe("ownedIdSet", () => {
  it("is empty when the snapshot is missing (fail closed)", () => {
    expect(ownedIdSet(null).size).toBe(0);
    expect(ownedIdSet(undefined).size).toBe(0);
  });

  it("unions orderedIds and downloadedSinceInstall", () => {
    const owned = ownedIdSet(
      snapshot({
        orderedIds: ["gemma-4-12b-it-gguf"],
        downloadedSinceInstall: ["qwen2.5-coder:14b"],
      }),
    );
    expect([...owned].sort()).toEqual([
      "gemma-4-12b-it-gguf",
      "qwen2.5-coder:14b",
    ]);
  });
});

describe("parseSelectionSnapshot", () => {
  it("rejects a missing schema or orderedIds", () => {
    expect(parseSelectionSnapshot(null)).toBeNull();
    expect(
      parseSelectionSnapshot({ schemaVersion: 2, orderedIds: [] }),
    ).toBeNull();
    expect(parseSelectionSnapshot({ schemaVersion: 1 })).toBeNull();
  });

  it("loads recommendedByTask.agentic", () => {
    const parsed = parseSelectionSnapshot({
      schemaVersion: 1,
      orderedIds: ["gemma-4-12b-it-gguf"],
      recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
      downloadedSinceInstall: [],
    });
    expect(parsed?.recommendedByTask.agentic).toBe("gemma-4-12b-it-gguf");
  });

  it("drops non-string ids and missing downloadedSinceInstall", () => {
    const parsed = parseSelectionSnapshot({
      schemaVersion: 1,
      orderedIds: ["ok", "", 3],
      recommendedByTask: { chat: "gemma-4-e4b" },
    });
    expect(parsed?.orderedIds).toEqual(["ok"]);
    expect(parsed?.downloadedSinceInstall).toEqual([]);
    expect(parsed?.recommendedByTask.chat).toBe("gemma-4-e4b");
  });

  it("exports an empty snapshot", () => {
    expect(emptySelectionSnapshot().orderedIds).toEqual([]);
  });

  it("puts recommended then ordered then downloaded in recommend order", () => {
    expect(
      recommendOrderForTask(
        snapshot({
          orderedIds: ["b", "c"],
          recommendedByTask: { agentic: "a" },
          downloadedSinceInstall: ["d"],
        }),
        "agentic",
      ),
    ).toEqual(["a", "b", "c", "d"]);
  });
});

describe("enumerateOwnedAgenticModels", () => {
  const ownedSnap = snapshot({
    orderedIds: ["gemma-4-12b-it-gguf"],
    recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
    downloadedSinceInstall: ["qwen2.5-coder:14b"],
  });

  it("lists only installer-or-Settings-owned agentic ids that are present", () => {
    const ids = enumerateOwnedAgenticModels(
      CATALOG,
      ownedSnap,
      probeWith(
        "gemma-4-12b-it-gguf",
        "qwen2.5-coder:14b",
        UNOWNED_INSTALLED,
        IMAGE_LEFTOVER,
      ),
    ).map((entry) => entry.id);
    expect(ids).toEqual(["gemma-4-12b-it-gguf", "qwen2.5-coder:14b"]);
    expect(ids).not.toContain(UNOWNED_INSTALLED);
    expect(ids).not.toContain(IMAGE_LEFTOVER);
    expect(ids).not.toContain("catalog-only-coder");
  });

  it("returns empty when the snapshot is missing instead of every Ollama tag", () => {
    const ids = enumerateOwnedAgenticModels(
      CATALOG,
      null,
      probeWith("gemma-4-12b-it-gguf", "qwen2.5-coder:14b", UNOWNED_INSTALLED),
    );
    expect(ids).toEqual([]);
  });

  it("omits an owned catalog id that is not installed", () => {
    const ids = enumerateOwnedAgenticModels(
      CATALOG,
      ownedSnap,
      probeWith("gemma-4-12b-it-gguf"),
    ).map((entry) => entry.id);
    expect(ids).toEqual(["gemma-4-12b-it-gguf"]);
    expect(ids).not.toContain("qwen2.5-coder:14b");
  });

  it("defaults to recommendedByTask.agentic when that id is owned", () => {
    const entries = enumerateOwnedAgenticModels(
      CATALOG,
      ownedSnap,
      probeWith("gemma-4-12b-it-gguf", "qwen2.5-coder:14b"),
    );
    expect(defaultOwnedAgenticId(entries, ownedSnap)).toBe(
      "gemma-4-12b-it-gguf",
    );
  });
});

describe("resolveOwnedAgenticId", () => {
  const entries = [
    { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
    { id: "qwen2.5-coder:14b", displayName: "Qwen2.5 Coder 14B" },
  ];

  it("points at Settings when the owned set is empty", () => {
    const result = resolveOwnedAgenticId("gemma-4-12b-it-gguf", []);
    expect(result).toEqual({
      ok: false,
      code: "empty",
      message: EMPTY_OWNED_AGENTIC_MESSAGE,
    });
  });

  it("points at Settings for an unknown id", () => {
    const result = resolveOwnedAgenticId(UNOWNED_INSTALLED, entries);
    expect(result).toEqual({
      ok: false,
      code: "not_owned",
      message: UNKNOWN_OWNED_AGENTIC_MESSAGE,
    });
  });

  it("accepts an owned id", () => {
    expect(resolveOwnedAgenticId("qwen2.5-coder:14b", entries)).toEqual({
      ok: true,
      id: "qwen2.5-coder:14b",
    });
  });

  it("points at Settings when the id is omitted", () => {
    expect(resolveOwnedAgenticId(undefined, entries).ok).toBe(false);
  });
});

describe("resolveCodingModelSelection", () => {
  const entries = [
    { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
    { id: "qwen2.5-coder:14b", displayName: "Qwen2.5 Coder 14B" },
  ];
  const snap = snapshot({
    orderedIds: ["qwen2.5-coder:14b", "gemma-4-12b-it-gguf"],
    recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
  });

  it("keeps a current id that is already owned", () => {
    expect(
      resolveCodingModelSelection("qwen2.5-coder:14b", entries, snap),
    ).toEqual({
      kind: "keep",
      id: "qwen2.5-coder:14b",
      displayName: "Qwen2.5 Coder 14B",
    });
  });

  it("sets the recommended owned agentic id when current is not owned", () => {
    expect(resolveCodingModelSelection("gemma4:e4b", entries, snap)).toEqual({
      kind: "set",
      id: "gemma-4-12b-it-gguf",
      displayName: "Gemma 4 12B",
    });
  });

  it("is empty when nothing is owned", () => {
    expect(resolveCodingModelSelection("gemma4:e4b", [], snap)).toEqual({
      kind: "empty",
    });
  });
});

describe("isAgenticSpec", () => {
  it("treats Gemma 4 chat models with the agentic flag as agentic", () => {
    expect(isAgenticSpec({ task: "chat", agentic: true })).toBe(true);
    expect(isAgenticSpec({ task: "agentic", agentic: true })).toBe(true);
    expect(isAgenticSpec({ task: "image", agentic: false })).toBe(false);
    expect(isAgenticSpec({ task: "chat", agentic: false })).toBe(false);
  });
});

describe("loadSelectionSnapshot", () => {
  it("returns null when the file is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nexus-owned-"));
    try {
      expect(await loadSelectionSnapshot(() => dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses a written snapshot", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nexus-owned-"));
    try {
      await mkdir(path.join(dir, ".nexus"), { recursive: true });
      await writeFile(
        path.join(dir, ".nexus", "selected-models.json"),
        JSON.stringify({
          schemaVersion: 1,
          orderedIds: ["gemma-4-12b-it-gguf"],
          recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
          downloadedSinceInstall: [],
        }),
        "utf8",
      );
      const loaded = await loadSelectionSnapshot(() => dir);
      expect(loaded?.orderedIds).toEqual(["gemma-4-12b-it-gguf"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("collectWeightsProbe", () => {
  it("reads directory names and .nexus-model-id markers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nexus-weights-"));
    try {
      const weights = path.join(root, "weights");
      await mkdir(path.join(weights, "leftover-coder"), { recursive: true });
      await mkdir(path.join(weights, "sanitized-id"), { recursive: true });
      await writeFile(
        path.join(weights, "sanitized-id", MODEL_ID_MARKER),
        "qwen2.5-coder:14b\n",
      );
      const probe = await collectWeightsProbe(
        root,
        new Set(["gemma-4-12b-it-gguf"]),
      );
      expect(probe.ollamaTags.has("gemma-4-12b-it-gguf")).toBe(true);
      expect(probe.weightsIds.has("leftover-coder")).toBe(true);
      expect(probe.weightsMarkerIds?.has("qwen2.5-coder:14b")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns empty sets when weights are missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nexus-noweights-"));
    try {
      expect((await scanWeightsIds(root)).size).toBe(0);
      expect((await scanWeightsMarkerIds(root)).size).toBe(0);
      expect(modelsRoot(() => root)).toContain("models");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
