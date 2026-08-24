// v2.2.0 Phase 3 (3.2) -- read the installed Nexus-Hub catalog for the UI.
//
// Closes NHC.P6.B: `ipcSkillsClient.list()` returned a hardcoded `[]`, so
// Settings > Skills showed "(0)" in all three sections no matter what was on
// disk. The page could not distinguish "nothing synced" from "we never asked".
//
// Deliberately independent of `SkillCatalog`/`SkillLoader`: those load skills
// INTO an agent session (parsing bodies, computing content hashes, scanning).
// This reader answers a narrower question - what is on disk, and what is it
// called - so listing thousands of skill files never pays the loading cost and
// never injects skill bodies into a prompt. Full bodies load on invocation.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { hubLayoutDir, type HubLayoutKey } from "../../../../core/storage/paths.js";
import { resolveHubLayout } from "../../../../core/storage/hubVersionManifest.js";

/** One row for Settings > Skills. Mirrors the UI's `SkillRowDto` shape. */
export interface HubSkillRow {
  id: string;
  displayName: string;
  category?: string;
  path: string;
  tags?: readonly string[];
  active?: boolean;
  provenance: {
    source: "builtin" | "user" | "nexus-hub";
    tag?: string;
    contentHash: string;
  };
}

export interface HubCatalogListing {
  rows: HubSkillRow[];
  /** Non-null when the catalog directory exists but could not be read. */
  error: string | null;
  /** Counts per section, for the page header. */
  counts: { "nexus-hub": number; user: number; builtin: number };
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Pull `name`, `description`, and `category` out of SKILL.md frontmatter. */
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  category?: string;
} {
  const match = FRONTMATTER.exec(content);
  if (!match) return {};
  const out: { name?: string; description?: string; category?: string } = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!value) continue;
    if (key === "name") out.name = value;
    else if (key === "description") out.description = value;
    else if (key === "category") out.category = value;
  }
  return out;
}

/** Cheap stable id for a skill file; avoids hashing whole bodies at list time. */
function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function readSkillsDir(
  dir: string,
  source: "nexus-hub" | "user" | "builtin",
  tag: string | null,
): Promise<HubSkillRow[]> {
  const rows: HubSkillRow[] = [];
  let entries: string[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return rows;
  }
  await Promise.all(
    entries.map(async (name) => {
      const skillFile = path.join(dir, name, "SKILL.md");
      let content = "";
      try {
        content = await fs.readFile(skillFile, "utf8");
      } catch {
        // A directory without SKILL.md is not a skill; skip it silently. A
        // malformed entry must never break the whole listing.
        return;
      }
      const fm = parseSkillFrontmatter(content);
      rows.push({
        id: source === "builtin" ? name : `${source}/${name}`,
        displayName: fm.name || name,
        ...(fm.category ? { category: fm.category } : {}),
        path: skillFile,
        ...(fm.description ? { tags: [fm.description] } : {}),
        active: true,
        provenance: {
          source,
          ...(tag ? { tag } : {}),
          contentHash: shortHash(content),
        },
      });
    }),
  );
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return rows;
}

export interface ReadHubCatalogOptions {
  /** Catalog subtree root (`~/.nexus-ai/catalog`). */
  readonly catalogDir: string;
  /** User-authored overlay root; defaults to `<catalogDir>/../user`. */
  readonly userDir?: string;
  /** Installed tag, stamped onto nexus-hub provenance. */
  readonly tag?: string | null;
}

/**
 * List every skill visible to the app: the synced Nexus-Hub catalog plus the
 * user's own overlay. Never throws - a missing catalog yields zero rows with a
 * null error, which the UI renders as "not synced" (distinct from the
 * backend-down banner introduced in Phase 2).
 */
export async function readHubCatalog(
  opts: ReadHubCatalogOptions,
): Promise<HubCatalogListing> {
  const { catalogDir } = opts;
  const tag = opts.tag ?? null;
  let error: string | null = null;

  let skillsDir = path.join(catalogDir, "skills");
  try {
    skillsDir = hubLayoutDir(catalogDir, "skills" as HubLayoutKey, resolveHubLayout(catalogDir));
  } catch (err) {
    // A corrupt layout manifest must not hide the skills that are on disk;
    // fall back to the conventional subdir and report the problem.
    error = err instanceof Error ? err.message : String(err);
  }

  const userDir = opts.userDir ?? path.join(path.dirname(catalogDir), "user", "skills");
  const [hubRows, userRows] = await Promise.all([
    readSkillsDir(skillsDir, "nexus-hub", tag),
    readSkillsDir(userDir, "user", null),
  ]);

  const rows = [...hubRows, ...userRows];
  return {
    rows,
    error,
    counts: {
      "nexus-hub": hubRows.length,
      user: userRows.length,
      builtin: 0,
    },
  };
}

/** Count the `.md` command files the hub ships (for the coding surface hint). */
export async function countHubCommands(catalogDir: string): Promise<number> {
  try {
    const dir = hubLayoutDir(catalogDir, "commands" as HubLayoutKey, resolveHubLayout(catalogDir));
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** One hub command descriptor for the Agentic composer. */
export interface HubCommandRow {
  readonly name: string;
  readonly description: string;
  readonly source: "nexus-hub";
}

const COMMAND_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Read `<catalog>/commands/*.md` into composer descriptors.
 *
 * Deliberately NOT `modules/coding/commands/HubCommandCatalogLoader`: that
 * module imports a vscode-coupled logger, so it can only ever run inside the
 * VS Code extension host. That coupling is precisely why the desktop app had
 * no hub command discovery at all. This reader parses the same frontmatter
 * with no editor dependency, and returns only names + descriptions -- command
 * bodies stay on disk until invocation, so discovery costs no prompt context.
 */
export async function readHubCommands(catalogDir: string): Promise<HubCommandRow[]> {
  let dir: string;
  try {
    dir = hubLayoutDir(catalogDir, "commands" as HubLayoutKey, resolveHubLayout(catalogDir));
  } catch {
    dir = path.join(catalogDir, "commands");
  }
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const rows: HubCommandRow[] = [];
  await Promise.all(
    files.map(async (file) => {
      const name = file.replace(/\.md$/, "").trim();
      if (!name) return;
      let description = "";
      try {
        const content = await fs.readFile(path.join(dir, file), "utf8");
        const match = COMMAND_FRONTMATTER.exec(content);
        for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
          const idx = line.indexOf(":");
          if (idx > 0 && line.slice(0, idx).trim() === "description") {
            description = line
              .slice(idx + 1)
              .trim()
              .replace(/^['"]|['"]$/g, "");
            break;
          }
        }
      } catch {
        // Unreadable file: still offer the command by name rather than
        // dropping it from the dropdown entirely.
      }
      rows.push({ name, description, source: "nexus-hub" });
    }),
  );
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
