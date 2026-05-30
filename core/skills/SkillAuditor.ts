/**
 * v1.3.0 Phase 3 (adoption-skill-cleaner T008) -- skills audit composition.
 *
 * Composes the four Phase-2 foundational utilities -- `tokenize`
 * (`core/observability/TokenCost.ts`), `getActiveContextWindow`
 * (`core/registry/ModelRegistry.ts`), `renderSkillLine` / `renderSkillBlock`
 * (`core/skills/SkillRenderLine.ts`), and the existing `SkillCatalog` realpath
 * dedup -- into the five-report shape from insight I-01 of
 * `docs/versions/v1/v1.3.0/comparison-skill-cleaner.md`.
 *
 * Phase 3 populates four of the five reports: Budget (I-05), Description
 * candidates (I-06 ranking; the render fallback ladder is Phase 5 / T015),
 * name-Duplicates (driven by `SkillRecord.diverged`), and the Root summary
 * (grouped by `SkillProvenance.source`, precedence per I-09). The
 * `duplicates.bySimilarity` and `unused` sections are intentionally left empty
 * here and wired by Phase 4 (T011 / T012 / T013).
 *
 * The catalog and model registry are injected so the auditor is pure
 * composition: unit tests pass an in-memory fixture catalog, and the
 * `bin/nexus.mjs skills audit` CLI (T009) passes the live on-disk catalog.
 */

import { tokenize } from "../observability/TokenCost.js";
import { DEFAULT_CONTEXT_WINDOW, type ModelRegistry } from "../registry/ModelRegistry.js";
import {
  renderSkillLine,
  renderSkillBlock,
  renderSkillBlockWithinBudget,
  descriptionOf,
  type RenderRung,
} from "./SkillRenderLine.js";
import type { Skill, SkillCatalog, SkillProvenance } from "./SkillCatalog.js";
import { findSimilarPairs, type SimilarPair } from "./SkillSimilarity.js";
import { scanUsage, type SkillUsage } from "./SkillUsageScanner.js";

export interface SkillAuditOptions {
  /**
   * The catalog to audit. Required: the auditor never reads the filesystem
   * itself -- callers (the CLI / tests) build the catalog and inject it so the
   * auditor stays pure and unit-testable.
   */
  catalog: SkillCatalog;
  /**
   * Optional active-model registry used to derive the default budget envelope.
   * When omitted, `contextTokens` falls back to `DEFAULT_CONTEXT_WINDOW`.
   */
  modelRegistry?: ModelRegistry;
  /** Override `ModelRegistry.getActiveContextWindow()`. */
  contextTokens?: number;
  /** Budget envelope as a percentage of the context window. Default 2. */
  budgetPercent?: number;
  /** A skill's rendered line above this token count becomes a Descriptions candidate. Default 50. */
  maxDescriptionTokens?: number;
  /** Window (months) for the Unused report. Drives both the usage scan and the confidence label. Default 3. */
  months?: number;
  /**
   * v1.3.0 Phase 4 (T013, insight I-08) -- Jaccard threshold for the
   * content-similarity duplicate detector. Default 0.85.
   */
  similarityThreshold?: number;
  /**
   * v1.3.0 Phase 4 (T013, insight I-10) -- skill-universe root for the Unused
   * report. When set (and no pre-scanned `usage` Map is injected), the auditor
   * calls `scanUsage` over the session logs to find never-invoked skills. When
   * omitted, the Unused report stays empty.
   */
  skillsRoot?: string;
  /** Session-log root for the usage scan. Defaults to `~/.nexus/sessions/` inside `scanUsage`. */
  sessionsRoot?: string;
  /**
   * v1.3.0 Phase 4 (T013) -- pre-scanned usage Map injection seam. When
   * supplied, it is used directly and the disk scan is skipped (the CLI and
   * unit tests use this to avoid re-walking the filesystem). Takes precedence
   * over `skillsRoot`.
   */
  usage?: ReadonlyMap<string, SkillUsage>;
  /**
   * v1.3.0 Phase 6 (T018, P3 `--deep-logs`) -- forwarded to `scanUsage` so the
   * Unused report also reflects archived and gzip-compressed session logs. Only
   * consulted when the auditor performs its own scan (no injected `usage` Map).
   */
  deepLogs?: boolean;
  /**
   * v1.3.0 Phase 6 (T018, P3 `--by-root`) -- when set, every report section is
   * restricted to skills whose `SkillProvenance.source` equals this value, and
   * the Root summary degenerates to (and is suppressed in favour of) a
   * `Filtered to root: <name>` report header. When omitted, all roots audit.
   */
  byRoot?: SkillProvenance["source"];
}

export interface SkillBudgetReport {
  /** Active model context window, in tokens. */
  contextTokens: number;
  /** `floor(contextTokens * budgetPercent / 100)`. */
  budgetTokens: number;
  /** Tokens the full rendered skill block would consume. */
  usedTokens: number;
  /** `(usedTokens / budgetTokens) * 100`, rounded to two decimals (0 when the budget is 0). */
  pressurePct: number;
  /**
   * v1.3.0 Phase 5 (T015) -- which fallback-ladder rung the full catalog would
   * land on if rendered at the current budget (`full` / `truncated` / `omitted`).
   * Diagnostic only: the live agent-loop render path is unchanged in v1.3.0.
   */
  renderRung: RenderRung;
  /** v1.3.0 Phase 5 (T015) -- skills that would be omitted (non-zero only when `renderRung` is `omitted`). */
  renderOmittedCount: number;
}

export interface SkillDescriptionCandidate {
  id: string;
  lineTokens: number;
  description: string;
}

export interface SkillNameDuplicate {
  name: string;
  sources: string[];
}

export interface SkillRootSummary {
  root: string;
  source: SkillProvenance["source"];
  skillCount: number;
}

export type UnusedConfidence = "low" | "medium" | "high";

export interface SkillUnusedCandidate {
  id: string;
  lastSeen: string | null;
  confidence: UnusedConfidence;
}

export interface SkillAuditReport {
  budget: SkillBudgetReport;
  descriptions: SkillDescriptionCandidate[];
  duplicates: {
    byName: SkillNameDuplicate[];
    bySimilarity: SimilarPair[];
  };
  unused: SkillUnusedCandidate[];
  roots: SkillRootSummary[];
  /**
   * v1.3.0 Phase 6 (T018) -- set to the source name when the audit was scoped
   * with `--by-root`; null/absent for a full-catalog audit. Drives the
   * `Filtered to root:` header and the Root-summary suppression in
   * `formatAuditReport`.
   */
  filteredToRoot?: SkillProvenance["source"];
}

const DEFAULT_BUDGET_PERCENT = 2;
const DEFAULT_MAX_DESCRIPTION_TOKENS = 50;
const MAX_DESCRIPTION_ROWS = 20;
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_MONTHS = 3;

/**
 * Mandatory "suggest first" framing (insight I-12) surfaced with the Unused
 * report. The usage scan is heuristic -- a skill may have been invoked in a way
 * the scanner cannot see -- so the audit presents candidates, never verdicts.
 */
export const UNUSED_FRAMING =
  "Heuristic: these skills have no recent invocation evidence. " +
  "Review before deleting -- false negatives are possible (insight I-12).";

/**
 * Confidence that a zero-evidence skill is genuinely unused. Longer look-back
 * windows mean stronger evidence: a skill unseen across 12 months is a more
 * confident candidate than one unseen across 3.
 */
function unusedConfidence(months: number): UnusedConfidence {
  if (months >= 12) return "high";
  if (months >= 6) return "medium";
  return "low";
}

/** Round to two decimals without trailing float noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Longest common directory prefix of a set of absolute paths, normalised to
 * forward slashes. Used to label each Root summary row with a representative
 * directory rather than a per-skill file path. Falls back to the first path's
 * parent (or the source label) when no common prefix exists.
 */
function commonDir(paths: readonly string[], fallback: string): string {
  if (paths.length === 0) return fallback;
  const split = paths.map((p) => p.replace(/\\/g, "/").split("/"));
  const first = split[0]!;
  let prefixLen = first.length - 1; // drop the SKILL.md filename segment
  for (const segments of split) {
    prefixLen = Math.min(prefixLen, segments.length - 1);
    for (let i = 0; i < prefixLen; i += 1) {
      if (segments[i] !== first[i]) {
        prefixLen = i;
        break;
      }
    }
  }
  const prefix = first.slice(0, prefixLen).join("/");
  return prefix.length > 0 ? prefix : fallback;
}

/**
 * Audit the injected skill catalog and produce the five-report shape.
 *
 * Phase 3 fills Budget, Description candidates, name-Duplicates, and the Root
 * summary; `duplicates.bySimilarity` and `unused` are returned empty and wired
 * by Phase 4 (T013).
 */
export async function auditSkills(opts: SkillAuditOptions): Promise<SkillAuditReport> {
  const { catalog } = opts;
  if (!catalog) {
    throw new Error("auditSkills: a catalog is required (inject one via opts.catalog).");
  }

  // v1.3.0 Phase 6 (T018): `--by-root` scopes every section to one source. The
  // filter is applied up front so budget math, descriptions, duplicates, and
  // the root roll-up all derive from the restricted record set.
  const byRoot = opts.byRoot;
  const records = byRoot
    ? catalog.list().filter((r) => r.provenance.source === byRoot)
    : catalog.list();
  // Load the full Skill (with frontmatter) for every record so the rendered
  // lines carry the actual descriptions the model would see.
  const skills: Skill[] = await Promise.all(records.map((r) => catalog.load(r.id)));

  // --- Budget (insight I-05) ---
  const contextTokens =
    opts.contextTokens ??
    (opts.modelRegistry ? opts.modelRegistry.getActiveContextWindow() : DEFAULT_CONTEXT_WINDOW);
  const budgetPercent = opts.budgetPercent ?? DEFAULT_BUDGET_PERCENT;
  const budgetTokens = Math.floor(contextTokens * (budgetPercent / 100));
  const usedTokens = tokenize(renderSkillBlock(skills));
  const pressurePct = budgetTokens > 0 ? round2((usedTokens / budgetTokens) * 100) : 0;
  // Phase 5 (T015): report which fallback rung the catalog would land on if
  // rendered against this budget. Diagnostic only -- the live render path is
  // untouched in v1.3.0.
  const { rung: renderRung, omittedCount: renderOmittedCount } = renderSkillBlockWithinBudget(
    skills,
    budgetTokens,
  );

  // --- Description candidates (insight I-06; ranking only -- fallback ladder is T015) ---
  const maxDescriptionTokens = opts.maxDescriptionTokens ?? DEFAULT_MAX_DESCRIPTION_TOKENS;
  const descriptions: SkillDescriptionCandidate[] = skills
    .map((s) => ({
      id: s.id,
      lineTokens: tokenize(renderSkillLine(s)),
      description: descriptionOf(s),
    }))
    .filter((d) => d.lineTokens > maxDescriptionTokens)
    .sort((a, b) => b.lineTokens - a.lineTokens)
    .slice(0, MAX_DESCRIPTION_ROWS);

  // --- name-Duplicates (driven by SkillRecord.diverged + source enumeration) ---
  const dupByName = new Map<string, { name: string; sources: Set<string> }>();
  for (const r of records) {
    if (!r.diverged) continue;
    const key = r.displayName.toLowerCase().trim();
    const entry = dupByName.get(key) ?? { name: r.displayName, sources: new Set<string>() };
    entry.sources.add(r.provenance.source);
    dupByName.set(key, entry);
  }
  const byName: SkillNameDuplicate[] = Array.from(dupByName.values())
    .map((e) => ({ name: e.name, sources: Array.from(e.sources).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- Root summary (grouped by SkillProvenance.source; precedence per I-09) ---
  const bySource = new Map<SkillProvenance["source"], string[]>();
  for (const r of records) {
    const list = bySource.get(r.provenance.source) ?? [];
    list.push(r.path);
    bySource.set(r.provenance.source, list);
  }
  const sourceOrder: ReadonlyArray<SkillProvenance["source"]> = ["builtin", "user", "devai-hub"];
  const roots: SkillRootSummary[] = sourceOrder
    .filter((source) => bySource.has(source))
    .map((source) => {
      const paths = bySource.get(source)!;
      return { root: commonDir(paths, source), source, skillCount: paths.length };
    });

  // --- Content-similarity duplicates (insight I-08; T011) ---
  const similarityThreshold = opts.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const bySimilarity = findSimilarPairs(skills, similarityThreshold);

  // --- Unused candidates (insight I-10 + I-12 framing; T012) ---
  const months = opts.months ?? DEFAULT_MONTHS;
  const usage = await resolveUsage(opts, months);
  const confidence = unusedConfidence(months);
  // When `--by-root` is active, the usage Map may still carry skills from other
  // sources (the scan walks a directory, not a source); restrict the Unused
  // report to ids that belong to the filtered record set so it stays scoped.
  const allowedUnusedKeys = byRoot ? unusedKeysFor(records, skills) : null;
  const unused: SkillUnusedCandidate[] = [];
  for (const [id, evidence] of usage) {
    if (evidence.matchCount !== 0) continue;
    if (allowedUnusedKeys && !allowedUnusedKeys.has(id)) continue;
    unused.push({
      id,
      lastSeen: evidence.lastSeen ? evidence.lastSeen.toISOString() : null,
      confidence,
    });
  }
  unused.sort((a, b) => a.id.localeCompare(b.id));

  const report: SkillAuditReport = {
    budget: { contextTokens, budgetTokens, usedTokens, pressurePct, renderRung, renderOmittedCount },
    descriptions,
    duplicates: { byName, bySimilarity },
    unused,
    roots,
  };
  if (byRoot) report.filteredToRoot = byRoot;
  return report;
}

/**
 * The set of identifiers that count as "belonging" to the filtered record set
 * for the Unused report. The usage scanner keys by a skill's frontmatter `name`
 * (its display name), while catalog records also carry a canonical `id`; we
 * accept either so the scope holds regardless of which id the scan recorded.
 */
function unusedKeysFor(
  records: ReturnType<SkillCatalog["list"]>,
  skills: readonly Skill[],
): Set<string> {
  const keys = new Set<string>();
  for (const r of records) {
    keys.add(r.id);
    keys.add(r.displayName);
  }
  for (const s of skills) {
    keys.add(s.id);
    const name = s.frontmatter?.name;
    if (typeof name === "string" && name) keys.add(name);
  }
  return keys;
}

/**
 * Resolve the usage evidence map: prefer an injected `usage` Map (the CLI and
 * unit tests supply this); otherwise scan the session logs when a `skillsRoot`
 * is configured; otherwise return an empty map (Unused report stays empty).
 */
async function resolveUsage(
  opts: SkillAuditOptions,
  months: number,
): Promise<ReadonlyMap<string, SkillUsage>> {
  if (opts.usage) return opts.usage;
  if (opts.skillsRoot) {
    return scanUsage({
      skillsRoot: opts.skillsRoot,
      sessionsRoot: opts.sessionsRoot,
      months,
      deepLogs: opts.deepLogs,
    });
  }
  return new Map<string, SkillUsage>();
}

/**
 * Render a `SkillAuditReport` as human-readable Markdown with the five section
 * headings in the canonical order. Kept here (rather than in the CLI) so the
 * format is testable from TypeScript without spawning a process.
 */
export function formatAuditReport(report: SkillAuditReport): string {
  const lines: string[] = [];

  // v1.3.0 Phase 6 (T018): a `--by-root` audit prints a scoping header and omits
  // the Root summary (which would degenerate to a single row).
  if (report.filteredToRoot) {
    lines.push(`Filtered to root: ${report.filteredToRoot}`);
    lines.push("");
  }

  lines.push("## Skill Budget");
  lines.push(`- Context window: ${report.budget.contextTokens} tokens`);
  lines.push(`- Budget envelope: ${report.budget.budgetTokens} tokens`);
  lines.push(`- Used: ${report.budget.usedTokens} tokens`);
  lines.push(`- Pressure: ${report.budget.pressurePct}%`);
  lines.push(
    `- Render rung: ${report.budget.renderRung} (would drop ${report.budget.renderOmittedCount} skills if rendered now)`,
  );
  lines.push("");

  lines.push("## Description candidates");
  if (report.descriptions.length === 0) {
    lines.push("_No skill lines exceed the description-token threshold._");
  } else {
    for (const d of report.descriptions) {
      lines.push(`- ${d.id} (${d.lineTokens} tokens): ${d.description}`);
    }
  }
  lines.push("");

  lines.push("## Duplicates");
  lines.push("### By name");
  if (report.duplicates.byName.length === 0) {
    lines.push("_none found_");
  } else {
    for (const d of report.duplicates.byName) {
      lines.push(`- ${d.name} (sources: ${d.sources.join(", ")})`);
    }
  }
  lines.push("### By similarity");
  if (report.duplicates.bySimilarity.length === 0) {
    lines.push("_no near-duplicates above threshold_");
  } else {
    for (const p of report.duplicates.bySimilarity) {
      lines.push(`- ${p.a} <-> ${p.b} (Jaccard ${round2(p.score)})`);
    }
  }
  lines.push("");

  lines.push("## Unused candidates");
  lines.push(`_${UNUSED_FRAMING}_`);
  if (report.unused.length === 0) {
    lines.push("_none found_");
  } else {
    for (const u of report.unused) {
      const seen = u.lastSeen ?? "never";
      lines.push(`- ${u.id} (confidence: ${u.confidence}, last seen: ${seen})`);
    }
  }
  lines.push("");

  // Root summary is suppressed under `--by-root` (the header above names the scope).
  if (!report.filteredToRoot) {
    lines.push("## Root summary");
    if (report.roots.length === 0) {
      lines.push("_no skill roots loaded_");
    } else {
      for (const r of report.roots) {
        lines.push(`- ${r.root} (${r.source}): ${r.skillCount} skills`);
      }
    }
  }

  return lines.join("\n") + "\n";
}
