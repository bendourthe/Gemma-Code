import * as fs from "fs";
import * as path from "path";
import type { EpisodicEntry } from "../storage/MemoryLayers.types.js";

/**
 * v0.8.0 Phase 6.4 (item D4) -- Skill auto-harvest from repeated workflows.
 *
 * Scans episodic memory for tool-call sequences of length 3-7. When a
 * sequence has appeared >= `minRecurrence` times within the lookback
 * window, the detector emits a `WorkflowProposal` that callers can show
 * in the MemoryPanel.
 *
 * On user accept, `writeProposedSkill()` lands a SKILL.md draft into
 * `~/.gemma-code/skills/proposed/<slug>/SKILL.md`. The operator must
 * explicitly move it to the active skills directory to activate -- the
 * detector never installs skills directly.
 */

export interface WorkflowDetectorOptions {
  /** Minimum repeat count to surface a proposal. Default 3. */
  readonly minRecurrence?: number;
  /** Lookback window in milliseconds. Default 7 days. */
  readonly windowMs?: number;
  /** Minimum sequence length to consider. Default 3. */
  readonly minSeqLength?: number;
  /** Maximum sequence length to consider. Default 7. */
  readonly maxSeqLength?: number;
  /** Override `Date.now()` for deterministic tests. */
  readonly now?: () => number;
}

export interface WorkflowProposal {
  readonly tools: readonly string[];
  readonly recurrences: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly slug: string;
}

const DEFAULT_MIN_RECURRENCE = 3;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_SEQ_LENGTH = 3;
const DEFAULT_MAX_SEQ_LENGTH = 7;

export class WorkflowDetector {
  private readonly _opts: Required<WorkflowDetectorOptions>;

  constructor(options: WorkflowDetectorOptions = {}) {
    this._opts = {
      minRecurrence: options.minRecurrence ?? DEFAULT_MIN_RECURRENCE,
      windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
      minSeqLength: options.minSeqLength ?? DEFAULT_MIN_SEQ_LENGTH,
      maxSeqLength: options.maxSeqLength ?? DEFAULT_MAX_SEQ_LENGTH,
      now: options.now ?? Date.now,
    };
  }

  /**
   * Scan the supplied events for repeated tool sequences. Events are
   * grouped by session and time-ordered before n-gram extraction so
   * sequences do not cross session boundaries.
   */
  detect(events: readonly EpisodicEntry[]): readonly WorkflowProposal[] {
    const now = this._opts.now();
    const cutoff = now - this._opts.windowMs;
    const recent = events.filter((e) => e.timestamp >= cutoff);

    const bySession = new Map<string, EpisodicEntry[]>();
    for (const ev of recent) {
      const list = bySession.get(ev.sessionId) ?? [];
      list.push(ev);
      bySession.set(ev.sessionId, list);
    }

    const counts = new Map<string, { tools: string[]; recurrences: number; firstSeen: number; lastSeen: number }>();
    for (const list of bySession.values()) {
      list.sort((a, b) => a.timestamp - b.timestamp);
      const tools = list.map((e) => (e.action ?? "").trim()).filter((a) => a.length > 0);
      for (let len = this._opts.minSeqLength; len <= this._opts.maxSeqLength; len++) {
        for (let i = 0; i + len <= tools.length; i++) {
          const slice = tools.slice(i, i + len);
          const key = slice.join("|");
          const ts0 = list[i]?.timestamp ?? 0;
          const ts1 = list[i + len - 1]?.timestamp ?? ts0;
          const existing = counts.get(key);
          if (existing) {
            existing.recurrences += 1;
            existing.firstSeen = Math.min(existing.firstSeen, ts0);
            existing.lastSeen = Math.max(existing.lastSeen, ts1);
          } else {
            counts.set(key, {
              tools: slice,
              recurrences: 1,
              firstSeen: ts0,
              lastSeen: ts1,
            });
          }
        }
      }
    }

    const proposals: WorkflowProposal[] = [];
    for (const entry of counts.values()) {
      if (entry.recurrences < this._opts.minRecurrence) continue;
      proposals.push({
        tools: entry.tools,
        recurrences: entry.recurrences,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        slug: slugifyTools(entry.tools),
      });
    }
    return proposals.sort((a, b) => b.recurrences - a.recurrences);
  }

  /**
   * Write a SKILL.md draft for the proposal. Returns the absolute path
   * written; callers should display this to the operator. The file is
   * landed under `<skillsRoot>/proposed/<slug>/SKILL.md`. We never write
   * to the active `<skillsRoot>/<slug>/` path -- activation is a manual
   * move.
   */
  writeProposedSkill(proposal: WorkflowProposal, skillsRoot: string): string {
    const proposedDir = path.join(skillsRoot, "proposed", proposal.slug);
    fs.mkdirSync(proposedDir, { recursive: true });
    const outPath = path.join(proposedDir, "SKILL.md");
    const bytes = renderProposedSkill(proposal);
    fs.writeFileSync(outPath, bytes, "utf-8");
    return outPath;
  }
}

export function slugifyTools(tools: readonly string[]): string {
  return tools
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .filter((s) => s.length > 0)
    .join("-")
    .slice(0, 80);
}

export function renderProposedSkill(proposal: WorkflowProposal): string {
  const date = new Date().toISOString().slice(0, 10);
  const sequence = proposal.tools.map((t) => `- ${t}`).join("\n");
  return [
    "---",
    `name: ${proposal.slug}`,
    `description: "Repeated workflow detected ${proposal.recurrences} times: ${proposal.tools.join(" -> ")}"`,
    'argument-hint: ""',
    "version: 0.1.0",
    "platforms: [linux, macos, windows]",
    "metadata.tags: [workflow, auto-harvested]",
    "---",
    "",
    "# Proposed skill",
    "",
    `Auto-detected on ${date} after ${proposal.recurrences} recurrences (window spanning ${proposal.firstSeen} -> ${proposal.lastSeen}).`,
    "",
    "## Tool sequence",
    "",
    sequence,
    "",
    "## How to activate",
    "",
    "Move this file to `~/.gemma-code/skills/<slug>/SKILL.md` (without the `proposed/` segment) to activate it.",
    "",
    "## What to write here",
    "",
    "Replace this section with the operator-friendly instructions for the workflow above.",
    "",
  ].join("\n");
}
