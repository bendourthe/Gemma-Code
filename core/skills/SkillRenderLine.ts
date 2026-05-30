/**
 * v1.3.0 Phase 2 (adoption-skill-cleaner T005) -- canonical skill render formatter.
 *
 * Implements insight I-02 from
 * `docs/versions/v1/v1.3.0/comparison-skill-cleaner.md`: a single source of
 * truth for the `- name: description (file: path)` line shape that both the
 * agent loop and the future `SkillAuditor` (Phase 3) consume, so the auditor's
 * token math stays faithful to what the model actually sees.
 *
 * v1.3.0 Phase 5 (adoption-skill-cleaner T015) adds the budget-driven fallback
 * ladder (`renderSkillBlockWithinBudget`): full descriptions -> equal truncation
 * -> priority-ordered omission, mirroring insight I-06. Only the `SkillAuditor`
 * consumes the ladder for now; wiring it into the live agent-loop render path is
 * deferred to a follow-up cycle to avoid a v1.3.0 behavior change.
 */

import { tokenize } from "../observability/TokenCost.js";
import type { Skill, SkillProvenance, SkillRecord } from "./SkillCatalog.js";

/**
 * Pull the skill's description from its parsed frontmatter, flattened to a
 * single line. `SkillRecord` has no description field, but callers commonly
 * pass full `Skill` instances (which extend `SkillRecord`); when a frontmatter
 * `description` is present it is used, otherwise the segment is empty.
 *
 * Any embedded newline is collapsed to a single space and trailing whitespace
 * is trimmed, matching the single-line description rule from the
 * `skill-description-authoring` skill landed in Phase 1.
 */
export function descriptionOf(skill: SkillRecord): string {
  const frontmatter = (skill as Partial<Skill>).frontmatter;
  const raw =
    frontmatter && typeof frontmatter.description === "string"
      ? frontmatter.description
      : "";
  return raw.replace(/\s*\r?\n\s*/g, " ").replace(/\s+$/, "");
}

/**
 * Format a single canonical line from explicit parts. Shared by `renderSkillLine`
 * (which sources the description from frontmatter) and the fallback ladder
 * (which substitutes a truncated or empty description). `id` and `path` are
 * never altered -- they are matching triggers and must stay intact (insight I-15).
 */
function formatLine(id: string, description: string, path: string): string {
  return `- ${id}: ${description} (file: ${path})`;
}

/**
 * Render a single skill as `- ${name}: ${description} (file: ${path})`.
 * `name` is the skill `id` (the catalog's canonical, namespaced identifier).
 * The result carries no trailing whitespace and no embedded newlines.
 */
export function renderSkillLine(skill: SkillRecord): string {
  return formatLine(skill.id, descriptionOf(skill), skill.path);
}

/** Render a block of skills, one canonical line each, joined with newlines. */
export function renderSkillBlock(skills: readonly SkillRecord[]): string {
  return skills.map(renderSkillLine).join("\n");
}

/**
 * Which rung of the fallback ladder a budgeted render landed on:
 *   - `full`      every description rendered in full (block fit the budget),
 *   - `truncated` every description equally truncated to fit,
 *   - `omitted`   lowest-priority skills dropped until the remainder fit at full.
 */
export type RenderRung = "full" | "truncated" | "omitted";

export interface BudgetedRender {
  /** The rendered block, guaranteed to tokenize within the budget. */
  lines: string;
  /** Skills dropped to make the block fit (non-zero only when `rung` is `omitted`). */
  omittedCount: number;
  rung: RenderRung;
}

/**
 * Keep-priority for a provenance source, per insight I-09: built-in skills are
 * the most authoritative and are dropped last; devai-hub skills are dropped
 * first. Higher number = kept longer.
 */
function sourceKeepPriority(source: SkillProvenance["source"]): number {
  switch (source) {
    case "builtin":
      return 2;
    case "user":
      return 1;
    case "devai-hub":
      return 0;
    default:
      return 0;
  }
}

/**
 * Truncate a description to at most `maxChars`, preferring a clean first-sentence
 * break. When the first `. ` sentence boundary falls within budget the
 * description is cut there (keeping the trigger-noun cluster that opens every
 * well-authored description intact); otherwise it is hard-truncated. Trailing
 * whitespace is stripped so the formatted line never ends in a space.
 */
function truncateDescription(description: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (description.length <= maxChars) return description;
  const firstStop = description.indexOf(". ");
  if (firstStop >= 0 && firstStop + 1 <= maxChars) {
    return description.slice(0, firstStop + 1);
  }
  return description.slice(0, maxChars).replace(/\s+$/, "");
}

/**
 * Render a skill block that fits within `budgetTokens`, degrading gracefully
 * down a three-rung ladder (insight I-06) instead of silently overflowing:
 *
 *   1. `full`      -- if the full block already fits, return it unchanged.
 *   2. `truncated` -- otherwise truncate every description equally to the
 *                     per-description token budget that the line overhead
 *                     (id + path + framing) leaves over, and return that if it
 *                     fits.
 *   3. `omitted`   -- otherwise drop the lowest-priority skills (devai-hub
 *                     before user before builtin, per insight I-09) one at a
 *                     time until the remainder fits at *full* description.
 *
 * `name` and `path` are never truncated -- only descriptions are shortened or
 * whole skills dropped (insight I-15). The omitted rung always converges: an
 * empty block tokenizes to 0, which fits any non-negative budget.
 */
export function renderSkillBlockWithinBudget(
  skills: readonly SkillRecord[],
  budgetTokens: number,
): BudgetedRender {
  // Rung 1: full descriptions.
  const full = renderSkillBlock(skills);
  if (tokenize(full) <= budgetTokens) {
    return { lines: full, omittedCount: 0, rung: "full" };
  }

  // Rung 2: equal truncation of every description.
  if (skills.length > 0) {
    const skeleton = skills.map((s) => formatLine(s.id, "", s.path)).join("\n");
    const descBudget = budgetTokens - tokenize(skeleton);
    if (descBudget > 0) {
      const perDescTokens = Math.floor(descBudget / skills.length);
      // tokenize() is ceil(utf8_bytes / 4); for ASCII descriptions this maps a
      // token budget back to roughly 4 characters per token. Any overflow from
      // multi-byte descriptions is caught by the re-check below, which drops to
      // the omitted rung rather than overshooting the budget.
      const perDescChars = perDescTokens * 4;
      const truncated = skills
        .map((s) => formatLine(s.id, truncateDescription(descriptionOf(s), perDescChars), s.path))
        .join("\n");
      if (tokenize(truncated) <= budgetTokens) {
        return { lines: truncated, omittedCount: 0, rung: "truncated" };
      }
    }
  }

  // Rung 3: drop lowest-priority skills until the remainder fits at full.
  const dropOrder = [...skills].sort(
    (a, b) => sourceKeepPriority(a.provenance.source) - sourceKeepPriority(b.provenance.source),
  );
  const dropped = new Set<SkillRecord>();
  for (const candidate of dropOrder) {
    const remaining = skills.filter((s) => !dropped.has(s));
    if (tokenize(renderSkillBlock(remaining)) <= budgetTokens) break;
    dropped.add(candidate);
  }
  const remaining = skills.filter((s) => !dropped.has(s));
  return { lines: renderSkillBlock(remaining), omittedCount: dropped.size, rung: "omitted" };
}
