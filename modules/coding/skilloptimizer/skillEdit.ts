// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- pure helpers
// for applying, measuring, hashing, and rendering bounded skill edits.
//
// Pure functions only: no I/O, no clock, no randomness. Boundary: vscode-free
// (mirrors the rest of `modules/coding/`). The optimizer loop composes these;
// they are unit-tested directly.
// ---------------------------------------------------------------------------

import { hashEdit } from "../../../core/memory/RejectedEditBuffer.js";
import type { LearningRateBudget, ProposedSkillEdit, SkillEditOp } from "./types.js";

/**
 * Apply a sequence of bounded edit ops to a skill body, in order. Each op acts
 * on the FIRST occurrence of its `match`:
 *  - `add`: append `text`, or insert it right after `match` when `match` is set.
 *  - `delete`: remove `match` (no-op when `match` is absent or unmatched).
 *  - `replace`: substitute `match` with `text` (no-op when `match` is unmatched).
 *
 * An op whose `match` is not found leaves the body unchanged for that op (the
 * gate then measures no improvement and the edit is buffered) -- it never throws.
 */
export function applySkillEditOps(body: string, ops: readonly SkillEditOp[]): string {
  let out = body;
  for (const op of ops) {
    out = applyOne(out, op);
  }
  return out;
}

function applyOne(body: string, op: SkillEditOp): string {
  const text = op.text ?? "";
  const match = op.match ?? "";
  switch (op.kind) {
    case "add": {
      if (match.length === 0) {
        // Append, separating with a blank line when the body is non-empty.
        return body.length === 0 ? text : `${body}\n${text}`;
      }
      const at = body.indexOf(match);
      if (at === -1) return body;
      const insertAt = at + match.length;
      return body.slice(0, insertAt) + text + body.slice(insertAt);
    }
    case "delete": {
      if (match.length === 0) return body;
      const at = body.indexOf(match);
      if (at === -1) return body;
      return body.slice(0, at) + body.slice(at + match.length);
    }
    case "replace": {
      if (match.length === 0) return body;
      const at = body.indexOf(match);
      if (at === -1) return body;
      return body.slice(0, at) + text + body.slice(at + match.length);
    }
    default:
      return body;
  }
}

/**
 * Total changed-character volume of an edit: inserted text counts as added,
 * matched text counts as removed/affected. This is the quantity the textual
 * learning-rate budget caps.
 */
export function editChangedChars(ops: readonly SkillEditOp[]): number {
  let total = 0;
  for (const op of ops) {
    const text = (op.text ?? "").length;
    const match = (op.match ?? "").length;
    if (op.kind === "add") total += text;
    else if (op.kind === "delete") total += match;
    else total += text + match; // replace affects both
  }
  return total;
}

/** True when an edit stays within the learning-rate budget (op count + char volume). */
export function withinLearningRate(edit: ProposedSkillEdit, budget: LearningRateBudget): boolean {
  if (edit.ops.length === 0) return false;
  if (edit.ops.length > budget.maxOps) return false;
  if (editChangedChars(edit.ops) > budget.maxChangedChars) return false;
  return true;
}

/**
 * Deterministically serialize an edit's ops + skill id (NOT the rationale, which
 * is free-form model text) so equal edits hash equally regardless of rationale
 * wording. Used for the content-addressed buffer key and the per-run de-dupe.
 */
export function serializeSkillEdit(edit: ProposedSkillEdit): string {
  const ops = edit.ops.map((op) => ({ kind: op.kind, match: op.match ?? "", text: op.text ?? "" }));
  return JSON.stringify({ skillId: edit.skillId, ops });
}

/** Stable content hash of an edit (over its serialized ops), for the buffer key. */
export function hashSkillEdit(edit: ProposedSkillEdit): string {
  return hashEdit(serializeSkillEdit(edit));
}

/**
 * Split a SKILL.md into its frontmatter header (including the delimiters and the
 * trailing newline after the closing `---`) and its body. When the content has
 * no leading `---` frontmatter block, the header is empty and the whole content
 * is the body. Used to overwrite only the body while preserving frontmatter.
 */
export function splitFrontmatter(content: string): { header: string; body: string } {
  if (!content.startsWith("---")) return { header: "", body: content };
  // Find the closing delimiter line after the opening one.
  const closeRe = /\n---[ \t]*(\r?\n|$)/;
  // Skip the opening `---` line before searching for the close.
  const afterOpen = content.indexOf("\n");
  if (afterOpen === -1) return { header: "", body: content };
  const rest = content.slice(afterOpen);
  const m = closeRe.exec(rest);
  if (!m) return { header: "", body: content };
  const headerEnd = afterOpen + m.index + m[0]!.length;
  return { header: content.slice(0, headerEnd), body: content.slice(headerEnd) };
}

/**
 * Reassemble a SKILL.md from its original on-disk content and a new body,
 * preserving the original frontmatter verbatim. The optimizer only edits the
 * body, so the frontmatter (name, version, tags, ...) is never disturbed.
 */
export function reassembleSkillFile(originalContent: string, newBody: string): string {
  const { header } = splitFrontmatter(originalContent);
  return header + newBody;
}

/** A compact, human-readable rendering of a proposed edit, for the approval prompt. */
export function renderEditDiff(edit: ProposedSkillEdit): string {
  const lines: string[] = [`Skill: ${edit.skillId}`, `Rationale: ${edit.rationale}`, ""];
  edit.ops.forEach((op, i) => {
    if (op.kind === "add") {
      lines.push(`#${i + 1} add${op.match ? ` after "${ellipsis(op.match)}"` : " (append)"}:`);
      lines.push(`  + ${ellipsis(op.text ?? "")}`);
    } else if (op.kind === "delete") {
      lines.push(`#${i + 1} delete:`);
      lines.push(`  - ${ellipsis(op.match ?? "")}`);
    } else {
      lines.push(`#${i + 1} replace:`);
      lines.push(`  - ${ellipsis(op.match ?? "")}`);
      lines.push(`  + ${ellipsis(op.text ?? "")}`);
    }
  });
  lines.push("", `(${editChangedChars(edit.ops)} changed chars across ${edit.ops.length} op(s))`);
  return lines.join("\n");
}

function ellipsis(s: string, max = 120): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}...`;
}
