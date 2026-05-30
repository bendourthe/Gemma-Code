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
import { renderSkillLine, renderSkillBlock, descriptionOf } from "./SkillRenderLine.js";
import type { Skill, SkillCatalog, SkillProvenance } from "./SkillCatalog.js";

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
  /** Window (months) for the Unused report. Accepted now; Phase 4 (T013) wires it. */
  months?: number;
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

export interface SkillAuditReport {
  budget: SkillBudgetReport;
  descriptions: SkillDescriptionCandidate[];
  duplicates: {
    byName: SkillNameDuplicate[];
    bySimilarity: Array<{ a: string; b: string; score: number }>;
  };
  unused: Array<{ id: string; lastSeen: string | null; confidence: "low" | "medium" | "high" }>;
  roots: SkillRootSummary[];
}

const DEFAULT_BUDGET_PERCENT = 2;
const DEFAULT_MAX_DESCRIPTION_TOKENS = 50;
const MAX_DESCRIPTION_ROWS = 20;

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

  const records = catalog.list();
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

  return {
    budget: { contextTokens, budgetTokens, usedTokens, pressurePct },
    descriptions,
    duplicates: {
      byName,
      bySimilarity: [], // TODO(phase-4): populated by findSimilarPairs (T011 / T013).
    },
    unused: [], // TODO(phase-4): populated by scanUsage (T012 / T013).
    roots,
  };
}

/**
 * Render a `SkillAuditReport` as human-readable Markdown with the five section
 * headings in the canonical order. Kept here (rather than in the CLI) so the
 * format is testable from TypeScript without spawning a process.
 */
export function formatAuditReport(report: SkillAuditReport): string {
  const lines: string[] = [];

  lines.push("## Skill Budget");
  lines.push(`- Context window: ${report.budget.contextTokens} tokens`);
  lines.push(`- Budget envelope: ${report.budget.budgetTokens} tokens`);
  lines.push(`- Used: ${report.budget.usedTokens} tokens`);
  lines.push(`- Pressure: ${report.budget.pressurePct}%`);
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
  lines.push("_(populated by phase 4)_");
  lines.push("");

  lines.push("## Unused candidates");
  lines.push("_(populated by phase 4)_");
  lines.push("");

  lines.push("## Root summary");
  if (report.roots.length === 0) {
    lines.push("_no skill roots loaded_");
  } else {
    for (const r of report.roots) {
      lines.push(`- ${r.root} (${r.source}): ${r.skillCount} skills`);
    }
  }

  return lines.join("\n") + "\n";
}
