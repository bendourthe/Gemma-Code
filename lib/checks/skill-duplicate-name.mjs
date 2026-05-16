/**
 * Rule: skill-duplicate-name
 *
 * Cross-file rule: two SKILL.md files declaring the same `name:` frontmatter
 * value collide in CommandRouter. Detects duplicates by scanning every file
 * once and keeping a Map. Implemented as a stateful rule -- the per-file
 * `scan` call records the name, and `flush` (called by the gemma-check
 * runner after all files have been scanned) emits findings for collisions.
 *
 * Pattern documentation: this is the first cross-file rule in the registry.
 * Future cross-file rules should follow the same shape: keep state on a
 * module-level Map, expose `scan` (no findings emitted), and a `flush`
 * function that returns the accumulated findings.
 *
 * Severity: error. Markdown-only (`appliesTo` gate).
 */

import { finding } from "./helpers.mjs";

export const id = "skill-duplicate-name";
export const severity = "error";

const _byName = new Map(); // name -> Array<{filePath, line}>

export function appliesTo(filePath) {
  return isSkillMd(filePath);
}

export function scan(filePath, contents) {
  if (!isSkillMd(filePath)) return [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);
  if (!match) return [];
  const block = match[1] ?? "";
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^name:\s*(.+)$/.exec(line);
    if (!m) continue;
    const name = m[1].trim().replace(/^["']|["']$/g, "");
    if (!name) continue;
    const lineNo = i + 2; // +1 for "---" header, +1 for 1-indexing
    const list = _byName.get(name) ?? [];
    list.push({ filePath, line: lineNo });
    _byName.set(name, list);
    break; // only one name per frontmatter
  }
  return [];
}

/**
 * Drain accumulated state and return findings. The gemma-check runner is
 * expected to call this at the end of a scan to surface the cross-file
 * collisions. Calling it twice on the same scan is safe (the second call
 * returns the same findings + clears the state).
 */
export function flush() {
  const findings = [];
  for (const [name, entries] of _byName) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      findings.push(
        finding({
          ruleId: id,
          severity,
          filePath: entry.filePath,
          line: entry.line,
          column: 1,
          message: `duplicate skill name "${name}" -- already declared by another SKILL.md in this scan`,
        }),
      );
    }
  }
  _byName.clear();
  return findings;
}

/** Test-only: peek at the running state. */
export function _stateForTests() {
  return new Map(_byName);
}

function isSkillMd(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return /(^|\/)src\/skills\/catalog\/.+\/SKILL\.md$/.test(normalized);
}
