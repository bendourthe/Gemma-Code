/**
 * Rule: prompt-trailing-whitespace
 *
 * Warn when a markdown line under `src/chat/prompts/` or
 * `src/skills/catalog/**\/SKILL.md` ends in whitespace before its newline.
 * Trailing spaces survive diff and obscure intent.
 *
 * Severity: warning. Markdown-only (`appliesTo` gate).
 */

import { finding, offsetToPosition } from "./helpers.mjs";

export const id = "prompt-trailing-whitespace";
export const severity = "warning";

export function appliesTo(filePath) {
  return isPromptOrSkillMarkdown(filePath);
}

export function scan(filePath, contents) {
  if (!isPromptOrSkillMarkdown(filePath)) return [];
  const findings = [];
  const re = /([ \t]+)(?=\r?\n)/g;
  let match;
  while ((match = re.exec(contents)) !== null) {
    const idx = match.index;
    const { line, column } = offsetToPosition(contents, idx);
    findings.push(
      finding({
        ruleId: id,
        severity,
        filePath,
        line,
        column,
        message: `trailing whitespace -- strip the spaces before the newline`,
      }),
    );
  }
  return findings;
}

function isPromptOrSkillMarkdown(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!/\.md$/i.test(normalized)) return false;
  if (/(^|\/)src\/chat\/prompts\//.test(normalized)) return true;
  if (/(^|\/)src\/skills\/catalog\/.+\/SKILL\.md$/.test(normalized)) return true;
  return false;
}
