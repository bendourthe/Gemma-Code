/**
 * Rule: prompt-no-ascii-violation
 *
 * Flag non-ASCII characters in prompt / skill markdown that the project's
 * commit / encoding policy forbids: em-dash (U+2014), en-dash (U+2013),
 * curly quotes (U+201C/D/U+2018/U+2019), ellipsis (U+2026), and a generic
 * non-ASCII fallback. Limited to files under `modules/coding/chat/prompts/` and
 * `modules/coding/skills/catalog/**\/SKILL.md` so TS sources keep their inline
 * documentation unicode-safe (covered by other rules).
 *
 * Severity: error. Markdown-only (`appliesTo` gate).
 */

import { finding, offsetToPosition } from "./helpers.mjs";

export const id = "prompt-no-ascii-violation";
export const severity = "error";

export function appliesTo(filePath) {
  return isPromptOrSkillMarkdown(filePath);
}

const NAMED = new Map([
  [0x2014, "em-dash"],
  [0x2013, "en-dash"],
  [0x201c, "left double quote"],
  [0x201d, "right double quote"],
  [0x2018, "left single quote"],
  [0x2019, "right single quote"],
  [0x2026, "ellipsis"],
]);

export function scan(filePath, contents) {
  if (!isPromptOrSkillMarkdown(filePath)) return [];
  const findings = [];
  for (let i = 0; i < contents.length; i++) {
    const code = contents.charCodeAt(i);
    if (code < 128) continue;
    const { line, column } = offsetToPosition(contents, i);
    const label = NAMED.get(code);
    const repr = label ?? `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
    findings.push(
      finding({
        ruleId: id,
        severity,
        filePath,
        line,
        column,
        message: `non-ASCII character (${repr}) -- prompt / skill markdown must be ASCII-only`,
      }),
    );
  }
  return findings;
}

function isPromptOrSkillMarkdown(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!/\.md$/i.test(normalized)) return false;
  if (/(^|\/)modules\/coding\/chat\/prompts\//.test(normalized)) return true;
  if (/(^|\/)modules\/coding\/skills\/catalog\/.+\/SKILL\.md$/.test(normalized)) return true;
  return false;
}
