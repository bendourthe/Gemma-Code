/**
 * Rule: prompt-bom
 *
 * Reject UTF-8 BOM (U+FEFF) at the head of any prompt / skill markdown file.
 * Frontmatter parsers and the SkillLoader treat BOM as part of the YAML key,
 * so a BOM silently breaks every consumer.
 *
 * Severity: error. Markdown-only (`appliesTo` gate).
 */

import { finding } from "./helpers.mjs";

export const id = "prompt-bom";
export const severity = "error";

export function appliesTo(filePath) {
  return isPromptOrSkillMarkdown(filePath);
}

export function scan(filePath, contents) {
  if (!isPromptOrSkillMarkdown(filePath)) return [];
  if (contents.charCodeAt(0) !== 0xfeff) return [];
  return [
    finding({
      ruleId: id,
      severity,
      filePath,
      line: 1,
      column: 1,
      message: `file starts with a UTF-8 BOM; strip it (e.g. save as UTF-8 without BOM)`,
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
