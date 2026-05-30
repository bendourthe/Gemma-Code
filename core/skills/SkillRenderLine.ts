/**
 * v1.3.0 Phase 2 (adoption-skill-cleaner T005) -- canonical skill render formatter.
 *
 * Implements insight I-02 from
 * `docs/versions/v1/v1.3.0/comparison-skill-cleaner.md`: a single source of
 * truth for the `- name: description (file: path)` line shape that both the
 * agent loop and the future `SkillAuditor` (Phase 3) consume, so the auditor's
 * token math stays faithful to what the model actually sees.
 *
 * This module renders full lines only. The budget-driven fallback ladder
 * (full -> truncate -> omit) is Phase 5 (T015); it is intentionally absent here.
 */

import type { Skill, SkillRecord } from "./SkillCatalog.js";

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
 * Render a single skill as `- ${name}: ${description} (file: ${path})`.
 * `name` is the skill `id` (the catalog's canonical, namespaced identifier).
 * The result carries no trailing whitespace and no embedded newlines.
 */
export function renderSkillLine(skill: SkillRecord): string {
  return `- ${skill.id}: ${descriptionOf(skill)} (file: ${skill.path})`;
}

/** Render a block of skills, one canonical line each, joined with newlines. */
export function renderSkillBlock(skills: readonly SkillRecord[]): string {
  return skills.map(renderSkillLine).join("\n");
}
