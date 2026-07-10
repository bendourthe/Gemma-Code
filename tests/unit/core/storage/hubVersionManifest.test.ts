/**
 * v1.10.0 Phase 1 -- Nexus-Hub catalog version manifest I/O tests.
 *
 * Uses a per-test temp catalog dir so real `~/.nexus-ai/` is never touched.
 * Covers build (contract shape + derived URLs), deterministic serialization
 * (byte-identical, key order, no timestamps/absolute paths), write+read
 * round-trip + idempotency, read tolerance (missing / invalid / partial), and
 * layout resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildHubVersionManifest,
  serializeHubVersionManifest,
  readHubVersionManifest,
  writeHubVersionManifest,
  resolveHubLayout,
} from "../../../../core/storage/hubVersionManifest.js";
import { HUB_LAYOUT, hubVersionManifestPath } from "../../../../core/storage/paths.js";

let tempCatalog: string;

beforeEach(() => {
  tempCatalog = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-hubver-"));
});

afterEach(() => {
  try {
    fs.rmSync(tempCatalog, { recursive: true, force: true });
  } catch {
    // Non-fatal; the system tempdir reaper will catch any leftover.
  }
});

describe("buildHubVersionManifest", () => {
  it("builds the contract shape with derived URLs", () => {
    const m = buildHubVersionManifest({ version: "v3.11.1" });
    expect(m).toEqual({
      product: "Nexus-Hub",
      version: "v3.11.1",
      source_repo: "bendourthe/Nexus-Hub",
      releases_url: "https://github.com/bendourthe/Nexus-Hub/releases",
      latest_release_api:
        "https://api.github.com/repos/bendourthe/Nexus-Hub/releases/latest",
      layout: { ...HUB_LAYOUT },
    });
  });

  it("honors a custom source repo", () => {
    const m = buildHubVersionManifest({ version: "v1.0.0", sourceRepo: "acme/Hub" });
    expect(m.source_repo).toBe("acme/Hub");
    expect(m.releases_url).toBe("https://github.com/acme/Hub/releases");
    expect(m.latest_release_api).toBe(
      "https://api.github.com/repos/acme/Hub/releases/latest",
    );
  });
});

describe("serializeHubVersionManifest determinism", () => {
  it("is byte-identical across builds and ends with a newline", () => {
    const a = serializeHubVersionManifest(buildHubVersionManifest({ version: "v3.11.1" }));
    const b = serializeHubVersionManifest(buildHubVersionManifest({ version: "v3.11.1" }));
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });

  it("emits keys in canonical order (product first, layout last)", () => {
    const s = serializeHubVersionManifest(buildHubVersionManifest({ version: "v1" }));
    expect(s.indexOf('"product"')).toBeLessThan(s.indexOf('"version"'));
    expect(s.indexOf('"latest_release_api"')).toBeLessThan(s.indexOf('"layout"'));
  });

  it("contains no timestamps or absolute paths", () => {
    const s = serializeHubVersionManifest(buildHubVersionManifest({ version: "v1" }));
    expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    expect(s).not.toMatch(/[A-Za-z]:\\/); // Windows absolute path
    expect(s).not.toMatch(/\/home\//); // POSIX absolute path
  });
});

describe("write + read round-trip", () => {
  it("writes then reads back an equal manifest and creates the file", () => {
    const written = writeHubVersionManifest(tempCatalog, { version: "v3.11.1" });
    const read = readHubVersionManifest(tempCatalog);
    expect(read).toEqual(written);
    expect(fs.existsSync(hubVersionManifestPath(tempCatalog))).toBe(true);
  });

  it("creates the catalog dir if absent", () => {
    const nested = path.join(tempCatalog, "does", "not", "exist");
    writeHubVersionManifest(nested, { version: "v1" });
    expect(fs.existsSync(hubVersionManifestPath(nested))).toBe(true);
  });

  it("second write of the same version is byte-identical (idempotent)", () => {
    writeHubVersionManifest(tempCatalog, { version: "v3.11.1" });
    const first = fs.readFileSync(hubVersionManifestPath(tempCatalog), "utf8");
    writeHubVersionManifest(tempCatalog, { version: "v3.11.1" });
    const second = fs.readFileSync(hubVersionManifestPath(tempCatalog), "utf8");
    expect(second).toBe(first);
  });
});

describe("readHubVersionManifest tolerance", () => {
  it("returns null when the file is missing (not-yet-synced state)", () => {
    expect(readHubVersionManifest(tempCatalog)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    fs.mkdirSync(tempCatalog, { recursive: true });
    fs.writeFileSync(hubVersionManifestPath(tempCatalog), "{ not json", "utf8");
    expect(readHubVersionManifest(tempCatalog)).toBeNull();
  });

  it("returns null when version is missing", () => {
    fs.mkdirSync(tempCatalog, { recursive: true });
    fs.writeFileSync(
      hubVersionManifestPath(tempCatalog),
      JSON.stringify({ product: "Nexus-Hub" }),
      "utf8",
    );
    expect(readHubVersionManifest(tempCatalog)).toBeNull();
  });

  it("merges a partial layout over defaults", () => {
    fs.mkdirSync(tempCatalog, { recursive: true });
    fs.writeFileSync(
      hubVersionManifestPath(tempCatalog),
      JSON.stringify({ version: "v1", layout: { skills: "SK" } }),
      "utf8",
    );
    const m = readHubVersionManifest(tempCatalog);
    expect(m?.layout.skills).toBe("SK");
    expect(m?.layout.commands).toBe("commands"); // default preserved
  });
});

describe("resolveHubLayout", () => {
  it("returns HUB_LAYOUT when no manifest exists", () => {
    expect(resolveHubLayout(tempCatalog)).toEqual({ ...HUB_LAYOUT });
  });

  it("returns the manifest layout when present", () => {
    writeHubVersionManifest(tempCatalog, { version: "v1" });
    expect(resolveHubLayout(tempCatalog)).toEqual({ ...HUB_LAYOUT });
  });
});
