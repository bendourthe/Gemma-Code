#!/usr/bin/env node
// v0.9.0 Phase 4 sub-task 4.1 -- cross-platform debug runner CLI.
//
// Reverse-engineered from OpenHuman's `scripts/debug/cli.sh` into pure Node so
// Gemma-Code's contributors do not need bash on Windows. The CLI dispatches to
// sibling runners (`unit.mjs`, `integration.mjs`, `golden.mjs`, `bench.mjs`)
// and exposes a `logs` sub-command that introspects the tee'd log files under
// `out/debug-logs/`.
//
// Usage:
//   npm run debug unit [pattern] [-t "<name>"] [--watch] [--verbose] [--head N | --tail N]
//   npm run debug integration ...
//   npm run debug golden ...
//   npm run debug bench ...
//   npm run debug logs list
//   npm run debug logs last [--verbose]
//   npm run debug logs <run-id> [--verbose]
//
// Each runner tees vitest's stdout + stderr to
// `out/debug-logs/<kind>-<ISO-ts>.log`, appends `# exit <code>` as the last
// line, and prints a summary block (full body under `--verbose`). Exit code
// matches the wrapped command.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream, readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const LOG_DIR = resolve(REPO_ROOT, "out", "debug-logs");

const HELP = `gemma-code debug runner

Usage:
  npm run debug <command> [args...]

Commands:
  unit [pattern] [-t "<name>"]      Run vitest unit suite with tee'd logs.
  integration [pattern] [-t "<n>"]  Run vitest integration suite.
  golden [pattern]                  Run the tests/integration/golden subset.
  bench [pattern]                   Run vitest benchmarks.
  logs list                         List recorded runs by mtime desc.
  logs last [--verbose]             Pretty-print the most recent run.
  logs <run-id> [--verbose]         Pretty-print a specific run.

Options:
  --watch          Forward --watch to vitest (unit / integration).
  --verbose        Show full vitest output (default: summary + failures only).
  --head N         Limit log output to first N lines (logs only).
  --tail N         Limit log output to last N lines (logs only).
  -t "<name>"      Forward -t name filter to vitest.

Logs land under out/debug-logs/ (in .gitignore).
`;

const KNOWN_RUNNERS = new Set(["unit", "integration", "golden", "bench"]);

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function isoTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isoFromFilename(name) {
  const dashIdx = name.indexOf("-");
  if (dashIdx < 0) return null;
  const tail = name.slice(dashIdx + 1).replace(/\.log$/, "");
  return tail;
}

function parsePositiveInt(raw) {
  if (raw === undefined || raw === null) return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDebugArgs(argv) {
  const out = {
    watch: false,
    verbose: false,
    head: null,
    tail: null,
    nameFilter: null,
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--watch") {
      out.watch = true;
      continue;
    }
    if (token === "--verbose") {
      out.verbose = true;
      continue;
    }
    if (token === "--head") {
      out.head = parsePositiveInt(argv[++i]);
      continue;
    }
    if (token.startsWith("--head=")) {
      out.head = parsePositiveInt(token.slice("--head=".length));
      continue;
    }
    if (token === "--tail") {
      out.tail = parsePositiveInt(argv[++i]);
      continue;
    }
    if (token.startsWith("--tail=")) {
      out.tail = parsePositiveInt(token.slice("--tail=".length));
      continue;
    }
    if (token === "-t") {
      out.nameFilter = argv[++i] ?? null;
      continue;
    }
    out.positional.push(token);
  }
  return out;
}

export function buildVitestArgs(kind, parsed) {
  const args = [];
  args.push("run");
  args.push("--config", "configs/vitest.config.ts");
  if (parsed.watch) args.push("--watch");
  if (parsed.nameFilter) {
    args.push("-t", parsed.nameFilter);
  }
  if (kind === "integration") {
    args.push("tests/integration");
  } else if (kind === "golden") {
    args.push("tests/integration/golden");
  } else if (kind === "unit") {
    args.push("tests/unit");
  }
  for (const token of parsed.positional) {
    args.push(token);
  }
  return args;
}

// Parses vitest output to extract a compact summary + failure blocks. The
// parser is intentionally lenient: any line whose prefix matches the known
// markers is grouped as part of the summary; FAIL blocks include 5 lines of
// trailing context.
export function summarizeVitestOutput(raw) {
  const lines = raw.split(/\r?\n/);
  const summary = [];
  const failures = [];
  let inFailure = false;
  let failureBuf = [];
  let contextRemaining = 0;

  for (const line of lines) {
    if (/^FAIL\s+/.test(line) || /\bFAIL\b\s+tests\//.test(line)) {
      if (inFailure && failureBuf.length > 0) {
        failures.push(failureBuf.join("\n"));
      }
      inFailure = true;
      failureBuf = [line];
      contextRemaining = 5;
      continue;
    }
    if (inFailure) {
      failureBuf.push(line);
      if (line.trim() === "" && contextRemaining > 0) {
        contextRemaining -= 1;
        if (contextRemaining === 0) {
          failures.push(failureBuf.join("\n"));
          inFailure = false;
          failureBuf = [];
        }
      }
      continue;
    }
    if (
      /^Test Files\s+/.test(line) ||
      /^Tests\s+/.test(line) ||
      /^Duration\s+/.test(line) ||
      /^Snapshots\s+/.test(line) ||
      /^\s*✓|^\s*✗|^\s*✓|^\s*✗/.test(line) === false &&
      /^\s*(PASS|FAIL|RUN|SKIP)\b/.test(line)
    ) {
      summary.push(line);
    }
  }
  if (inFailure && failureBuf.length > 0) {
    failures.push(failureBuf.join("\n"));
  }
  return { summary, failures };
}

async function runVitestKind(kind, rawArgs) {
  const parsed = parseDebugArgs(rawArgs);
  ensureLogDir();
  const ts = isoTimestamp();
  const logPath = join(LOG_DIR, `${kind}-${ts}.log`);
  const sink = createWriteStream(logPath, { flags: "w" });

  const args = buildVitestArgs(kind, parsed);
  const child = spawn("npx", ["vitest", ...args], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
  });

  const stdoutBuf = [];
  const stderrBuf = [];

  const teeStdout = new PassThrough();
  const teeStderr = new PassThrough();

  child.stdout.on("data", (chunk) => {
    stdoutBuf.push(chunk);
    sink.write(chunk);
    teeStdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrBuf.push(chunk);
    sink.write(chunk);
    teeStderr.write(chunk);
  });

  if (parsed.verbose) {
    teeStdout.pipe(process.stdout);
    teeStderr.pipe(process.stderr);
  } else {
    // drain to /dev/null equivalent
    teeStdout.resume();
    teeStderr.resume();
  }

  const exitCode = await new Promise((resolveCmd) => {
    child.on("exit", (code) => resolveCmd(code ?? 1));
    child.on("error", (err) => {
      process.stderr.write(`[debug:${kind}] spawn error: ${err.message}\n`);
      resolveCmd(1);
    });
  });

  sink.write(`\n# exit ${exitCode}\n`);
  await new Promise((res) => sink.end(res));

  if (!parsed.verbose) {
    const combined = Buffer.concat([...stdoutBuf, ...stderrBuf]).toString("utf8");
    const { summary, failures } = summarizeVitestOutput(combined);
    if (failures.length > 0) {
      process.stdout.write(failures.join("\n\n") + "\n\n");
    }
    if (summary.length > 0) {
      process.stdout.write(summary.join("\n") + "\n");
    }
    process.stdout.write(`# debug log: ${logPath}\n# exit ${exitCode}\n`);
  } else {
    process.stdout.write(`# debug log: ${logPath}\n# exit ${exitCode}\n`);
  }
  return exitCode;
}

export function listLogs() {
  if (!existsSync(LOG_DIR)) return [];
  const entries = readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"));
  const rows = entries
    .map((name) => {
      const full = join(LOG_DIR, name);
      const st = statSync(full);
      const dashIdx = name.indexOf("-");
      const kind = dashIdx >= 0 ? name.slice(0, dashIdx) : "?";
      const start = isoFromFilename(name) ?? "";
      const runId = name.replace(/\.log$/, "");
      let exit = "?";
      try {
        const body = readFileSync(full, "utf8");
        const m = body.match(/^# exit (-?\d+)\s*$/m);
        if (m) exit = m[1];
      } catch {
        // best-effort
      }
      return {
        runId,
        kind,
        start,
        size: st.size,
        mtimeMs: st.mtimeMs,
        exit,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows;
}

function formatLogTable(rows) {
  if (rows.length === 0) return "no logs under out/debug-logs/\n";
  const header = ["run-id", "kind", "start", "size", "exit"];
  const widths = header.map((h, i) => {
    const col = [h, ...rows.map((r) => String([r.runId, r.kind, r.start, r.size, r.exit][i]))];
    return col.reduce((m, s) => Math.max(m, s.length), 0);
  });
  const fmt = (cells) =>
    cells
      .map((c, i) => String(c).padEnd(widths[i], " "))
      .join("  ");
  const out = [fmt(header), fmt(widths.map((w) => "-".repeat(w)))];
  for (const r of rows) {
    out.push(fmt([r.runId, r.kind, r.start, r.size, r.exit]));
  }
  return out.join("\n") + "\n";
}

function findLogPath(runId) {
  const direct = join(LOG_DIR, `${runId}.log`);
  if (existsSync(direct)) return direct;
  // permit shorter aliases: search for a file that starts with runId
  if (!existsSync(LOG_DIR)) return null;
  const matches = readdirSync(LOG_DIR).filter((f) => f.startsWith(runId) && f.endsWith(".log"));
  if (matches.length === 0) return null;
  return join(LOG_DIR, matches[0]);
}

export function extractFailureBlocks(body, contextLines = 5) {
  const { failures } = summarizeVitestOutput(body);
  if (failures.length > 0) return failures;
  // Fallback: scan for "Error:" lines with surrounding context.
  const lines = body.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (/Error:/i.test(lines[i])) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + contextLines + 1);
      blocks.push(lines.slice(start, end).join("\n"));
      i = end;
    }
  }
  return blocks;
}

function pickHeadTail(body, head, tail) {
  const lines = body.split(/\r?\n/);
  if (head !== null && head !== undefined) return lines.slice(0, head).join("\n");
  if (tail !== null && tail !== undefined) return lines.slice(-tail).join("\n");
  return body;
}

async function logsCommand(rawArgs) {
  const parsed = parseDebugArgs(rawArgs);
  const positional = parsed.positional;
  const sub = positional[0] ?? "list";

  if (sub === "list") {
    const rows = listLogs();
    process.stdout.write(formatLogTable(rows));
    return 0;
  }

  let target;
  if (sub === "last") {
    const rows = listLogs();
    if (rows.length === 0) {
      process.stdout.write("no logs under out/debug-logs/\n");
      return 0;
    }
    target = join(LOG_DIR, `${rows[0].runId}.log`);
  } else {
    target = findLogPath(sub);
    if (!target) {
      process.stderr.write(`[debug:logs] unknown run-id: ${sub}\n`);
      return 2;
    }
  }

  const body = readFileSync(target, "utf8");
  if (parsed.verbose) {
    process.stdout.write(pickHeadTail(body, parsed.head, parsed.tail));
    if (!body.endsWith("\n")) process.stdout.write("\n");
    return 0;
  }

  const failures = extractFailureBlocks(body);
  if (failures.length > 0) {
    process.stdout.write(failures.join("\n\n") + "\n");
  } else {
    const tail = body.split(/\r?\n/).slice(-20).join("\n");
    process.stdout.write(tail + "\n");
  }
  process.stdout.write(`# log: ${target}\n`);
  return 0;
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return args.length === 0 ? 0 : 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);
  if (cmd === "logs") {
    return logsCommand(rest);
  }
  if (!KNOWN_RUNNERS.has(cmd)) {
    process.stderr.write(`[debug] unknown command: ${cmd}\n${HELP}`);
    return 2;
  }
  return runVitestKind(cmd, rest);
}

const invokedDirectly = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv).then((code) => process.exit(code ?? 0));
}
