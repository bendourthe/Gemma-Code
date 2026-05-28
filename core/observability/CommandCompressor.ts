/**
 * v1.2.0 Phase 2 -- Coding-pillar command-output compressor.
 *
 * Wraps every Coding-pillar Bash tool invocation so the local model sees a
 * compressed view of stdout (filter / group / truncate / dedupe) while the
 * raw output is preserved on disk via tee-on-failure. The four strategies
 * are pure `(rawOutput, command) => string` functions selected per command
 * by `CommandStrategyRegistry`; unknown commands pass through unchanged.
 *
 * Companion to the v0.8.0 `src/tools/handlers/preToolHook.ts` compressor,
 * which retains the older test-summary / git-diff / install-summary
 * heuristics. The new module supersedes the legacy hook as the primary
 * compression layer in `src/tools/handlers/terminal.ts`; the legacy module
 * stays addressable for external callers but no longer gates the terminal
 * tool's stdout path.
 *
 * No telemetry path exists; per `docs/v1.2.0/plans/adoption-ecosystem-2026-05.md`
 * Section 9.4 N4, Nexus is no-telemetry by construction.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { nexusHome } from "../storage/paths.js";

export type StrategyName =
  | "filter"
  | "group"
  | "truncate"
  | "dedupe"
  | "passthrough";

export interface CompressedOutput {
  readonly rendered: string;
  readonly originalBytes: number;
  readonly compressedBytes: number;
  readonly strategyApplied: StrategyName;
  readonly teePath: string | null;
}

export interface StrategyDescriptor {
  readonly primary: StrategyName;
}

export type StrategyImpl = (rawOutput: string, command: string) => string;

/**
 * Default per-command registry. Key matches the first whitespace-separated
 * token of the command, lowercased. Sub-command refinements (e.g. `npm test`
 * routes to dedupe rather than group) are handled in `classify`.
 */
export const DEFAULT_REGISTRY: Readonly<Record<string, StrategyDescriptor>> = {
  git: { primary: "filter" },
  grep: { primary: "filter" },
  ls: { primary: "filter" },
  cat: { primary: "passthrough" },
  npm: { primary: "group" },
  pnpm: { primary: "group" },
  yarn: { primary: "group" },
  cargo: { primary: "group" },
  pytest: { primary: "dedupe" },
  vitest: { primary: "dedupe" },
  jest: { primary: "dedupe" },
  eslint: { primary: "filter" },
};

/** Truncate threshold in bytes; output above this size is line-elided. */
export const DEFAULT_TRUNCATE_BYTES = 10 * 1024;

/** Lines elided beyond this count cause a tee even on successful exit. */
export const DEFAULT_SUCCESS_TEE_LINE_DELTA = 100;

/** Retention horizon for tee files at sidecar startup. */
export const DEFAULT_TEE_RETENTION_DAYS = 14;

/** Truncate keep-window: first N lines + last M lines. */
const TRUNCATE_HEAD_LINES = 200;
const TRUNCATE_TAIL_LINES = 50;

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Classify a command to its strategy descriptor. Returns `null` when the
 * command does not match any registry entry; callers then apply
 * passthrough.
 */
export function classify(
  command: string,
  registry: Readonly<Record<string, StrategyDescriptor>> = DEFAULT_REGISTRY,
): StrategyDescriptor | null {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return null;

  // Sub-command refinements: test runners invoked through a package manager.
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?(test|t|jest|vitest|pytest)\b/.test(normalized)) {
    return { primary: "dedupe" };
  }
  if (/\bcargo\s+test\b/.test(normalized)) {
    return { primary: "dedupe" };
  }
  // npx vitest / npx jest / npx pytest.
  if (/\bnpx\s+(vitest|jest|pytest)\b/.test(normalized)) {
    return { primary: "dedupe" };
  }

  const firstToken = normalized.split(/\s+/)[0] ?? "";
  return registry[firstToken] ?? null;
}

/**
 * Filter strategy: command-aware noise removal.
 * - `git status` / `git diff` / `git log`: keep modified-file lines; drop
 *   progress / ANSI / hint lines.
 * - `grep -r`: keep match lines; drop "Binary file ... matches" without a
 *   path component.
 * - `ls`: drop totals and blank lines.
 * - `eslint`: keep error / warning lines; drop empty separators.
 */
export function filterStrategy(rawOutput: string, command: string): string {
  const normalized = command.trim().toLowerCase();
  const lines = splitLines(stripAnsi(rawOutput));
  const first = normalized.split(/\s+/)[0] ?? "";

  if (first === "git") {
    const kept = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\(use\b/i.test(trimmed)) return false;
      if (/^hint:/i.test(trimmed)) return false;
      if (/^on branch /i.test(trimmed)) return false;
      if (/^your branch /i.test(trimmed)) return false;
      if (/^untracked files:$/i.test(trimmed)) return false;
      if (/^changes (not staged|to be committed):$/i.test(trimmed)) return false;
      if (/^nothing to commit/i.test(trimmed)) return false;
      return true;
    });
    return kept.join("\n");
  }

  if (first === "grep") {
    const kept = lines.filter((line) => {
      if (!line) return false;
      // Drop "Binary file ... matches" when no path component is present.
      if (/^Binary file\s+matches$/i.test(line.trim())) return false;
      return true;
    });
    return kept.join("\n");
  }

  if (first === "ls") {
    const kept = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^total\s+\d+/i.test(trimmed)) return false;
      return true;
    });
    return kept.join("\n");
  }

  if (first === "eslint") {
    const kept = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^[-=]{3,}$/.test(trimmed)) return false;
      return true;
    });
    return kept.join("\n");
  }

  // Generic fallback: drop blank lines and ANSI artifacts.
  return lines.filter((l) => l.trim().length > 0).join("\n");
}

/**
 * Group strategy: collapse repetitive progress lines from package managers
 * and build systems into a single per-entity summary line.
 *
 * - `npm install` / `pnpm install` / `yarn install`: count `added`,
 *   `removed`, `changed`, `audited`, `packages`, `vulnerabilities`
 *   summary lines; drop per-package progress.
 * - `cargo build`: collapse `Compiling <crate>` runs by emitting one
 *   `Compiling <crate> (xN)` line per crate.
 * - `npm run build` / similar: collapse repeated identical informational
 *   lines.
 */
export function groupStrategy(rawOutput: string, command: string): string {
  const normalized = command.trim().toLowerCase();
  const lines = splitLines(stripAnsi(rawOutput));
  const first = normalized.split(/\s+/)[0] ?? "";

  if (first === "cargo") {
    const compileCounts = new Map<string, number>();
    const other: string[] = [];
    for (const line of lines) {
      const m = /^\s*Compiling\s+(\S+)/i.exec(line);
      if (m) {
        const crate = m[1] ?? "";
        compileCounts.set(crate, (compileCounts.get(crate) ?? 0) + 1);
        continue;
      }
      if (/^\s*\d+\s+warnings? emitted/i.test(line)) {
        other.push(line);
        continue;
      }
      other.push(line);
    }
    const compileLines = [...compileCounts.entries()].map(([crate, n]) =>
      n === 1 ? `Compiling ${crate}` : `Compiling ${crate} (x${n})`,
    );
    return [...compileLines, ...other].filter((l) => l.trim().length > 0).join("\n");
  }

  if (first === "npm" || first === "pnpm" || first === "yarn") {
    const summary = lines.filter((line) =>
      /(added|removed|changed|audited|packages|vulnerabilities|deprecated)/i.test(line),
    );
    if (summary.length === 0) {
      // No summary present; fall back to last 5 lines.
      return lines.slice(Math.max(0, lines.length - 5)).join("\n");
    }
    return summary.slice(-10).join("\n");
  }

  // Generic fallback: identical-adjacent collapse.
  const out: string[] = [];
  let last = "";
  let lastCount = 0;
  for (const line of lines) {
    if (line === last) {
      lastCount += 1;
      continue;
    }
    if (lastCount > 1) {
      out[out.length - 1] = `${last} (x${lastCount})`;
    }
    out.push(line);
    last = line;
    lastCount = 1;
  }
  if (lastCount > 1) {
    out[out.length - 1] = `${last} (x${lastCount})`;
  }
  return out.join("\n");
}

/**
 * Truncate strategy: keep the first `TRUNCATE_HEAD_LINES` and last
 * `TRUNCATE_TAIL_LINES` lines of `rawOutput`. The elision separator is
 * `[... N lines elided; see tee at <path> ...]`; `<path>` is filled in by
 * the caller after the tee file is written.
 */
export function truncateStrategy(rawOutput: string, _command: string): string {
  const lines = splitLines(rawOutput);
  if (lines.length <= TRUNCATE_HEAD_LINES + TRUNCATE_TAIL_LINES) {
    return rawOutput;
  }
  const head = lines.slice(0, TRUNCATE_HEAD_LINES);
  const tail = lines.slice(lines.length - TRUNCATE_TAIL_LINES);
  const elided = lines.length - TRUNCATE_HEAD_LINES - TRUNCATE_TAIL_LINES;
  return [
    ...head,
    `[... ${elided} lines elided; see tee at <pending> ...]`,
    ...tail,
  ].join("\n");
}

/**
 * Dedupe strategy: collapse repeated identical lines into a single line
 * with an `(xN)` suffix. Tuned for `pytest` / `vitest` / `jest` output
 * where hundreds of `PASSED tests/x.test.ts::test_name` lines repeat.
 */
export function dedupeStrategy(rawOutput: string, _command: string): string {
  const lines = splitLines(rawOutput);
  if (lines.length === 0) return rawOutput;
  type Run = { line: string; count: number };
  const runs: Run[] = [];
  for (const line of lines) {
    const tail = runs[runs.length - 1];
    if (tail && tail.line === line) {
      tail.count += 1;
    } else {
      runs.push({ line, count: 1 });
    }
  }
  return runs
    .map((r) => (r.count > 1 ? `${r.line} (x${r.count})` : r.line))
    .join("\n");
}

/**
 * Internal lookup of the strategy implementation by name.
 */
function applyStrategy(
  name: StrategyName,
  rawOutput: string,
  command: string,
): string {
  switch (name) {
    case "filter":
      return filterStrategy(rawOutput, command);
    case "group":
      return groupStrategy(rawOutput, command);
    case "truncate":
      return truncateStrategy(rawOutput, command);
    case "dedupe":
      return dedupeStrategy(rawOutput, command);
    case "passthrough":
      return rawOutput;
    default:
      return rawOutput;
  }
}

function slugifyCommand(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "command";
  return first.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "command";
}

function shortHash(command: string): string {
  return crypto.createHash("sha256").update(command).digest("hex").slice(0, 8);
}

function isoStamp(now: Date): string {
  // Windows path safety: no `:` in filenames.
  return now.toISOString().replace(/:/g, "-").replace(/\..+$/, "Z");
}

export interface CommandCompressorOptions {
  /** Override the per-command registry. */
  readonly registry?: Readonly<Record<string, StrategyDescriptor>>;
  /** Override the nexus-home resolution (used in tests). */
  readonly nexusHomeFn?: () => string;
  /** Override `Date.now()` (used in tests). */
  readonly nowFn?: () => Date;
  /** Threshold above which truncate is applied as a fallback. */
  readonly truncateBytes?: number;
  /** Lines elided beyond this count cause a tee on successful exits. */
  readonly successTeeLineDelta?: number;
  /** Retention horizon (days) for tee files. */
  readonly teeRetentionDays?: number;
}

export class CommandCompressor {
  private readonly _registry: Readonly<Record<string, StrategyDescriptor>>;
  private readonly _nexusHomeFn: () => string;
  private readonly _nowFn: () => Date;
  private readonly _truncateBytes: number;
  private readonly _successTeeLineDelta: number;
  private readonly _teeRetentionDays: number;

  constructor(opts: CommandCompressorOptions = {}) {
    this._registry = opts.registry ?? DEFAULT_REGISTRY;
    this._nexusHomeFn = opts.nexusHomeFn ?? (() => nexusHome(() => os.homedir()));
    this._nowFn = opts.nowFn ?? (() => new Date());
    this._truncateBytes = opts.truncateBytes ?? DEFAULT_TRUNCATE_BYTES;
    this._successTeeLineDelta =
      opts.successTeeLineDelta ?? DEFAULT_SUCCESS_TEE_LINE_DELTA;
    this._teeRetentionDays =
      opts.teeRetentionDays ?? DEFAULT_TEE_RETENTION_DAYS;
  }

  /** Resolve `<nexus-home>/logs/commands` for callers that need the dir. */
  public commandsLogsDir(): string {
    return path.join(this._nexusHomeFn(), "logs", "commands");
  }

  /**
   * Compress `rawOutput` for `command` given `exitCode`. The returned
   * `rendered` is what the model should see; `teePath` is set when raw
   * output has been preserved on disk (failure path, or success path
   * with truncate elision over the threshold).
   */
  public compress(
    command: string,
    rawOutput: string,
    exitCode: number,
  ): CompressedOutput {
    const originalBytes = Buffer.byteLength(rawOutput, "utf8");
    const descriptor = classify(command, this._registry);

    let strategyApplied: StrategyName = descriptor ? descriptor.primary : "passthrough";
    let rendered = descriptor
      ? applyStrategy(descriptor.primary, rawOutput, command)
      : rawOutput;

    // Fallback to truncate when post-primary output still exceeds the cap.
    let truncatedLineDelta = 0;
    if (Buffer.byteLength(rendered, "utf8") > this._truncateBytes) {
      const beforeLines = splitLines(rendered).length;
      rendered = truncateStrategy(rendered, command);
      const afterLines = splitLines(rendered).length;
      truncatedLineDelta = Math.max(0, beforeLines - afterLines);
      strategyApplied = "truncate";
    }

    // Always tee on failure; tee on success only if a meaningful truncation
    // elided more than `_successTeeLineDelta` lines.
    let teePath: string | null = null;
    const shouldTee =
      exitCode !== 0 ||
      (strategyApplied === "truncate" &&
        truncatedLineDelta > this._successTeeLineDelta);
    if (shouldTee) {
      try {
        teePath = this.tee(command, rawOutput);
        if (strategyApplied === "truncate") {
          rendered = rendered.replace("<pending>", teePath);
        }
      } catch {
        // Tee is best-effort: a failed write must not crash the agent loop.
        teePath = null;
      }
    }

    return {
      rendered,
      originalBytes,
      compressedBytes: Buffer.byteLength(rendered, "utf8"),
      strategyApplied,
      teePath,
    };
  }

  /**
   * Write `rawOutput` to `<nexus-home>/logs/commands/<ISO>-<slug>-<hash>.log`
   * and return the absolute path. Creates the directory on demand.
   */
  public tee(command: string, rawOutput: string): string {
    const dir = this.commandsLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${isoStamp(this._nowFn())}-${slugifyCommand(command)}-${shortHash(command)}.log`;
    const full = path.join(dir, filename);
    fs.writeFileSync(full, rawOutput, "utf8");
    return full;
  }

  /**
   * Delete tee files whose mtime is older than the retention horizon.
   * Returns the number of files removed. Safe to call at sidecar startup;
   * a missing directory is treated as zero files.
   */
  public pruneOldTees(): number {
    const dir = this.commandsLogsDir();
    if (!fs.existsSync(dir)) return 0;
    const cutoff =
      this._nowFn().getTime() - this._teeRetentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch {
        // Ignore entries that vanish mid-iteration.
      }
    }
    return removed;
  }
}
