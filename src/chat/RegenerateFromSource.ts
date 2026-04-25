import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import type { CompactionStrategy } from "./CompactionStrategy.js";
import type { Message } from "./types.js";

/**
 * Regex to extract file paths from message content.
 * Matches paths with at least one directory separator and a known extension.
 */
const FILE_PATH_RE =
  /(?:^|\s|["'`(])(([\w.@-]+\/)+[\w.@-]+\.(?:ts|js|py|json|md|tsx|jsx|css|html|yaml|yml|toml|rs|go|java|c|cpp|h|sh))\b/g;

/** Patterns indicating a decision was made in the conversation. */
const DECISION_PATTERNS = [
  /\b(?:decided|chose|will use|going with|selected|picked)\b/i,
  /\b(?:because|reason|rationale|trade-?off)\b/i,
];

/** Patterns indicating test results in the conversation. */
const TEST_RESULT_PATTERNS = [
  /\b(?:PASS|FAIL|passed|failed)\b/,
  /\bError:/,
  /\btest(?:s)?\s+(?:pass|fail|run)/i,
  /\d+\s+(?:passed|failed|skipped)/,
];

const GIT_TIMEOUT_MS = 5000;
const MAX_FILE_HEAD_LINES = 20;

/**
 * Compaction strategy that regenerates context from actual source files,
 * git state, and conversation decisions rather than summarizing the
 * conversation text. Prevents information degradation over multiple
 * compaction cycles.
 */
export class RegenerateFromSource implements CompactionStrategy {
  readonly name = "RegenerateFromSource";

  constructor(
    private readonly _workspacePath: string,
    private readonly _maxSummaryTokens: number = 2000,
    /**
     * Number of recent non-system messages to keep after summarisation.
     * Defaults to 6 to mirror the historical default of `compactionKeepRecent`
     * when the value is not threaded in from the composition root.
     */
    private readonly _keepRecent: number = 6,
  ) {}

  /**
   * Returns true if any messages contain recognizable file paths,
   * indicating we have source files to regenerate context from.
   */
  canApply(messages: readonly Message[], _budgetTokens: number): boolean {
    return this._extractFilePaths(messages).length > 0;
  }

  /**
   * Regenerate a fresh context summary by re-reading source files, git
   * state, and extracting decisions from the conversation. Replaces the
   * bulk of the conversation with a concise, accurate summary.
   */
  async apply(messages: readonly Message[], _budgetTokens: number): Promise<Message[]> {
    const filePaths = this._extractFilePaths(messages);
    const gitContext = this._getGitContext();
    const fileSnippets = this._readFileHeads(filePaths);
    const decisions = this._extractDecisions(messages);
    const testStatus = this._extractTestStatus(messages);

    const sections: string[] = ["[Regenerated context from source]"];

    if (fileSnippets.length > 0) {
      sections.push("## Modified Files\n");
      for (const snippet of fileSnippets) {
        sections.push(`### ${snippet.path}\n\`\`\`\n${snippet.head}\n\`\`\``);
      }
    }

    if (gitContext) {
      sections.push(`## Recent Git Activity\n\n${gitContext}`);
    }

    if (testStatus.length > 0) {
      sections.push(`## Test Status\n\n${testStatus.join("\n")}`);
    }

    if (decisions.length > 0) {
      sections.push(`## Key Decisions\n\n${decisions.join("\n")}`);
    }

    // Truncate to budget.
    let summaryContent = sections.join("\n\n");
    const maxChars = this._maxSummaryTokens * 4;
    if (summaryContent.length > maxChars) {
      summaryContent =
        summaryContent.slice(0, maxChars) + "\n[Summary truncated to fit budget]";
    }

    const summaryMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: summaryContent,
      timestamp: Date.now(),
    };

    // Preserve system messages and last N non-system messages.
    const keepRecent = this._keepRecent;
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");
    const kept = nonSystem.slice(-keepRecent);

    return [...systemMessages, summaryMessage, ...kept];
  }

  /** Extract unique file paths from all message content. */
  _extractFilePaths(messages: readonly Message[]): string[] {
    const paths = new Set<string>();
    for (const msg of messages) {
      let match: RegExpExecArray | null;
      const re = new RegExp(FILE_PATH_RE.source, FILE_PATH_RE.flags);
      while ((match = re.exec(msg.content)) !== null) {
        if (match[1]) paths.add(match[1]);
      }
    }
    return [...paths];
  }

  /** Run git commands to get recent activity, with timeout and error handling. */
  private _getGitContext(): string | null {
    try {
      const diffStat = execSync("git diff --stat HEAD~5", {
        cwd: this._workspacePath,
        timeout: GIT_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();

      const log = execSync("git log --oneline -5", {
        cwd: this._workspacePath,
        timeout: GIT_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();

      const parts: string[] = [];
      if (log) parts.push(`Recent commits:\n${log}`);
      if (diffStat) parts.push(`Changes since HEAD~5:\n${diffStat}`);
      return parts.length > 0 ? parts.join("\n\n") : null;
    } catch {
      return null;
    }
  }

  /** Read the first N lines of each file that exists on disk. */
  private _readFileHeads(
    filePaths: string[],
  ): Array<{ path: string; head: string }> {
    const results: Array<{ path: string; head: string }> = [];
    for (const fp of filePaths) {
      const fullPath = path.isAbsolute(fp)
        ? fp
        : path.join(this._workspacePath, fp);
      try {
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n").slice(0, MAX_FILE_HEAD_LINES);
        results.push({ path: fp, head: lines.join("\n") });
      } catch {
        // Skip files that cannot be read.
      }
    }
    return results;
  }

  /** Extract sentences that look like decisions from the conversation. */
  _extractDecisions(messages: readonly Message[]): string[] {
    const decisions: string[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      const sentences = msg.content.split(/[.!?\n]+/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length < 10 || trimmed.length > 500) continue;
        if (DECISION_PATTERNS.some((p) => p.test(trimmed))) {
          decisions.push(`- ${trimmed}`);
          if (decisions.length >= 10) return decisions;
        }
      }
    }
    return decisions;
  }

  /** Extract test result lines from the conversation. */
  private _extractTestStatus(messages: readonly Message[]): string[] {
    const results: string[] = [];
    for (const msg of messages) {
      const lines = msg.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length < 5 || trimmed.length > 200) continue;
        if (TEST_RESULT_PATTERNS.some((p) => p.test(trimmed))) {
          results.push(`- ${trimmed}`);
          if (results.length >= 10) return results;
        }
      }
    }
    return results;
  }
}
