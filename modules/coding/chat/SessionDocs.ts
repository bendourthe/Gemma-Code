import * as fs from "fs";
import * as path from "path";

/**
 * v0.8.0 Phase 4 sub-task 4.7 (item C5) -- session-handoff and
 * session-progress document writers.
 *
 * `/wrap-up-session` and `/run-deep-review` call these helpers to emit the
 * two end-of-session documents under
 * `docs/<version>/development/<session-id>/`:
 *
 *   - `session-handoff.md` -- forward-looking carryover. Lists open issues,
 *     decisions pending, and a one-line "start here" for the next session.
 *   - `session-progress.md` -- chronological log of what happened in this
 *     session (commit list, files touched, tests added).
 *
 * Both docs use a minimal, stable template so a human or sub-agent reviewer
 * can scan them at glance. The split mirrors hermes-agent's separation of
 * "what next" from "what just happened" so the next session's first prompt
 * lifts off the handoff without re-reading the progress log.
 */

export interface SessionHandoffData {
  readonly sessionId: string;
  readonly version: string;
  readonly branch: string;
  readonly openIssues: readonly string[];
  readonly pendingDecisions: readonly string[];
  readonly nextSessionStart: string;
  readonly date: string;
}

export interface SessionProgressData {
  readonly sessionId: string;
  readonly version: string;
  readonly branch: string;
  readonly commits: readonly { readonly sha: string; readonly message: string }[];
  readonly filesTouched: readonly string[];
  readonly testsAdded: readonly string[];
  readonly notes: readonly string[];
  readonly date: string;
}

export function renderSessionHandoff(data: SessionHandoffData): string {
  const lines: string[] = [];
  lines.push(`# Session Handoff -- ${data.sessionId}`);
  lines.push("");
  lines.push(`**Version**: ${data.version}`);
  lines.push(`**Branch**: ${data.branch}`);
  lines.push(`**Date**: ${data.date}`);
  lines.push("");
  lines.push("## Start here next session");
  lines.push("");
  lines.push(data.nextSessionStart || "_(none recorded)_");
  lines.push("");
  lines.push("## Open issues");
  lines.push("");
  if (data.openIssues.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const item of data.openIssues) lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Decisions pending");
  lines.push("");
  if (data.pendingDecisions.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const item of data.pendingDecisions) lines.push(`- ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderSessionProgress(data: SessionProgressData): string {
  const lines: string[] = [];
  lines.push(`# Session Progress -- ${data.sessionId}`);
  lines.push("");
  lines.push(`**Version**: ${data.version}`);
  lines.push(`**Branch**: ${data.branch}`);
  lines.push(`**Date**: ${data.date}`);
  lines.push("");
  lines.push("## Commits");
  lines.push("");
  if (data.commits.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const c of data.commits) {
      lines.push(`- \`${c.sha.slice(0, 8)}\` -- ${c.message}`);
    }
  }
  lines.push("");
  lines.push("## Files touched");
  lines.push("");
  if (data.filesTouched.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const f of data.filesTouched) lines.push(`- \`${f}\``);
  }
  lines.push("");
  lines.push("## Tests added");
  lines.push("");
  if (data.testsAdded.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const t of data.testsAdded) lines.push(`- \`${t}\``);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  if (data.notes.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const n of data.notes) lines.push(`- ${n}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Write both files into a single session directory under
 * `<docsRoot>/<version>/development/<sessionId>/`. Idempotent: existing
 * files are overwritten so a re-run picks up later commits.
 */
export function writeSessionDocs(
  docsRoot: string,
  version: string,
  sessionId: string,
  handoff: SessionHandoffData,
  progress: SessionProgressData,
): { handoffPath: string; progressPath: string } {
  const dir = path.join(docsRoot, version, "development", sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const handoffPath = path.join(dir, "session-handoff.md");
  const progressPath = path.join(dir, "session-progress.md");
  fs.writeFileSync(handoffPath, renderSessionHandoff(handoff), "utf8");
  fs.writeFileSync(progressPath, renderSessionProgress(progress), "utf8");
  return { handoffPath, progressPath };
}
