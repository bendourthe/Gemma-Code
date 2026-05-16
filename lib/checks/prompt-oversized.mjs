/**
 * Rule: prompt-oversized
 *
 * Warn when a prompt / skill markdown body exceeds the rough token budget
 * (default 800 tokens, chars/4 approximation). Override via
 * `GEMMA_CHECK_PROMPT_TOKEN_BUDGET=<int>` so CI environments can tighten or
 * loosen the threshold without code edits.
 *
 * Severity: warning. Markdown-only (`appliesTo` gate).
 */

import { finding } from "./helpers.mjs";

export const id = "prompt-oversized";
export const severity = "warning";

const DEFAULT_BUDGET = 800;

function readBudget() {
  const raw = process.env["GEMMA_CHECK_PROMPT_TOKEN_BUDGET"];
  if (!raw) return DEFAULT_BUDGET;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_BUDGET;
}

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
  if (/(^|\/)src\/chat\/prompts\//.test(normalized)) return true;
  if (/(^|\/)src\/skills\/catalog\/.+\/SKILL\.md$/.test(normalized)) return true;
  return false;
}
