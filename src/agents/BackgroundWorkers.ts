import { spawn } from "child_process";
import { existsSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { CurationLoop, CuratorManifest } from "../skills/CurationLoop.js";
import { describeManifest } from "../skills/CurationLoop.js";
import type { ReflectJob, ReflectManifest, HardwareTier } from "../storage/ReflectJob.js";
import { shouldRunReflectJob } from "../storage/ReflectJob.js";
import { formatForLog } from "../utils/errors.js";
import { getLogger } from "../utils/logger.js";

/**
 * v0.7.0 Phase 7 (C34) -- deterministic background workers.
 *
 * Both workers follow the verification-sub-agent trigger pattern (post-N
 * file edits) but bypass the LLM: they spawn an external CLI and report the
 * parsed output as a chat message. Tests reach into the `runner` injection
 * to avoid spawning real processes.
 */

export interface WorkerRunResult {
  readonly success: boolean;
  readonly output: string;
  readonly toolCallCount: number;
  readonly error?: string;
}

export type WorkerCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const defaultRunner: WorkerCommandRunner = (command, args, cwd) => {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr + formatForLog(err), exitCode: 1 });
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
};

function resolveCwd(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0]!.uri.fsPath;
  }
  return process.cwd();
}

// Build-output is CommonJS (no `type: module` in package.json). `__dirname`
// is therefore available at runtime; declare it for the type-checker.
declare const __dirname: string;

/**
 * Locate the bundled `bin/gemma-check.mjs` script. Resolved relative to the
 * compiled extension layout (`out/agents/BackgroundWorkers.js` -> repo root
 * -> bin). Returns null when the file does not exist (e.g., a malformed
 * install).
 */
function findGemmaCheckScript(): string | null {
  // The compiled file lives at <ext>/out/agents/BackgroundWorkers.js, so the
  // repo / extension root is two levels up.
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  const candidates = [
    path.resolve(here, "..", "..", "bin", "gemma-check.mjs"),
    path.resolve(here, "..", "..", "..", "bin", "gemma-check.mjs"),
    path.resolve(process.cwd(), "bin", "gemma-check.mjs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Run `gemma-check --json` on the changed files and summarize findings for a
 * chat message. The runner is injectable for tests. Returns an empty-output
 * success when no findings are emitted (so callers can suppress the chat
 * surface).
 */
export async function runAuditWorker(
  modifiedFiles: readonly string[],
  options: {
    runner?: WorkerCommandRunner;
    scriptPath?: string | null;
    cwd?: string;
  } = {},
): Promise<WorkerRunResult> {
  if (modifiedFiles.length === 0) {
    return { success: true, output: "", toolCallCount: 0 };
  }

  const runner = options.runner ?? defaultRunner;
  const script = options.scriptPath !== undefined ? options.scriptPath : findGemmaCheckScript();
  if (!script) {
    return {
      success: false,
      output: "",
      toolCallCount: 0,
      error: "gemma-check script not found; install gemma-code with bin/gemma-check.mjs available.",
    };
  }

  const cwd = options.cwd ?? resolveCwd();
  const args = ["--json", ...modifiedFiles];

  try {
    const { stdout, stderr, exitCode } = await runner(process.execPath, [script, ...args], cwd);
    const parsed = parseGemmaCheckJson(stdout);
    const findings = parsed?.findings ?? [];

    if (findings.length === 0 && exitCode === 0) {
      return { success: true, output: "", toolCallCount: modifiedFiles.length };
    }

    const summary = formatAuditFindings(findings, modifiedFiles, exitCode, stderr);
    return { success: exitCode <= 1, output: summary, toolCallCount: modifiedFiles.length };
  } catch (err) {
    return {
      success: false,
      output: "",
      toolCallCount: modifiedFiles.length,
      error: formatForLog(err),
    };
  }
}

/**
 * Run `vitest --coverage --json` scoped to the test files matching the
 * changed source files. Reports uncovered branches in the changed lines.
 */
export async function runTestgapsWorker(
  modifiedFiles: readonly string[],
  options: {
    runner?: WorkerCommandRunner;
    cwd?: string;
  } = {},
): Promise<WorkerRunResult> {
  const sourceFiles = modifiedFiles.filter((f) => looksLikeSourceFile(f));
  if (sourceFiles.length === 0) {
    return { success: true, output: "", toolCallCount: 0 };
  }

  const runner = options.runner ?? defaultRunner;
  const cwd = options.cwd ?? resolveCwd();
  const testFiles = sourceFiles
    .map((src) => candidateTestFile(src))
    .filter((f): f is string => f !== null);

  if (testFiles.length === 0) {
    return {
      success: true,
      output: `### Test Gaps Worker\n\nNo matching test files found for: ${sourceFiles.join(", ")}.`,
      toolCallCount: sourceFiles.length,
    };
  }

  try {
    const args = [
      "vitest",
      "run",
      "--coverage",
      "--reporter=json",
      ...testFiles,
    ];
    const { stdout, stderr, exitCode } = await runner("npx", args, cwd);
    const summary = formatTestgapsOutput(stdout, stderr, exitCode, testFiles);
    return { success: exitCode === 0, output: summary, toolCallCount: testFiles.length };
  } catch (err) {
    return {
      success: false,
      output: "",
      toolCallCount: testFiles.length,
      error: formatForLog(err),
    };
  }
}

/**
 * v0.8.0 Phase 5 sub-task 5.2 -- curator background worker.
 *
 * Runs the dual-loop `CurationLoop.dryRun()`, writes the manifest, and emits a
 * chat-friendly `[Curator Report]` body. Unlike audit / testgaps which spawn
 * external CLIs, the curator runs entirely in-process: the manifest write
 * itself is the side-effect under test.
 */
export async function runCuratorWorker(
  loop: CurationLoop | null,
): Promise<WorkerRunResult> {
  if (!loop) {
    return {
      success: false,
      output: "",
      toolCallCount: 0,
      error: "Curator loop not initialized; set gemma-code.workers.curator.enabled to true to enable.",
    };
  }
  try {
    const manifest = await loop.dryRun();
    return {
      success: true,
      output: formatCuratorManifest(manifest),
      toolCallCount: manifest.actions.length,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      toolCallCount: 0,
      error: formatForLog(err),
    };
  }
}

/**
 * v0.9.0 Phase 2.5 (from v0.8.0 known-gaps 10.O.U) -- reflect background
 * worker.
 *
 * Runs `ReflectJob.dryRun()` when the hardware tier supports lesson
 * generation and the configured cadence gate has elapsed. The worker
 * never applies the manifest automatically; the operator must run
 * `/reflect apply <id>` after reviewing the proposed lessons.
 */
export interface ReflectWorkerCadenceState {
  /** Epoch ms of the most recent run for cadence-gating. `0` means never. */
  readonly lastRunAt: number;
}

export interface RunReflectWorkerOptions {
  readonly cadenceMs?: number;
  readonly hardwareTier?: HardwareTier;
  /** Read + advance the cadence cursor; defaults to in-memory state. */
  readonly cadence?: {
    read(): ReflectWorkerCadenceState;
    write(state: ReflectWorkerCadenceState): void;
  };
  readonly now?: () => number;
}

const DEFAULT_REFLECT_CADENCE_MS = 24 * 60 * 60 * 1000;

export async function runReflectWorker(
  job: ReflectJob | null,
  options: RunReflectWorkerOptions = {},
): Promise<WorkerRunResult> {
  if (!job) {
    return {
      success: false,
      output: "",
      toolCallCount: 0,
      error:
        "Reflect job not initialized; set gemma-code.workers.reflect.enabled to true on a balanced/full tier to enable.",
    };
  }
  const tier = options.hardwareTier ?? "balanced";
  if (!shouldRunReflectJob(tier)) {
    return {
      success: true,
      output: `### Reflect Worker\n\nSkipped: hardware tier '${tier}' does not run reflect-lesson generation.`,
      toolCallCount: 0,
    };
  }
  const cadenceMs = options.cadenceMs ?? DEFAULT_REFLECT_CADENCE_MS;
  const now = options.now ?? Date.now;
  const cadence = options.cadence ?? null;
  const lastRunAt = cadence ? cadence.read().lastRunAt : 0;
  if (cadenceMs > 0 && lastRunAt > 0 && now() - lastRunAt < cadenceMs) {
    const minutesLeft = Math.ceil((cadenceMs - (now() - lastRunAt)) / 60000);
    return {
      success: true,
      output: `### Reflect Worker\n\nSkipped: next eligible run in ~${minutesLeft} min (cadence ${cadenceMs} ms).`,
      toolCallCount: 0,
    };
  }
  try {
    const manifest = await job.dryRun();
    if (cadence) cadence.write({ lastRunAt: now() });
    return {
      success: true,
      output: formatReflectManifest(manifest),
      toolCallCount: manifest.clusters.length,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      toolCallCount: 0,
      error: formatForLog(err),
    };
  }
}

export function formatReflectManifest(manifest: ReflectManifest): string {
  if (manifest.clusters.length === 0) {
    return `### Reflect Worker\n\nDry-run \`${manifest.id}\` found 0 recurring action clusters.`;
  }
  const head = manifest.lessons.length > 0
    ? `Dry-run \`${manifest.id}\` proposed ${manifest.lessons.length} lesson(s) across ${manifest.clusters.length} cluster(s):`
    : `Dry-run \`${manifest.id}\` clustered ${manifest.clusters.length} action group(s) but produced no lessons (tier=${manifest.hardwareTier}).`;
  const lines: string[] = [`### Reflect Worker`, ``, head, ``];
  for (const cluster of manifest.clusters.slice(0, 10)) {
    lines.push(`- \`${cluster.actionKey}\` -- ${cluster.occurrences} occurrences`);
  }
  if (manifest.clusters.length > 10) {
    lines.push(`- ... and ${manifest.clusters.length - 10} more cluster(s).`);
  }
  lines.push("");
  lines.push(`Apply with \`/reflect apply ${manifest.id}\` after reviewing \`${manifest.manifestPath}\`.`);
  return lines.join("\n");
}

export function formatCuratorManifest(manifest: CuratorManifest): string {
  if (manifest.actions.length === 0) {
    return `### Curator Worker\n\nDry-run \`${manifest.id}\` proposed 0 actions.`;
  }
  const summary = describeManifest(manifest);
  const lines: string[] = [
    `### Curator Worker`,
    ``,
    `Dry-run \`${manifest.id}\` proposed ${manifest.actions.length} action(s) (${summary}):`,
    ``,
  ];
  for (const action of manifest.actions.slice(0, 20)) {
    lines.push(`- **${action.type}** \`${action.target}\` -- ${action.rationale}`);
  }
  if (manifest.actions.length > 20) {
    lines.push(`- ... and ${manifest.actions.length - 20} more.`);
  }
  lines.push(``);
  lines.push(`Apply with \`/curate --apply ${manifest.id}\` after reviewing \`${manifest.manifestPath}\`.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

interface GemmaCheckFinding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly severity?: string;
}

interface GemmaCheckJsonOutput {
  readonly findings: GemmaCheckFinding[];
}

export function parseGemmaCheckJson(stdout: string): GemmaCheckJsonOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) return { findings: [] };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && Array.isArray(parsed.findings)) {
      return parsed as GemmaCheckJsonOutput;
    }
    return { findings: [] };
  } catch (err) {
    getLogger().debug("[BackgroundWorkers] gemma-check JSON parse failed:", formatForLog(err));
    return null;
  }
}

export function formatAuditFindings(
  findings: readonly GemmaCheckFinding[],
  modifiedFiles: readonly string[],
  exitCode: number,
  stderr: string,
): string {
  if (findings.length === 0) {
    if (exitCode === 0) {
      return `### Audit Worker\n\ngemma-check clean on ${modifiedFiles.length} file(s).`;
    }
    const stderrTrim = stderr.trim();
    return `### Audit Worker\n\ngemma-check exited ${exitCode} with no parseable findings.${stderrTrim ? `\n\n\`\`\`\n${stderrTrim}\n\`\`\`` : ""}`;
  }

  const lines: string[] = [`### Audit Worker`, ``, `Found ${findings.length} finding(s) across ${new Set(findings.map((f) => f.file)).size} file(s):`, ``];
  for (const f of findings) {
    const sev = f.severity ? ` [${f.severity}]` : "";
    lines.push(`- **${f.rule}**${sev} \`${f.file}:${f.line}\` -- ${f.message}`);
  }
  return lines.join("\n");
}

export function formatTestgapsOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
  testFiles: readonly string[],
): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    const stderrTrim = stderr.trim();
    return `### Test Gaps Worker\n\nvitest exited ${exitCode} (no JSON output)${stderrTrim ? `\n\n\`\`\`\n${stderrTrim.slice(0, 800)}\n\`\`\`` : ""}.`;
  }

  let report: unknown;
  try {
    report = JSON.parse(trimmed);
  } catch {
    return `### Test Gaps Worker\n\nUnable to parse vitest JSON output (exit ${exitCode}). Test files scanned: ${testFiles.length}.`;
  }

  const summary = summarizeVitestJson(report);
  return `### Test Gaps Worker\n\n${summary}`;
}

function summarizeVitestJson(report: unknown): string {
  if (typeof report !== "object" || report === null) {
    return "Empty test report.";
  }

  const obj = report as Record<string, unknown>;
  const numTotal = numericField(obj, "numTotalTests");
  const numPassed = numericField(obj, "numPassedTests");
  const numFailed = numericField(obj, "numFailedTests");
  const lines: string[] = [];
  lines.push(`Tests: ${numPassed}/${numTotal} passed, ${numFailed} failed.`);

  const coverage = obj["coverageMap"] ?? obj["coverage"];
  if (coverage && typeof coverage === "object") {
    const uncoveredLines: string[] = [];
    for (const [file, fileCov] of Object.entries(coverage as Record<string, unknown>)) {
      if (typeof fileCov !== "object" || fileCov === null) continue;
      const branches = (fileCov as Record<string, unknown>)["b"] ?? (fileCov as Record<string, unknown>)["branches"];
      if (!branches || typeof branches !== "object") continue;
      const uncoveredCount = countUncoveredBranches(branches);
      if (uncoveredCount > 0) {
        uncoveredLines.push(`- \`${file}\`: ${uncoveredCount} uncovered branch(es)`);
      }
    }
    if (uncoveredLines.length > 0) {
      lines.push("", "Uncovered branches:");
      lines.push(...uncoveredLines.slice(0, 20));
      if (uncoveredLines.length > 20) {
        lines.push(`- ... and ${uncoveredLines.length - 20} more file(s).`);
      }
    }
  }
  return lines.join("\n");
}

function countUncoveredBranches(branches: unknown): number {
  if (!branches || typeof branches !== "object") return 0;
  let uncovered = 0;
  for (const counts of Object.values(branches as Record<string, unknown>)) {
    if (!Array.isArray(counts)) continue;
    for (const c of counts) {
      if (c === 0) uncovered++;
    }
  }
  return uncovered;
}

function numericField(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === "number" ? v : 0;
}

const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function looksLikeSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!SOURCE_FILE_EXTENSIONS.has(ext)) return false;
  return !/(?:^|[\\/])tests?[\\/]/.test(filePath) && !/\.test\.[tj]sx?$/.test(filePath);
}

/**
 * Map a source file to its conventional test path. v0.7.0 layout convention:
 * `src/foo/bar.ts` -> `tests/unit/foo/bar.test.ts`. Returns null when no
 * matching file exists on disk.
 */
function candidateTestFile(sourceFile: string): string | null {
  const normalized = sourceFile.replace(/\\/g, "/");
  const ext = path.extname(normalized);
  const stem = normalized.slice(0, normalized.length - ext.length);

  const candidates: string[] = [];
  if (stem.startsWith("src/")) {
    const tail = stem.slice("src/".length);
    candidates.push(`tests/unit/${tail}.test${ext}`);
    candidates.push(`tests/integration/${tail}.test${ext}`);
  }
  candidates.push(`${stem}.test${ext}`);
  candidates.push(`${stem}.spec${ext}`);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
