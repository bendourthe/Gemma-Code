/**
 * Rule: prompt-oversized
 *
 * Warn when a prompt / skill markdown body exceeds the rough token budget
 * (default 800 tokens, chars/4 approximation). Override via
 * `NEXUS_CHECK_PROMPT_TOKEN_BUDGET=<int>` (canonical v1.0.0 name) or the
 * legacy `GEMMA_CHECK_PROMPT_TOKEN_BUDGET=<int>` (deprecated, removed in
 * v1.1.0). CI environments can tighten or loosen the threshold without
 * code edits.
 *
 * Severity: warning. Markdown-only (`appliesTo` gate).
 */

import { finding } from "./helpers.mjs";

export const id = "prompt-oversized";
export const severity = "warning";

const DEFAULT_BUDGET = 800;

function readBudget() {
  // v1.0.0 Phase 2.4: prefer the canonical NEXUS_* env var; fall back to the
  // legacy GEMMA_CHECK_* name with a one-time deprecation log per process.
  const nexus = process.env["NEXUS_CHECK_PROMPT_TOKEN_BUDGET"];
  if (nexus !== undefined) {
    const parsed = Number.parseInt(nexus, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return DEFAULT_BUDGET;
  }
  const legacy = process.env["GEMMA_CHECK_PROMPT_TOKEN_BUDGET"];
  if (legacy !== undefined) {
    if (!warnedLegacyEnv) {
      warnedLegacyEnv = true;
      // eslint-disable-next-line no-console -- one-line deprecation log
      console.warn(
        "[nexus-check] Deprecated env var GEMMA_CHECK_PROMPT_TOKEN_BUDGET -- " +
          "migrate to NEXUS_CHECK_PROMPT_TOKEN_BUDGET. Removed in v1.1.0.",
      );
    }
    const parsed = Number.parseInt(legacy, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_BUDGET;
}

let warnedLegacyEnv = false;

export function appliesTo(filePath) {
  return isPromptOrSkillMarkdown(filePath);
}

export function scan(filePath, contents) {
  if (!isPromptOrSkillMarkdown(filePath)) return [];
  const budget = readBudget();
  const approxTokens = Math.ceil(contents.length / 4);
  if (approxTokens <= budget) return [];
  return [
    finding({
      ruleId: id,
      severity,
      filePath,
      line: 1,
      column: 1,
      message: `prompt body is ~${approxTokens} tokens; exceeds budget of ${budget}. Trim or split.`,
    }),
  ];
}

function isPromptOrSkillMarkdown(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!/\.md$/i.test(normalized)) return false;
  if (/(^|\/)modules\/coding\/chat\/prompts\//.test(normalized)) return true;
  if (/(^|\/)modules\/coding\/skills\/catalog\/.+\/SKILL\.md$/.test(normalized)) return true;
  return false;
}
