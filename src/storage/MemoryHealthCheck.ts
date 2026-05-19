import * as fs from "fs";
import * as path from "path";
import type { MemoryStore } from "./MemoryStore.js";
import type { MemoryEntry } from "./MemoryStore.types.js";
import type { MemoryLayerId } from "./MemoryLayers.types.js";
import { matchesSecretPath } from "../utils/secretPaths.js";

/** Workspace-relative path regex for broken-path detection. */
const PATH_REFERENCE_REGEX =
  /\b[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml)\b/g;

/**
 * Standalone tokens that look like secret-bearing paths (e.g. `.env.production`,
 * `id_rsa`, `credentials.json`). The path-reference regex above misses these
 * because the leading dot trips its `\b` boundary or the token has no
 * recognised extension. Surface them so the redactor can swap the body out.
 */
const SECRET_TOKEN_REGEX =
  // gemma-check-allow-next-line: no-env-file-leakage
  /(?:\.env(?:\.[A-Za-z0-9_-]+)*|id_(?:rsa|ed25519|ecdsa)\b|credentials(?:\.[A-Za-z0-9_-]+)?)/g;

/** Default lookback for the "stale" check: 60 days. */
const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
/** Default scope: scan the most recent N entries per layer. */
const DEFAULT_SCAN_LIMIT = 1000;
/** Truncation length for body excerpts written into the report. */
const BODY_TRUNCATE = 200;

export interface StaleIssue {
  readonly id: string;
  readonly key: string;
  readonly ageDays: number;
}

export interface BrokenPathIssue {
  readonly id: string;
  readonly missingPath: string;
  readonly bodyExcerpt: string;
}

export interface EmbeddingFailedIssue {
  readonly id: string;
  readonly key: string;
}

export interface DuplicateIssue {
  readonly olderId: string;
  readonly newerId: string;
  readonly similarity: number;
}

export interface MemoryHealthReport {
  readonly generatedAt: string;
  readonly counts: {
    readonly totalEntries: number;
    readonly byLayer: Partial<Record<MemoryLayerId, number>>;
  };
  readonly issues: {
    readonly stale: readonly StaleIssue[];
    readonly brokenPath: readonly BrokenPathIssue[];
    readonly embeddingFailed: readonly EmbeddingFailedIssue[];
    readonly duplicate: readonly DuplicateIssue[];
  };
  readonly summary: string;
}

export interface MemoryHealthCheckOptions {
  readonly limit?: number;
  readonly full?: boolean;
}

export interface MemoryHealthCheckDeps {
  readonly memoryStore: MemoryStore;
  /** Workspace root for resolving file references. */
  readonly workspaceRoot: string;
  /** Returns true if a workspace-relative path exists on disk. */
  readonly fileExists?: (relativePath: string) => boolean;
  /** Extra deny patterns appended to the built-in list. */
  readonly secretPathDenyExtra?: readonly string[];
  /** When true, signals the embedder is configured (so missing embeddings are flagged). */
  readonly embeddingEnabled?: boolean;
}

/**
 * Health-check pass over the semantic memory layer. Report-only -- never
 * mutates the store. Emits a Markdown report under `.nexus/memory-health.md`
 * via `writeReportToDisk`.
 */
export class MemoryHealthCheck {
  private readonly _deps: MemoryHealthCheckDeps;

  constructor(deps: MemoryHealthCheckDeps) {
    this._deps = deps;
  }

  async run(opts: MemoryHealthCheckOptions = {}): Promise<MemoryHealthReport> {
    const limit = opts.full ? Number.MAX_SAFE_INTEGER : opts.limit ?? DEFAULT_SCAN_LIMIT;
    const entries = this._deps.memoryStore.listAll(limit);
    const totalEntries = this._deps.memoryStore.count();

    const stale = this._detectStale(entries);
    const brokenPath = this._detectBrokenPath(entries);
    const embeddingFailed = this._deps.embeddingEnabled
      ? this._detectEmbeddingFailed(entries)
      : [];
    const duplicate = this._detectDuplicates(entries);

    const issueCount =
      stale.length +
      brokenPath.length +
      embeddingFailed.length +
      duplicate.length;
    const healthyPct =
      totalEntries === 0
        ? 100
        : Math.max(0, Math.round((1 - issueCount / totalEntries) * 100));

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        totalEntries,
        byLayer: { semantic: entries.length },
      },
      issues: { stale, brokenPath, embeddingFailed, duplicate },
      summary: `${issueCount} issues across ${totalEntries} entries (${healthyPct}% healthy)`,
    };
  }

  /**
   * Render the report as Markdown and write it to
   * `<workspace>/.nexus/memory-health.md`. Overwrites any prior report.
   * Returns the absolute path of the written file.
   */
  writeReportToDisk(report: MemoryHealthReport): string {
    const dir = path.join(this._deps.workspaceRoot, ".nexus");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, "memory-health.md");
    fs.writeFileSync(target, this.renderMarkdown(report), { encoding: "utf8" });
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(target, 0o600);
      } catch {
        // Non-fatal: chmod failures don't block the report.
      }
    }
    return target;
  }

  /** Render the report as a deterministic Markdown document. */
  renderMarkdown(report: MemoryHealthReport): string {
    const out: string[] = [];
    out.push("---");
    out.push(`generatedAt: ${report.generatedAt}`);
    out.push(`totalEntries: ${report.counts.totalEntries}`);
    out.push("---");
    out.push("");
    out.push("# Memory Health Report");
    out.push("");

    out.push("## Stale entries");
    out.push("");
    if (report.issues.stale.length === 0) {
      out.push("_No stale entries detected._");
    } else {
      out.push("| id | key | age (days) |");
      out.push("|----|-----|------------|");
      for (const issue of report.issues.stale) {
        out.push(`| ${issue.id} | ${this._truncate(issue.key, 80)} | ${issue.ageDays} |`);
      }
    }
    out.push("");

    out.push("## Broken path references");
    out.push("");
    if (report.issues.brokenPath.length === 0) {
      out.push("_No broken path references detected._");
    } else {
      out.push("| id | missing path | body excerpt |");
      out.push("|----|--------------|--------------|");
      for (const issue of report.issues.brokenPath) {
        out.push(
          `| ${issue.id} | ${this._truncate(issue.missingPath, 120)} | ${this._truncate(issue.bodyExcerpt, 120)} |`,
        );
      }
    }
    out.push("");

    out.push("## Embedding failures");
    out.push("");
    if (report.issues.embeddingFailed.length === 0) {
      out.push("_No embedding failures detected._");
    } else {
      out.push("| id | key |");
      out.push("|----|-----|");
      for (const issue of report.issues.embeddingFailed) {
        out.push(`| ${issue.id} | ${this._truncate(issue.key, 80)} |`);
      }
    }
    out.push("");

    out.push("## Duplicates");
    out.push("");
    if (report.issues.duplicate.length === 0) {
      out.push("_No duplicate entries detected._");
    } else {
      out.push("| older id | newer id | similarity |");
      out.push("|----------|----------|------------|");
      for (const issue of report.issues.duplicate) {
        out.push(
          `| ${issue.olderId} | ${issue.newerId} | ${issue.similarity.toFixed(2)} |`,
        );
      }
    }
    out.push("");

    out.push("## Summary");
    out.push("");
    out.push(report.summary);
    out.push("");
    return out.join("\n");
  }

  private _detectStale(entries: readonly MemoryEntry[]): StaleIssue[] {
    const now = Date.now();
    const issues: StaleIssue[] = [];
    for (const entry of entries) {
      const ageMs = now - entry.accessedAt;
      if (ageMs > STALE_AFTER_MS && entry.accessCount <= 1) {
        issues.push({
          id: entry.id,
          key: this._redactedKey(entry),
          ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
        });
      }
    }
    return issues;
  }

  private _detectBrokenPath(entries: readonly MemoryEntry[]): BrokenPathIssue[] {
    const fileExists = this._deps.fileExists ?? this._defaultFileExists.bind(this);
    const issues: BrokenPathIssue[] = [];
    for (const entry of entries) {
      const matches = entry.content.match(PATH_REFERENCE_REGEX);
      if (!matches) continue;
      for (const candidate of matches) {
        if (matchesSecretPath(candidate, this._deps.secretPathDenyExtra ?? [])) {
          continue;
        }
        if (!fileExists(candidate)) {
          issues.push({
            id: entry.id,
            missingPath: candidate,
            bodyExcerpt: this._redactedBody(entry).slice(0, BODY_TRUNCATE),
          });
          break;
        }
      }
    }
    return issues;
  }

  private _detectEmbeddingFailed(entries: readonly MemoryEntry[]): EmbeddingFailedIssue[] {
    const issues: EmbeddingFailedIssue[] = [];
    for (const entry of entries) {
      if (entry.embedding === null) {
        issues.push({ id: entry.id, key: this._redactedKey(entry) });
      }
    }
    return issues;
  }

  private _detectDuplicates(entries: readonly MemoryEntry[]): DuplicateIssue[] {
    const issues: DuplicateIssue[] = [];
    const tokenSets = entries.map((e) => this._tokenSet(e.content));
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!;
      const tokensA = tokenSets[i]!;
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j]!;
        if (a.content === b.content) {
          const olderFirst = a.createdAt <= b.createdAt;
          issues.push({
            olderId: olderFirst ? a.id : b.id,
            newerId: olderFirst ? b.id : a.id,
            similarity: 1.0,
          });
          continue;
        }
        const sim = this._jaccard(tokensA, tokenSets[j]!);
        if (sim >= 0.9) {
          const olderFirst = a.createdAt <= b.createdAt;
          issues.push({
            olderId: olderFirst ? a.id : b.id,
            newerId: olderFirst ? b.id : a.id,
            similarity: sim,
          });
        }
      }
    }
    return issues;
  }

  private _defaultFileExists(relativePath: string): boolean {
    try {
      const abs = path.join(this._deps.workspaceRoot, relativePath);
      return fs.existsSync(abs);
    } catch {
      return false;
    }
  }

  private _redactedKey(entry: MemoryEntry): string {
    if (this._isSecretContent(entry.content)) {
      return "<redacted: secret-path>";
    }
    return this._truncate(entry.content, 80);
  }

  private _redactedBody(entry: MemoryEntry): string {
    if (this._isSecretContent(entry.content)) {
      return "<redacted: secret-path>";
    }
    return entry.content;
  }

  private _isSecretContent(content: string): boolean {
    const extras = this._deps.secretPathDenyExtra ?? [];
    const pathMatches = content.match(PATH_REFERENCE_REGEX);
    if (pathMatches?.some((m) => matchesSecretPath(m, extras))) return true;
    const tokenMatches = content.match(SECRET_TOKEN_REGEX);
    if (tokenMatches?.some((m) => matchesSecretPath(m, extras))) return true;
    return false;
  }

  private _tokenSet(text: string): Set<string> {
    const set = new Set<string>();
    for (const tok of text.toLowerCase().split(/\W+/)) {
      if (tok.length > 2) set.add(tok);
    }
    return set;
  }

  private _jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const t of a) {
      if (b.has(t)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private _truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, n - 3) + "...";
  }
}
