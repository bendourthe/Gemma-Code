import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getLogger } from "../utils/logger.js";

export type SkillPlatform = "linux" | "macos" | "windows";

export const DEFAULT_SKILL_PLATFORMS: readonly SkillPlatform[] = [
  "linux",
  "macos",
  "windows",
];

export const DEFAULT_SKILL_VERSION = "1.0.0";

/**
 * v0.8.0 Phase 2 (item D1) -- agentskills.io-aligned metadata. The fields
 * are forward-compatible: pre-v0.8.0 SKILL.md files default to a single
 * version of `1.0.0`, all three platforms, and empty tag / related lists.
 */
export interface SkillMetadata {
  tags: readonly string[];
  relatedSkills: readonly string[];
}

export interface Skill {
  name: string;
  description: string;
  argumentHint: string;
  /** Semver. Defaults to `1.0.0` when the file omits the field. */
  version: string;
  /** Defaults to all three platforms when the file omits the field. */
  platforms: readonly SkillPlatform[];
  metadata: SkillMetadata;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a SKILL.md file with YAML frontmatter. The v0.7.0 fields
 * (`name`, `description`, `argument-hint`) are preserved as-is; v0.8.0
 * adds `version`, `platforms`, `metadata.tags`, `metadata.related_skills`.
 *
 * The parser stays intentionally small (no full YAML dependency): it
 * supports flow-style arrays (`platforms: [linux, macos]`) and nested
 * `metadata.tags` / `metadata.related_skills` keys via dotted access in
 * the raw map. That mirrors the surface the `package-skills.mjs` adapter
 * already consumes.
 *
 * Example frontmatter:
 *   ---
 *   name: commit
 *   description: Generate a commit message
 *   argument-hint: "[message]"
 *   version: 1.2.0
 *   platforms: [linux, macos, windows]
 *   metadata.tags: [git, workflow]
 *   metadata.related_skills: [polish]
 *   ---
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return null;

  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) meta[key] = value;
  }

  return { meta, body: (match[2] ?? "").trim() };
}

/**
 * Parse a flow-style YAML array (`[a, b, c]`) or comma-separated string.
 * Returns an empty array when the input is empty / undefined. Items are
 * trimmed and stripped of surrounding quotes.
 */
function parseFlowArray(raw: string | undefined): string[] {
  if (!raw) return [];
  let inner = raw.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  return inner
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length > 0);
}

function parsePlatforms(raw: string | undefined): SkillPlatform[] {
  const values = parseFlowArray(raw);
  if (values.length === 0) return [...DEFAULT_SKILL_PLATFORMS];
  const allowed = new Set<SkillPlatform>(["linux", "macos", "windows"]);
  const filtered = values.filter((v): v is SkillPlatform => allowed.has(v as SkillPlatform));
  // Treat an all-unknown list as a parse failure and fall back to the
  // default so a typo cannot silently disable the skill everywhere.
  return filtered.length > 0 ? filtered : [...DEFAULT_SKILL_PLATFORMS];
}

function loadSkillFromDir(skillDir: string): Skill | null {
  const skillMdPath = path.join(skillDir, "SKILL.md");

  let content: string;
  try {
    content = fs.readFileSync(skillMdPath, "utf-8");
  } catch {
    return null; // directory exists but no SKILL.md
  }

  const parsed = parseFrontmatter(content);
  if (!parsed) {
    getLogger().warn(`[SkillLoader] ${skillMdPath}: missing or malformed frontmatter — skipping`);
    return null;
  }

  const { meta, body } = parsed;

  if (!meta["name"] || !meta["description"]) {
    getLogger().warn(`[SkillLoader] ${skillMdPath}: missing required fields 'name' or 'description' — skipping`);
    return null;
  }

  return {
    name: meta["name"],
    description: meta["description"],
    argumentHint: meta["argument-hint"] ?? "",
    version: meta["version"] || DEFAULT_SKILL_VERSION,
    platforms: parsePlatforms(meta["platforms"]),
    metadata: {
      tags: parseFlowArray(meta["metadata.tags"]),
      relatedSkills: parseFlowArray(meta["metadata.related_skills"]),
    },
    prompt: body,
  };
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

export class SkillLoader {
  private readonly _skills = new Map<string, Skill>();
  private _watcher: fs.FSWatcher | null = null;

  /**
   * @param catalogDir   Absolute path to the bundled built-in skill catalog.
   * @param userSkillsDir Absolute path to the user's custom skill directory.
   *                      Defaults to ~/.nexus/skills/
   */
  constructor(
    private readonly _catalogDir: string,
    private readonly _userSkillsDir: string = path.join(os.homedir(), ".nexus", "skills")
  ) {}

  /**
   * Load all skills from the catalog and user directories.
   * User skills with the same name override built-in ones.
   */
  load(): void {
    this._loadFromDir(this._catalogDir);
    this._ensureUserDir();
    this._loadFromDir(this._userSkillsDir);
  }

  /**
   * Watch the user skills directory for changes and hot-reload on any modification.
   */
  watch(): void {
    if (!fs.existsSync(this._userSkillsDir)) return;

    try {
      this._watcher = fs.watch(this._userSkillsDir, { recursive: true }, () => {
        this._reloadUserSkills();
      });
    } catch {
      // Non-fatal — hot-reload won't work but catalog skills remain available.
    }
  }

  stopWatching(): void {
    this._watcher?.close();
    this._watcher = null;
  }

  getSkill(name: string): Skill | undefined {
    return this._skills.get(name);
  }

  listSkills(): Skill[] {
    return [...this._skills.values()];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _ensureUserDir(): void {
    try {
      if (!fs.existsSync(this._userSkillsDir)) {
        fs.mkdirSync(this._userSkillsDir, { recursive: true });
      }
    } catch {
      // Non-fatal.
    }
  }

  private _loadFromDir(dir: string): void {
    if (!fs.existsSync(dir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      getLogger().warn(`[SkillLoader] Cannot read directory ${dir}: ${String(err)}`);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = loadSkillFromDir(path.join(dir, entry.name));
      if (skill) {
        this._skills.set(skill.name, skill);
      }
    }
  }

  private _reloadUserSkills(): void {
    // Remove any previously loaded user skills (those not present in the catalog).
    const catalogNames = new Set<string>();
    if (fs.existsSync(this._catalogDir)) {
      try {
        for (const entry of fs.readdirSync(this._catalogDir, { withFileTypes: true })) {
          if (entry.isDirectory()) catalogNames.add(entry.name);
        }
      } catch {
        // ignore
      }
    }

    for (const name of this._skills.keys()) {
      if (!catalogNames.has(name)) {
        this._skills.delete(name);
      }
    }

    this._loadFromDir(this._userSkillsDir);
  }
}
