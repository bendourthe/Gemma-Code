/**
 * v1.10.0 Phase 4 (T023/T024) -- legacy DevAI-Hub catalog cleanup tests.
 *
 * Uses a per-test temp `~/.nexus` home. Proves the cleanup removes ONLY
 * `<nexusHome>/skills/devai-hub/` (and `<nexusHome>/skills/` if empty), is
 * idempotent, guards against empty/root homes, and never touches sibling app
 * data (settings.json, mcp.json, models/, session-artifacts/, skills/user).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { migrateLegacyCatalogCleanup } from "../../../../core/skills/migrateLegacyCatalog.js";

let nexusHome: string;

beforeEach(() => {
  nexusHome = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-migrate-"));
});

afterEach(() => {
  try {
    fs.rmSync(nexusHome, { recursive: true, force: true });
  } catch {
    // Non-fatal.
  }
});

function seedLegacyCatalog(): string {
  const dir = path.join(nexusHome, "skills", "devai-hub", "v1.0.0", "catalog", "skills");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# legacy", "utf-8");
  return path.join(nexusHome, "skills", "devai-hub");
}

function seedAppData(): void {
  fs.mkdirSync(nexusHome, { recursive: true });
  fs.writeFileSync(path.join(nexusHome, "settings.json"), '{"k":1}', "utf-8");
  fs.writeFileSync(path.join(nexusHome, "mcp.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(nexusHome, "models"), { recursive: true });
  fs.mkdirSync(path.join(nexusHome, "session-artifacts"), { recursive: true });
}

describe("migrateLegacyCatalogCleanup", () => {
  it("is a no-op when there is no legacy devai-hub cache", () => {
    const result = migrateLegacyCatalogCleanup(nexusHome);
    expect(result.removedLegacyCatalog).toBe(false);
    expect(result.removedEmptySkillsRoot).toBe(false);
  });

  it("removes the legacy devai-hub cache", () => {
    const legacy = seedLegacyCatalog();
    const result = migrateLegacyCatalogCleanup(nexusHome);
    expect(result.removedLegacyCatalog).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("removes ~/.nexus/skills when devai-hub was its only entry", () => {
    seedLegacyCatalog();
    const result = migrateLegacyCatalogCleanup(nexusHome);
    expect(result.removedEmptySkillsRoot).toBe(true);
    expect(fs.existsSync(path.join(nexusHome, "skills"))).toBe(false);
  });

  it("preserves ~/.nexus/skills when user skills also live there", () => {
    seedLegacyCatalog();
    const userDir = path.join(nexusHome, "skills", "user");
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, "keep.md"), "x", "utf-8");
    const result = migrateLegacyCatalogCleanup(nexusHome);
    expect(result.removedLegacyCatalog).toBe(true);
    expect(result.removedEmptySkillsRoot).toBe(false);
    expect(fs.existsSync(userDir)).toBe(true);
    expect(fs.existsSync(path.join(nexusHome, "skills", "devai-hub"))).toBe(false);
  });

  it("never touches sibling app data (settings, mcp, models, sessions)", () => {
    seedAppData();
    seedLegacyCatalog();
    migrateLegacyCatalogCleanup(nexusHome);
    expect(fs.existsSync(path.join(nexusHome, "settings.json"))).toBe(true);
    expect(fs.readFileSync(path.join(nexusHome, "settings.json"), "utf-8")).toBe('{"k":1}');
    expect(fs.existsSync(path.join(nexusHome, "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(nexusHome, "models"))).toBe(true);
    expect(fs.existsSync(path.join(nexusHome, "session-artifacts"))).toBe(true);
  });

  it("is idempotent -- a second run is a no-op", () => {
    seedLegacyCatalog();
    const first = migrateLegacyCatalogCleanup(nexusHome);
    expect(first.removedLegacyCatalog).toBe(true);
    const second = migrateLegacyCatalogCleanup(nexusHome);
    expect(second.removedLegacyCatalog).toBe(false);
  });

  it("refuses an empty home", () => {
    expect(() => migrateLegacyCatalogCleanup("")).toThrow(/must not be empty/);
  });

  it("refuses a filesystem root", () => {
    const root = path.parse(process.cwd()).root;
    expect(() => migrateLegacyCatalogCleanup(root)).toThrow(/filesystem root/);
  });
});
