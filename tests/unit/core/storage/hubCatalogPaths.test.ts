/**
 * v1.10.0 Phase 1 -- Nexus-Hub catalog path + layout resolver tests.
 *
 * Covers the pure helpers in `core/storage/paths.ts`:
 *  - nexusAiHome / catalogRoot (the isolated `~/.nexus-ai/catalog/` subtree)
 *  - hubLayoutDir (defaults, manifest-layout override, partial-layout fallback)
 *  - hubVersionManifestPath
 *  - HUB_LAYOUT is frozen and complete
 *  - a CI invariant: paths.ts performs no filesystem I/O
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  nexusAiHome,
  catalogRoot,
  hubLayoutDir,
  hubVersionManifestPath,
  HUB_LAYOUT,
  type HubLayout,
} from "../../../../core/storage/paths.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const home = (): string => path.join(path.sep, "home", "u");

describe("nexusAiHome / catalogRoot", () => {
  it("resolves ~/.nexus-ai for the injected home", () => {
    expect(nexusAiHome(home)).toBe(path.join(path.sep, "home", "u", ".nexus-ai"));
  });

  it("catalogRoot appends the isolated catalog subtree", () => {
    expect(catalogRoot(nexusAiHome(home))).toBe(
      path.join(path.sep, "home", "u", ".nexus-ai", "catalog"),
    );
  });

  it("catalogRoot accepts an explicit root (used by tests / overrides)", () => {
    expect(catalogRoot(path.join(path.sep, "tmp", "x"))).toBe(
      path.join(path.sep, "tmp", "x", "catalog"),
    );
  });
});

describe("hubLayoutDir", () => {
  const root = path.join(path.sep, "tmp", "cat");

  it("uses HUB_LAYOUT defaults, including the mcp-configs dir and the instructions file", () => {
    expect(hubLayoutDir(root, "skills")).toBe(path.join(root, "skills"));
    expect(hubLayoutDir(root, "mcp_configs")).toBe(path.join(root, "mcp-configs"));
    expect(hubLayoutDir(root, "instructions")).toBe(path.join(root, "NEXUS_AI.md"));
  });

  it("prefers a manifest-provided layout override", () => {
    const layout: Partial<HubLayout> = { skills: "SKILLS_V2" };
    expect(hubLayoutDir(root, "skills", layout)).toBe(path.join(root, "SKILLS_V2"));
  });

  it("falls back per-key when the layout is partial", () => {
    const layout: Partial<HubLayout> = { skills: "SKILLS_V2" };
    // `commands` is absent from the partial layout -> default is used.
    expect(hubLayoutDir(root, "commands", layout)).toBe(path.join(root, "commands"));
  });
});

describe("hubVersionManifestPath", () => {
  it("resolves nexus-hub-version.json under the catalog root", () => {
    const root = path.join(path.sep, "tmp", "cat");
    expect(hubVersionManifestPath(root)).toBe(path.join(root, "nexus-hub-version.json"));
  });
});

describe("HUB_LAYOUT", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(HUB_LAYOUT)).toBe(true);
  });

  it("covers every layout key", () => {
    expect(Object.keys(HUB_LAYOUT).sort()).toEqual([
      "agents",
      "commands",
      "hooks",
      "instructions",
      "mcp_configs",
      "rules",
      "skills",
      "templates",
    ]);
  });
});

describe("paths.ts purity (CI invariant)", () => {
  it("performs no filesystem I/O", () => {
    const src = fs.readFileSync(
      path.join(HERE, "../../../../core/storage/paths.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/\bfs\./);
    expect(src).not.toMatch(/readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync/);
  });
});
