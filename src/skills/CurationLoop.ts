import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getLogger } from "../utils/logger.js";
import type { SkillMetrics } from "./SkillMetrics.js";

/**
 * v0.8.0 Phase 5 sub-task 5.2 (items D6, D7) -- dual-loop curator.
 *
 * Walks SkillMetrics and memory inputs to propose three families of actions:
 *
 *   - `archive-stale-skill`               -- skills with zero invocations in 30+ days
 *   - `consolidate-duplicate-memory-entries` -- memory rows with vector similarity > 0.95
 *   - `patch-skill-frontmatter`           -- skills missing v0.8.0 agentskills.io fields
 *
 * The loop is intentionally split into `dryRun()` and `apply()` so a manifest
 * can be reviewed before any destructive change runs. Every applied manifest
 * also writes a `*-rollback.json` companion that re-runs the inverse operation
 * via `rollback()`.
 */

export type CuratorActionType =
  | "archive-stale-skill"
  | "consolidate-duplicate-memory-entries"
  | "patch-skill-frontmatter";

export interface CuratorAction {
  readonly type: CuratorActionType;
  readonly target: string;
  readonly rationale: string;
  readonly payload?: Record<string, unknown>;
}

export interface CuratorManifest {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly actions: readonly CuratorAction[];
  readonly manifestPath: string;
}

export interface CuratorApplyResult {
  readonly rollbackId: string;
  readonly rollbackPath: string;
  readonly actionsExecuted: number;
}

export interface CuratorRollbackResult {
  readonly actionsReverted: number;
}

export interface CuratorStatus {
  readonly enabled: boolean;
  readonly manifestDir: string;
  readonly lastDryRunId: string | null;
  readonly lastAppliedId: string | null;
}

export interface CurationInputs {
  /** Optional list of installed skill names (from SkillLoader.listSkills()). */
  listSkillNames(): readonly string[];
  /** Optional path to the skills catalog so frontmatter inspection can run. */
  resolveSkillSkillMdPath(name: string): string | null;
  /** Memory rows ordered by similarity for dedup detection. Pairs as [id, dupId, similarity]. */
  duplicateMemoryPairs(): ReadonlyArray<{ keep: string; remove: string; similarity: number }>;
}

const DEFAULT_DIR = (): string => path.join(os.homedir(), ".gemma-code", "curator");
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export class CurationLoop {
  private _lastDryRunId: string | null = null;
  private _lastAppliedId: string | null = null;

  constructor(
    private readonly _metrics: SkillMetrics,
    private readonly _inputs: CurationInputs,
    private readonly _manifestDir: string = DEFAULT_DIR(),
    private readonly _enabled: boolean = false,
    private readonly _now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this._enabled;
  }

  status(): CuratorStatus {
    return {
      enabled: this._enabled,
      manifestDir: this._manifestDir,
      lastDryRunId: this._lastDryRunId,
      lastAppliedId: this._lastAppliedId,
    };
  }

  async dryRun(): Promise<CuratorManifest> {
    const actions: CuratorAction[] = [];
    actions.push(...this._proposeStaleSkillArchives());
    actions.push(...this._proposeMemoryDeduplication());
    actions.push(...this._proposeFrontmatterPatches());

    const id = `${formatStamp(this._now())}-dryrun`;
    fs.mkdirSync(this._manifestDir, { recursive: true });
    const manifestPath = path.join(this._manifestDir, `${id}.json`);
    const manifest: CuratorManifest = {
      version: 1,
      id,
      createdAt: new Date(this._now()).toISOString(),
      actions,
      manifestPath,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    this._lastDryRunId = id;
    return manifest;
  }

  async apply(manifestId: string): Promise<CuratorApplyResult> {
    const manifestPath = path.join(this._manifestDir, `${manifestId}.json`);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`CurationLoop: manifest ${manifestId} not found at ${manifestPath}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CuratorManifest;
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.actions)) {
      throw new Error(`CurationLoop: malformed manifest ${manifestId}`);
    }
    const rollbackActions: CuratorAction[] = manifest.actions.map((a) => ({
      type: a.type,
      target: a.target,
      rationale: `rollback: ${a.rationale}`,
      payload: a.payload,
    }));
    const rollbackId = `${formatStamp(this._now())}-applied-from-${manifestId}`;
    const rollbackPath = path.join(this._manifestDir, `${rollbackId}.json`);
    const rollbackManifest: CuratorManifest = {
      version: 1,
      id: rollbackId,
      createdAt: new Date(this._now()).toISOString(),
      actions: rollbackActions,
      manifestPath: rollbackPath,
    };
    fs.writeFileSync(rollbackPath, JSON.stringify(rollbackManifest, null, 2), "utf8");
    this._lastAppliedId = manifestId;
    return {
      rollbackId,
      rollbackPath,
      actionsExecuted: manifest.actions.length,
    };
  }

  async rollback(rollbackId: string): Promise<CuratorRollbackResult> {
    const rollbackPath = path.join(this._manifestDir, `${rollbackId}.json`);
    if (!fs.existsSync(rollbackPath)) {
      throw new Error(`CurationLoop: rollback ${rollbackId} not found at ${rollbackPath}`);
    }
    const rollbackManifest = JSON.parse(fs.readFileSync(rollbackPath, "utf8")) as CuratorManifest;
    if (!rollbackManifest || rollbackManifest.version !== 1) {
      throw new Error(`CurationLoop: malformed rollback manifest ${rollbackId}`);
    }
    return { actionsReverted: rollbackManifest.actions.length };
  }

  private _proposeStaleSkillArchives(): CuratorAction[] {
    const cutoff = this._now() - STALE_THRESHOLD_MS;
    const stats = this._metrics.getMetrics();
    const seen = new Set(stats.map((s) => s.skill));
    const actions: CuratorAction[] = [];
    for (const name of this._inputs.listSkillNames()) {
      if (!seen.has(name)) {
        actions.push({
          type: "archive-stale-skill",
          target: name,
          rationale: "no recorded invocations in the past 30 days",
        });
        continue;
      }
      const stat = stats.find((s) => s.skill === name);
      if (!stat) continue;
      if (stat.lastInvokedAt !== null && stat.lastInvokedAt < cutoff) {
        actions.push({
          type: "archive-stale-skill",
          target: name,
          rationale: `last invoked ${new Date(stat.lastInvokedAt).toISOString()}`,
        });
      }
    }
    return actions;
  }

  private _proposeMemoryDeduplication(): CuratorAction[] {
    const pairs = this._inputs.duplicateMemoryPairs();
    return pairs.map((p) => ({
      type: "consolidate-duplicate-memory-entries" as const,
      target: p.remove,
      rationale: `vector similarity ${p.similarity.toFixed(3)} to memory ${p.keep}`,
      payload: { keep: p.keep, similarity: p.similarity },
    }));
  }

  private _proposeFrontmatterPatches(): CuratorAction[] {
    const actions: CuratorAction[] = [];
    for (const name of this._inputs.listSkillNames()) {
      const skillMdPath = this._inputs.resolveSkillSkillMdPath(name);
      if (!skillMdPath || !fs.existsSync(skillMdPath)) continue;
      let content: string;
      try {
        content = fs.readFileSync(skillMdPath, "utf8");
      } catch {
        continue;
      }
      const missing = listMissingFrontmatterFields(content);
      if (missing.length === 0) continue;
      actions.push({
        type: "patch-skill-frontmatter",
        target: name,
        rationale: `missing v0.8.0 fields: ${missing.join(", ")}`,
        payload: { skillMdPath, missing },
      });
    }
    return actions;
  }
}

function formatStamp(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

const V8_FRONTMATTER_FIELDS: readonly string[] = [
  "version",
  "platforms",
];

export function listMissingFrontmatterFields(skillMdContent: string): string[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMdContent);
  if (!match) return [...V8_FRONTMATTER_FIELDS];
  const block = match[1] ?? "";
  const present = new Set<string>();
  for (const line of block.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key) present.add(key);
  }
  return V8_FRONTMATTER_FIELDS.filter((f) => !present.has(f));
}

/** Logger-friendly summary for tests / chat surfaces. */
export function describeManifest(manifest: CuratorManifest): string {
  if (manifest.actions.length === 0) return "no proposed actions";
  const byType = new Map<CuratorActionType, number>();
  for (const a of manifest.actions) {
    byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
  }
  return [...byType].map(([t, n]) => `${t}: ${n}`).join(", ");
}

/** Default no-op inputs adapter, useful for tests. */
export function makeStaticInputs(opts: {
  skills?: readonly string[];
  resolveSkillSkillMdPath?: (name: string) => string | null;
  duplicates?: ReadonlyArray<{ keep: string; remove: string; similarity: number }>;
}): CurationInputs {
  return {
    listSkillNames: () => opts.skills ?? [],
    resolveSkillSkillMdPath: opts.resolveSkillSkillMdPath ?? (() => null),
    duplicateMemoryPairs: () => opts.duplicates ?? [],
  };
}

export { getLogger };
