/**
 * v1.3.0 Phase 4 (adoption-skill-cleaner T012) -- session-log usage scanner.
 *
 * Implements insight I-10 from
 * `docs/versions/v1/v1.3.0/comparison-skill-cleaner.md`: determine which skills
 * have no recent invocation evidence by scanning Nexus's own session-replay
 * logs. Nexus's logs are richer than skill-cleaner's text-only `~/.codex/`
 * scan because Nexus emits structured `HookBus` skill-load events, so this
 * scanner ranks three signal tiers by fidelity:
 *
 *   (a) HookBus event -- a JSONL line that parses to an object whose `kind`
 *       contains `skill.loaded` / `skill.invoked` / `skill.entry` and which
 *       carries a `skillId` field. Highest fidelity.
 *   (b) Plain-text slug mention -- the skill's full `id` slug bounded by
 *       non-slug characters. Medium fidelity (catches copy-pasted prompts).
 *   (c) SKILL.md path mention -- the skill's absolute `SKILL.md` path appears
 *       verbatim. Lowest fidelity (catches files dropped into a prompt).
 *
 * The result Map contains an entry for *every* skill discovered under
 * `skillsRoot` -- including never-invoked skills with `matchCount: 0` -- so the
 * `SkillAuditor` (T013) can list zero-evidence candidates directly. This
 * scanner returns counts only; it never proposes deletions. The "candidate,
 * not verdict" framing (insight I-12) is applied by the auditor.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";

export interface SkillUsage {
  /** Latest timestamp at which any signal referenced this skill, or null. */
  lastSeen: Date | null;
  /** Cumulative count of log lines that referenced this skill (any signal). */
  matchCount: number;
}

export interface ScanUsageOptions {
  /** Directory tree to enumerate the skill universe from (one SKILL.md per skill). */
  skillsRoot: string;
  /** Session-log root to scan. Defaults to `~/.nexus/sessions/`. */
  sessionsRoot?: string;
  /** Look-back window in months. Defaults to 3. */
  months?: number;
  /**
   * v1.3.0 Phase 6 (adoption-skill-cleaner T018, P3 `--deep-logs`) -- when true,
   * the scan additionally descends into the `archive/` subtree (skipped by
   * default because archived sessions are old by construction) and reads
   * gzip-compressed `*.jsonl.gz` logs anywhere under `sessionsRoot`
   * (decompressed in-memory via `zlib.gunzipSync`, no new dependency). When
   * false (the default), only uncompressed `*.jsonl` files outside `archive/`
   * are scanned. The look-back window still applies to every file by mtime.
   */
  deepLogs?: boolean;
}

/** Default sessions root, honoring the `NEXUS_HOME` installer override. */
export function defaultSessionsRoot(): string {
  const home = process.env["NEXUS_HOME"] ?? path.join(os.homedir(), ".nexus");
  return path.join(home, "sessions");
}

/** Kinds that count as a high-fidelity structured skill-usage event. */
const SKILL_EVENT_KINDS = ["skill.loaded", "skill.invoked", "skill.entry"];

/**
 * Parse a skill's `name` from its SKILL.md frontmatter, falling back to the
 * parent directory name when `name:` is absent (the default rule from the
 * `skill-description-authoring` skill, insight I-15). Returns null when the
 * file cannot be read.
 */
function skillIdFor(skillFile: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(skillFile, "utf8");
  } catch {
    return null;
  }
  const m = /^﻿?\s*---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (m) {
    for (const line of (m[1] ?? "").split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      if (line.slice(0, idx).trim() === "name") {
        const value = line.slice(idx + 1).trim();
        if (value) return value;
      }
    }
  }
  return path.basename(path.dirname(skillFile));
}

/** Recursively collect every `SKILL.md` path under `dir` (symlinks skipped). */
function walkSkillFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkSkillFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") out.push(full);
  }
}

/**
 * Recursively collect session logs under `dir` (symlinks skipped). By default
 * only uncompressed `*.jsonl` files are collected and the `archive/` subtree is
 * skipped. When `deepLogs` is true the walk also descends into `archive/` and
 * collects gzip-compressed `*.jsonl.gz` logs (insight `--deep-logs`, T018).
 */
function walkSessionLogs(dir: string, out: string[], deepLogs: boolean): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      // The `archive/` subtree holds rolled-off sessions; only deep-logs reads it.
      if (!deepLogs && entry.name === "archive") continue;
      walkSessionLogs(full, out, deepLogs);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".jsonl")) out.push(full);
    else if (deepLogs && entry.name.endsWith(".jsonl.gz")) out.push(full);
  }
}

/**
 * Read a session log to text, transparently gunzipping `*.jsonl.gz` files.
 * Returns null when the file cannot be read or decompressed.
 */
function readLogText(file: string): string | null {
  try {
    const buf = fs.readFileSync(file);
    return file.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  } catch {
    return null;
  }
}

/** Escape a string for safe interpolation into a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a slug matcher that requires the slug to be bounded by characters
 * outside the slug alphabet (`[A-Za-z0-9_-]`), so `code-review` does not match
 * inside `code-review-extra` or `xcode-review`.
 */
function slugMentioned(slug: string, line: string): boolean {
  const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(slug)}(?![A-Za-z0-9_-])`);
  return re.test(line);
}

/** Pull an ISO-ish timestamp out of a parsed event object, if present. */
function eventTimestamp(event: Record<string, unknown>): Date | null {
  for (const key of ["timestamp", "ts", "time", "at"]) {
    const raw = event[key];
    if (typeof raw === "string" || typeof raw === "number") {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * Scan session logs for usage evidence of every skill discovered under
 * `skillsRoot`. Returns a Map keyed by skill id; every skill is present, even
 * those with `matchCount: 0` and `lastSeen: null`.
 */
export async function scanUsage(opts: ScanUsageOptions): Promise<Map<string, SkillUsage>> {
  const sessionsRoot = opts.sessionsRoot ?? defaultSessionsRoot();
  const months = opts.months ?? 3;
  const deepLogs = opts.deepLogs ?? false;

  // --- Build the skill universe (id -> absolute SKILL.md path). ---
  const skillFiles: string[] = [];
  walkSkillFiles(opts.skillsRoot, skillFiles);
  const idToPath = new Map<string, string>();
  for (const file of skillFiles) {
    const id = skillIdFor(file);
    if (id && !idToPath.has(id)) idToPath.set(id, file);
  }

  const usage = new Map<string, SkillUsage>();
  for (const id of idToPath.keys()) {
    usage.set(id, { lastSeen: null, matchCount: 0 });
  }
  if (idToPath.size === 0) return usage;

  // --- Determine the look-back cutoff. ---
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  // --- Enumerate in-window session logs. ---
  const allLogs: string[] = [];
  walkSessionLogs(sessionsRoot, allLogs, deepLogs);
  const logs = allLogs.filter((file) => {
    try {
      return fs.statSync(file).mtime >= cutoff;
    } catch {
      return false;
    }
  });

  const record = (id: string, when: Date): void => {
    const entry = usage.get(id);
    if (!entry) return;
    entry.matchCount += 1;
    if (!entry.lastSeen || when > entry.lastSeen) entry.lastSeen = when;
  };

  // --- Scan each in-window log line for the three signal tiers. ---
  for (const file of logs) {
    const content = readLogText(file);
    if (content === null) continue;
    let fileMtime: Date;
    try {
      fileMtime = fs.statSync(file).mtime;
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;

      // (a) Structured HookBus event -- highest fidelity.
      let handled = false;
      if (line.includes("skillId") && line.trimStart().startsWith("{")) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const kind = typeof event["kind"] === "string" ? event["kind"] : "";
          const type = typeof event["type"] === "string" ? event["type"] : "";
          const skillId = event["skillId"];
          const isSkillEvent = SKILL_EVENT_KINDS.some(
            (k) => kind.includes(k) || type.includes(k),
          );
          if (isSkillEvent && typeof skillId === "string" && usage.has(skillId)) {
            record(skillId, eventTimestamp(event) ?? fileMtime);
            handled = true;
          }
        } catch {
          // Not JSON -- fall through to text signals.
        }
      }
      if (handled) continue;

      // (b) + (c) text signals -- slug mention or SKILL.md path mention.
      for (const [id, skillPath] of idToPath) {
        if (slugMentioned(id, line) || line.includes(skillPath)) {
          record(id, fileMtime);
        }
      }
    }
  }

  return usage;
}
