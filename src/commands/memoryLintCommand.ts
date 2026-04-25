import type { MemoryStore } from "../storage/MemoryStore.js";
import {
  MemoryHealthCheck,
  type MemoryHealthReport,
} from "../storage/MemoryHealthCheck.js";

export type MemoryLintMode = "default" | "dry-run" | "apply" | "help";

export interface MemoryLintArgs {
  readonly mode: MemoryLintMode;
  readonly limit?: number;
  readonly full: boolean;
}

export interface MemoryLintInputs {
  readonly memoryStore: MemoryStore;
  readonly workspaceRoot: string;
  readonly secretPathDenyExtra?: readonly string[];
  readonly embeddingEnabled?: boolean;
}

export interface MemoryLintResult {
  readonly mode: MemoryLintMode;
  readonly message: string;
  readonly report?: MemoryHealthReport;
  readonly reportPath?: string;
}

const APPLY_NOT_SUPPORTED =
  "/memory lint --apply is not yet supported in v0.5.0.\n" +
  "Use the report at .gemma-code/memory-health.md to identify entries to clean up,\n" +
  "then use a future /memory prune command (planned for v0.5.0) or manually\n" +
  "manipulate the memory store via /memory <subcommand>.";

const HELP_TEXT = [
  "## /memory lint",
  "",
  "Scan the semantic memory store for stale entries, broken file path",
  "references, embedding failures, and duplicates. Report-only.",
  "",
  "**Flags**",
  "",
  "- `--dry-run` -- alias for the default behavior; no destructive action.",
  "- `--apply` -- reserved for future destructive cleanup. Currently returns",
  "  an explanatory error pointing at `/memory prune`.",
  "- `--full` -- scan every entry instead of the most recent 1000.",
  "- `--limit=N` -- scan the most recent N entries.",
  "- `--help` -- show this help.",
].join("\n");

/** Parse the slash-command argument string into a typed mode + scan options. */
export function parseMemoryLintArgs(args: string): MemoryLintArgs {
  const tokens = args.split(/\s+/).filter(Boolean);
  let mode: MemoryLintMode = "default";
  let limit: number | undefined;
  let full = false;

  for (const tok of tokens) {
    if (tok === "--dry-run") {
      mode = mode === "default" ? "dry-run" : mode;
      continue;
    }
    if (tok === "--apply") {
      mode = "apply";
      continue;
    }
    if (tok === "--help" || tok === "-h") {
      mode = "help";
      continue;
    }
    if (tok === "--full") {
      full = true;
      continue;
    }
    const limitMatch = /^--limit=(\d+)$/.exec(tok);
    if (limitMatch) {
      limit = Math.max(1, Math.min(100000, Number(limitMatch[1])));
    }
  }

  return { mode, limit, full };
}

/**
 * Execute `/memory lint` with the parsed args. Always non-destructive --
 * `--apply` is intentionally rejected with a structured error so callers
 * can predictably grep for the upcoming `/memory prune` command.
 */
export async function runMemoryLint(
  args: MemoryLintArgs,
  inputs: MemoryLintInputs,
): Promise<MemoryLintResult> {
  if (args.mode === "help") {
    return { mode: "help", message: HELP_TEXT };
  }

  if (args.mode === "apply") {
    return { mode: "apply", message: APPLY_NOT_SUPPORTED };
  }

  const check = new MemoryHealthCheck({
    memoryStore: inputs.memoryStore,
    workspaceRoot: inputs.workspaceRoot,
    secretPathDenyExtra: inputs.secretPathDenyExtra,
    embeddingEnabled: inputs.embeddingEnabled,
  });

  const report = await check.run({ limit: args.limit, full: args.full });
  const reportPath = check.writeReportToDisk(report);
  const message = `Memory health report written to ${relPath(
    inputs.workspaceRoot,
    reportPath,
  )} (${
    report.issues.stale.length +
    report.issues.brokenPath.length +
    report.issues.embeddingFailed.length +
    report.issues.duplicate.length
  } issues found).`;

  return { mode: args.mode, message, report, reportPath };
}

function relPath(root: string, abs: string): string {
  if (abs.startsWith(root)) {
    return abs.slice(root.length).replace(/^[\\/]/, "");
  }
  return abs;
}
