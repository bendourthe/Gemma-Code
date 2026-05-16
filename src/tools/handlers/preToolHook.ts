/**
 * v0.8.0 Phase 5 sub-task 5.7 (item E5) -- pre-tool command compressor.
 *
 * Wraps the raw stdout of common dev commands into a shorter, model-friendly
 * summary before the result is returned to AgentLoop. The transformation is
 * lossless for the *important* lines (failures, error context, summary):
 *
 *   - `npm test` / `vitest` / `jest` / `pytest` -- keep PASS/FAIL summary +
 *     first 10 error / FAIL lines + the last 20 lines (drop test names that
 *     all passed)
 *   - `git diff`                                -- keep the file summary plus
 *     the first 30 lines of each per-file hunk
 *   - `cargo test`                              -- keep the summary line plus
 *     every `test result:` and `FAILED` line
 *   - `npm install` / `pnpm install` / `yarn`   -- keep the summary line only
 *
 * Stderr is always preserved verbatim so genuine error messages survive the
 * compression pass. Output that does not match any pattern is returned
 * unchanged. Compression is keyed to the *first* token of the command, the
 * sub-token (e.g. `test`, `install`), and a substring fallback for tools
 * invoked through `npm run` / `pnpm exec`.
 */

import * as path from "path";

export interface CompressedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
  readonly compressionRatio: number;
}

export interface CompressionInput {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
}

/** Compute the output bytes reduction vs. the original input. */
function ratio(before: string, after: string): number {
  if (before.length === 0) return 0;
  const saved = Math.max(0, before.length - after.length);
  return saved / before.length;
}

function trim(text: string): string {
  return text.replace(/[\r\n]+$/, "");
}

function tail(text: string, n: number): string[] {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n));
}

function head(text: string, n: number): string[] {
  return text.split(/\r?\n/).slice(0, n);
}

/** Classify the command and return a key controlling the compressor. */
export function classifyCommand(command: string): string | null {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return null;
  if (/\b(vitest|jest|pytest)\b/.test(normalized)) return "test";
  if (/\bcargo\s+test\b/.test(normalized)) return "cargo-test";
  if (/\bnpm\s+(run\s+)?(test|t|jest)/.test(normalized)) return "test";
  if (/\bpnpm\s+(run\s+)?(test|t|jest)/.test(normalized)) return "test";
  if (/\byarn\s+(run\s+)?test/.test(normalized)) return "test";
  if (/\bgit\s+diff\b/.test(normalized)) return "git-diff";
  if (/\b(npm|pnpm|yarn)\s+install\b/.test(normalized)) return "install";
  if (/\b(npm|pnpm|yarn)\s+ci\b/.test(normalized)) return "install";
  return null;
}

function compressTestOutput(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const failureLines: string[] = [];
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (/(FAIL|Error|✘|×|✕|×|\bfailed\b)/.test(line)) {
      failureLines.push(line);
      if (failureLines.length >= 50) break;
    }
    if (
      /(Tests?:|Suites:|Time:|Tests run|Snapshots:|passed|failed|coverage)/i.test(line)
    ) {
      summaryLines.push(line);
    }
  }
  const lastN = tail(stdout, 20);
  const result: string[] = [];
  if (failureLines.length > 0) {
    result.push("=== Failures (first 10) ===");
    result.push(...failureLines.slice(0, 10));
  }
  if (summaryLines.length > 0) {
    result.push("=== Summary ===");
    result.push(...summaryLines.slice(-12));
  }
  result.push("=== Tail (last 20) ===");
  result.push(...lastN);
  return result.join("\n");
}

function compressCargoTestOutput(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/test result:|FAILED|panicked|failures:/.test(line)) out.push(line);
  }
  if (out.length === 0) return tail(stdout, 20).join("\n");
  return out.join("\n");
}

function compressGitDiffOutput(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const filesIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("diff --git ")) filesIdx.push(i);
  }
  if (filesIdx.length === 0) return stdout;
  const out: string[] = [];
  for (let i = 0; i < filesIdx.length; i++) {
    const start = filesIdx[i]!;
    const end = i + 1 < filesIdx.length ? filesIdx[i + 1]! : lines.length;
    const fileBlock = lines.slice(start, Math.min(end, start + 30));
    out.push(...fileBlock);
    if (end > start + 30) {
      out.push(`... (${end - start - 30} more line(s) in ${pathFromDiffLine(lines[start] ?? "")})`);
    }
  }
  return out.join("\n");
}

function pathFromDiffLine(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+?)$/.exec(line);
  if (!match) return "(unknown)";
  return path.basename(match[2] ?? match[1] ?? "(unknown)");
}

function compressInstallOutput(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const summary = lines.filter((line) =>
    /(added|removed|changed|audited|packages|vulnerabilities|deprecated)/i.test(line),
  );
  if (summary.length === 0) return tail(stdout, 5).join("\n");
  return summary.slice(-10).join("\n");
}

/** Apply the compressor that matches the given command, if any. */
export function compressToolOutput(input: CompressionInput): CompressedOutput {
  const cls = classifyCommand(input.command);
  if (!cls) {
    return {
      stdout: input.stdout,
      stderr: input.stderr,
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      compressionRatio: 0,
    };
  }
  const before = input.stdout;
  let after: string;
  switch (cls) {
    case "test":
      after = compressTestOutput(input.stdout);
      break;
    case "cargo-test":
      after = compressCargoTestOutput(input.stdout);
      break;
    case "git-diff":
      after = compressGitDiffOutput(input.stdout);
      break;
    case "install":
      after = compressInstallOutput(input.stdout);
      break;
    default:
      after = input.stdout;
  }
  return {
    stdout: trim(after),
    stderr: input.stderr,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    compressionRatio: ratio(before, after),
  };
}

export const _internal = { compressTestOutput, compressGitDiffOutput, compressInstallOutput, compressCargoTestOutput, head, tail };
