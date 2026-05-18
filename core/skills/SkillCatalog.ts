/**
 * v1.0.0 Phase 2.6 -- SkillCatalog stub.
 * v1.0.0 Phase 10 -- Namespacing + provenance for DevAI-Hub sync.
 *
 * Cross-module surface for listing, loading, and hot-reloading skills.
 * Phase 10 (`nexus skills sync`) wires DevAI-Hub sparse-clone results into
 * this catalog under `~/.nexus/skills/devai-hub/<tag>/`.
 *
 * The Coding module already has its own `SkillLoader` under
 * `src/skills/`; that loader will be wrapped by an adapter that fulfils
 * this interface (tracked in v1.0.0 known-gaps under code `MV`).
 */

/**
 * Provenance tag carried on every catalog record (Phase 10.1). Built-in
 * skills shipped with the binary report `source: "builtin"`; user-authored
 * files at `~/.nexus/skills/user/` report `source: "user"`; everything
 * pulled in via `nexus skills sync` reports `source: "devai-hub"` with the
 * pinned tag and content hash.
 */
export interface SkillProvenance {
  readonly source: "builtin" | "user" | "devai-hub";
  /** Pinned tag (e.g. `v1.3.2`) for devai-hub sourced skills. */
  readonly tag?: string;
  /** SHA-256 hex over the SKILL.md body (and any bundled scripts). */
  readonly contentHash: string;
}

export interface SkillRecord {
  /** Skill id. For non-builtin sources this is `<namespace>/<name>` (e.g. `devai-hub/code-quality`). */
  id: string;
  displayName: string;
  category?: string;
  /** Absolute path to the SKILL.md or directory root. */
  path: string;
  /** Soft tags surfaced to the UI (`recommended`, `research`, etc.). */
  tags?: readonly string[];
  /** Loaded into the active session? Phase 10 sets this when a skill is hot-reloaded. */
  active?: boolean;
  /** Provenance metadata (Phase 10.1). All records carry this. */
  provenance: SkillProvenance;
  /**
   * Set when the same display-name exists in another source. The Skills
   * settings UI renders a "diverged" badge so the user can pick a default
   * (Phase 10.6).
   */
  diverged?: boolean;
}

export interface Skill extends SkillRecord {
  /** Raw SKILL.md frontmatter as a parsed object. */
  frontmatter: Readonly<Record<string, unknown>>;
  /** Markdown body of the SKILL.md. */
  body: string;
}

/**
 * Resolved namespace for a skill id. Namespaces are inferred from the
 * provenance source so the catalog can address skills with stable IDs even
 * when two sources happen to share a display name.
 */
export type SkillNamespace = "builtin" | "user" | "devai-hub";

export function namespaceForSource(source: SkillProvenance["source"]): SkillNamespace {
  return source;
}

/**
 * Compute the canonical catalog id for a skill given its source and name.
 * Non-builtin sources are namespaced (`devai-hub/code-quality`); built-in
 * skills keep their unprefixed names for backwards compatibility with
 * existing slash-command resolution.
 */
export function canonicalSkillId(source: SkillProvenance["source"], name: string): string {
  if (source === "builtin") return name;
  return `${source}/${name}`;
}

export interface SkillCatalog {
  list(): readonly SkillRecord[];
  listByNamespace(ns: SkillNamespace): readonly SkillRecord[];
  load(id: string): Promise<Skill>;
  reload(): Promise<void>;
}

export class InMemorySkillCatalog implements SkillCatalog {
  private _records: Map<string, Skill>;
  /** Set of display names that appear in more than one source. */
  private _divergedNames: Set<string>;

  constructor(initial: readonly Skill[] = []) {
    this._records = new Map(initial.map((skill) => [skill.id, skill]));
    this._divergedNames = computeDivergedNames(initial);
  }

  list(): readonly SkillRecord[] {
    return Array.from(this._records.values()).map((skill) => this._toRecord(skill));
  }

  listByNamespace(ns: SkillNamespace): readonly SkillRecord[] {
    return this.list().filter((r) => namespaceForSource(r.provenance.source) === ns);
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

  /** Test-only: inject a fresh set of skills (used by Phase 2.6 + 10.1 tests). */
  resetForTesting(skills: readonly Skill[]): void {
    this._records = new Map(skills.map((s) => [s.id, s]));
    this._divergedNames = computeDivergedNames(skills);
  }

  private _toRecord(skill: Skill): SkillRecord {
    const baseName = displayKey(skill);
    const diverged = this._divergedNames.has(baseName);
    const record: SkillRecord = {
      id: skill.id,
      displayName: skill.displayName,
      category: skill.category,
      path: skill.path,
      tags: skill.tags,
      active: skill.active,
      provenance: skill.provenance,
    };
    if (diverged) record.diverged = true;
    return record;
  }
}

/**
 * Compute the set of normalized display names (case-insensitive) that
 * occur in more than one provenance source. Used to flag collisions
 * between a local user skill and a DevAI-Hub skill of the same name
 * (Phase 10.6).
 */
function computeDivergedNames(skills: readonly Skill[]): Set<string> {
  const byName = new Map<string, Set<SkillProvenance["source"]>>();
  for (const s of skills) {
    const key = displayKey(s);
    const set = byName.get(key) ?? new Set();
    set.add(s.provenance.source);
    byName.set(key, set);
  }
  const diverged = new Set<string>();
  for (const [name, sources] of byName.entries()) {
    if (sources.size > 1) diverged.add(name);
  }
  return diverged;
}

function displayKey(skill: SkillRecord): string {
  return skill.displayName.toLowerCase().trim();
}
