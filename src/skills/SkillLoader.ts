import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Skill {
  name: string;
  description: string;
  argumentHint: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a SKILL.md file with YAML frontmatter:
 *   ---
 *   name: commit
 *   description: Generate a commit message
 *   argument-hint: "[message]"
 *   ---
 *   Prompt body here.
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
    console.warn(`[SkillLoader] ${skillMdPath}: missing or malformed frontmatter — skipping`);
    return null;
  }

  const { meta, body } = parsed;

  if (!meta["name"] || !meta["description"]) {
    console.warn(`[SkillLoader] ${skillMdPath}: missing required fields 'name' or 'description' — skipping`);
    return null;
  }

  return {
    name: meta["name"],
    description: meta["description"],
    argumentHint: meta["argument-hint"] ?? "",
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
   *                      Defaults to ~/.gemma-code/skills/
   */
  constructor(
    private readonly _catalogDir: string,
    private readonly _userSkillsDir: string = path.join(os.homedir(), ".gemma-code", "skills")
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
      console.warn(`[SkillLoader] Cannot read directory ${dir}: ${String(err)}`);
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
