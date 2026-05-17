/**
 * v1.0.0 Phase 2.6 -- SkillCatalog stub.
 *
 * Cross-module surface for listing, loading, and hot-reloading skills.
 * Phase 10 (`nexus skills sync`) wires DevAI-Hub sparse-clone results into
 * this catalog under `~/.nexus/skills/devai-hub/<tag>/`.
 *
 * The Coding module already has its own `SkillLoader` under
 * `src/skills/`; that loader will be wrapped by an adapter that fulfils
 * this interface (tracked in v1.0.0 known-gaps under code `MV`).
 */

export interface SkillRecord {
  /** Skill id, namespaced when sourced from DevAI-Hub: `devai-hub/<name>`. */
  id: string;
  displayName: string;
  category?: string;
  /** Absolute path to the SKILL.md or directory root. */
  path: string;
  /** Soft tags surfaced to the UI (`recommended`, `research`, etc.). */
  tags?: readonly string[];
  /** Loaded into the active session? Phase 10 sets this when a skill is hot-reloaded. */
  active?: boolean;
}

export interface Skill extends SkillRecord {
  /** Raw SKILL.md frontmatter as a parsed object. */
  frontmatter: Readonly<Record<string, unknown>>;
  /** Markdown body of the SKILL.md. */
  body: string;
}

export interface SkillCatalog {
  list(): readonly SkillRecord[];
  load(id: string): Promise<Skill>;
  reload(): Promise<void>;
}

export class InMemorySkillCatalog implements SkillCatalog {
  private _records: Map<string, Skill>;

  constructor(initial: readonly Skill[] = []) {
    this._records = new Map(initial.map((skill) => [skill.id, skill]));
  }

  list(): readonly SkillRecord[] {
    return Array.from(this._records.values()).map(({ id, displayName, category, path, tags, active }) => ({
      id,
      displayName,
      category,
      path,
      tags,
      active,
    }));
  }

  async load(id: string): Promise<Skill> {
    const record = this._records.get(id);
    if (!record) {
      throw new Error(`SkillCatalog: unknown skill id ${id}`);
    }
    return record;
  }

  async reload(): Promise<void> {
    // The in-memory catalog has nothing to refresh; subclasses that read
    // SKILL.md files override this to rescan the filesystem.
  }

  /** Test-only: inject a fresh set of skills (used by Phase 2.6 tests). */
  resetForTesting(skills: readonly Skill[]): void {
    this._records = new Map(skills.map((s) => [s.id, s]));
  }
}
