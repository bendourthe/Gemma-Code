/**
 * v2.2.0 Phase 2 (2.1) -- installed-model reconciliation.
 *
 * Regression net for the defect that made 9 verified downloads invisible:
 * the probe compared RAW catalog ids against directory names the installer had
 * already sanitized, and a failed catalog load erased every installed model.
 */

import { describe, expect, it } from "vitest";

import {
  isOnDisk,
  markInstalledFromProbe,
  safeDirName,
  synthesizeInstalledFromProbe,
  type InstalledProbe,
} from "../../../../core/registry/installedProbe";
import type { CatalogFile } from "../../../../core/registry/catalog";
import type { ListedModel } from "../../../../core/registry/NexusModelRegistry";

const CATALOG = {
  models: [
    { id: "sana-1.6b-2k", source: { protocol: "huggingface" } },
    { id: "wan2.1-t2v-1.3b", source: { protocol: "huggingface" } },
    { id: "sam2:hiera-tiny", source: { protocol: "huggingface" } },
    { id: "qwen2.5-coder:14b", source: { protocol: "ollama", url: "ollama://qwen2.5-coder:14b" } },
  ],
} as unknown as CatalogFile;

function catalogOnly(id: string): ListedModel {
  return { id, displayName: id, installed: false, source: "catalog-only" } as unknown as ListedModel;
}

function probe(partial: Partial<InstalledProbe>): InstalledProbe {
  return {
    ollamaTags: partial.ollamaTags ?? new Set<string>(),
    weightsIds: partial.weightsIds ?? new Set<string>(),
    ...(partial.weightsMarkerIds ? { weightsMarkerIds: partial.weightsMarkerIds } : {}),
  };
}

describe("safeDirName", () => {
  it("mirrors the installer's sanitization rule", () => {
    // Must match `_SAFE_DIR_CHAR_RE = [^A-Za-z0-9._-]` -> "-" in
    // scripts/installer/src/nexus_installer/engine/hf_weights_puller.py.
    expect(safeDirName("sam2:hiera-tiny")).toBe("sam2-hiera-tiny");
    expect(safeDirName("qwen2.5-coder:14b")).toBe("qwen2.5-coder-14b");
    expect(safeDirName("org/model")).toBe("org-model");
  });

  it("leaves already-safe ids untouched (dots and dashes survive)", () => {
    expect(safeDirName("sana-1.6b-2k")).toBe("sana-1.6b-2k");
    expect(safeDirName("wan2.1-t2v-1.3b")).toBe("wan2.1-t2v-1.3b");
  });
});

describe("isOnDisk", () => {
  it("matches a directory named exactly as the id", () => {
    expect(isOnDisk("sana-1.6b-2k", probe({ weightsIds: new Set(["sana-1.6b-2k"]) }))).toBe(true);
  });

  it("matches a sanitized directory for a colon-bearing id", () => {
    // This is the case the pre-v2.2.0 probe missed entirely.
    expect(isOnDisk("sam2:hiera-tiny", probe({ weightsIds: new Set(["sam2-hiera-tiny"]) }))).toBe(
      true,
    );
  });

  it("prefers the marker file over directory-name matching", () => {
    expect(
      isOnDisk(
        "sam2:hiera-tiny",
        probe({ weightsIds: new Set(["something-else"]), weightsMarkerIds: new Set(["sam2:hiera-tiny"]) }),
      ),
    ).toBe(true);
  });

  it("returns false when neither marker nor directory matches", () => {
    expect(isOnDisk("sana-1.6b-2k", probe({ weightsIds: new Set(["ltx-video"]) }))).toBe(false);
  });
});

describe("markInstalledFromProbe (Phase 2)", () => {
  it("flips the reference machine's diffusion models to installed", () => {
    // Directory names exactly as the installer wrote them for this host.
    const listed = ["sana-1.6b-2k", "wan2.1-t2v-1.3b"].map(catalogOnly);
    const result = markInstalledFromProbe(
      listed,
      CATALOG,
      probe({ weightsIds: new Set(["sana-1.6b-2k", "wan2.1-t2v-1.3b"]) }),
    );
    expect(result.every((m) => m.installed)).toBe(true);
    expect(result.every((m) => m.source === "registry")).toBe(true);
  });

  it("flips a colon-bearing id via its sanitized directory", () => {
    const result = markInstalledFromProbe(
      [catalogOnly("sam2:hiera-tiny")],
      CATALOG,
      probe({ weightsIds: new Set(["sam2-hiera-tiny"]) }),
    );
    expect(result[0]?.installed).toBe(true);
  });

  it("still flips Ollama-resident models by tag", () => {
    const result = markInstalledFromProbe(
      [catalogOnly("qwen2.5-coder:14b")],
      CATALOG,
      probe({ ollamaTags: new Set(["qwen2.5-coder:14b"]) }),
    );
    expect(result[0]?.installed).toBe(true);
  });

  it("leaves genuinely absent models alone", () => {
    const result = markInstalledFromProbe([catalogOnly("sana-1.6b-2k")], CATALOG, probe({}));
    expect(result[0]?.installed).toBe(false);
    expect(result[0]?.source).toBe("catalog-only");
  });
});

describe("synthesizeInstalledFromProbe", () => {
  it("produces rows from Ollama tags and weights dirs when the catalog failed", () => {
    const rows = synthesizeInstalledFromProbe(
      probe({
        ollamaTags: new Set(["qwen2.5-coder:14b"]),
        weightsIds: new Set(["sana-1.6b-2k", "ltx-video"]),
      }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([
      "ltx-video",
      "qwen2.5-coder:14b",
      "sana-1.6b-2k",
    ]);
    expect(rows.every((r) => r.installed)).toBe(true);
  });

  it("prefers marker ids over sanitized directory names", () => {
    const rows = synthesizeInstalledFromProbe(
      probe({
        weightsIds: new Set(["sam2-hiera-tiny"]),
        weightsMarkerIds: new Set(["sam2:hiera-tiny"]),
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(["sam2:hiera-tiny"]);
  });

  it("never duplicates ids already present in the listed set", () => {
    const rows = synthesizeInstalledFromProbe(
      probe({ weightsIds: new Set(["sana-1.6b-2k"]) }),
      new Set(["sana-1.6b-2k"]),
    );
    expect(rows).toEqual([]);
  });

  it("returns nothing when the probe is empty", () => {
    expect(synthesizeInstalledFromProbe(probe({}))).toEqual([]);
  });
});
