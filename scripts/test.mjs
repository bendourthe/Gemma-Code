#!/usr/bin/env node
/**
 * v0.8.0 Phase 5 sub-task 5.8 (item G4) -- single test entry point.
 *
 * Maps `--mode=<X>` to the appropriate underlying npm script so contributors
 * can run any test surface with one command:
 *
 *     node scripts/test.mjs --mode=unit
 *     node scripts/test.mjs --mode=integration --watch
 *     node scripts/test.mjs --mode=golden
 *     node scripts/test.mjs --mode=bench
 *     node scripts/test.mjs --mode=mutation
 *     node scripts/test.mjs --mode=coverage
 *     node scripts/test.mjs --mode=all
 *
 * Mode-to-command mapping:
 *
 *   - unit         -> `npm test`
 *   - integration  -> `npm run test:integration`
 *   - golden       -> `npm test -- tests/integration/golden`
 *                     (the python golden runner stays canonical -- see ADR-0017
 *                     -- but the TS suites under tests/integration/golden are
 *                     the cheapest cross-platform smoke and run by default).
 *   - bench        -> `npm run bench`
 *   - mutation     -> `npm run mutate`
 *   - coverage     -> `npm test -- --coverage`
 *   - all          -> unit + integration in order
 *
 * Passthrough args (anything after `--`) is forwarded verbatim to the
 * underlying tool. `--watch`, `--filter`, and ad-hoc flags work as expected.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const HELP = `gemma-code test runner

Usage:
  node scripts/test.mjs --mode=<mode> [--watch] [--filter=<pattern>] [-- <extra args>]

Modes:
  unit         -- npm test (default)
  integration  -- npm run test:integration
  golden       -- tests/integration/golden subset
  bench        -- npm run bench
  mutation     -- npm run mutate
  coverage     -- npm test -- --coverage
  all          -- unit + integration in sequence

Examples:
  node scripts/test.mjs                          # equivalent to --mode=unit
  node scripts/test.mjs --mode=integration
  node scripts/test.mjs --mode=unit --filter=MemoryFiles
  node scripts/test.mjs --mode=all
`;

function parseArgs(argv) {
  const args = {
    mode: "unit",
    watch: false,
    filter: null,
    passthrough: [],
    help: false,
  };
  let inPass = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (inPass) {
      args.passthrough.push(token);
      continue;
    }
    if (token === "--") {
      inPass = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--watch") {
      args.watch = true;
      continue;
    }
    if (token.startsWith("--mode=")) {
      args.mode = token.slice("--mode=".length).trim().toLowerCase();
      continue;
    }
    if (token === "--mode") {
      args.mode = (argv[++i] ?? "").trim().toLowerCase();
      continue;
    }
    if (token.startsWith("--filter=")) {
      args.filter = token.slice("--filter=".length);
      continue;
    }
    if (token === "--filter") {
      args.filter = argv[++i] ?? null;
      continue;
    }
    // Unknown flags are forwarded.
    args.passthrough.push(token);
  }
  return args;
}

function runCommand(command, args, opts = {}) {
  return new Promise((resolveCmd) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => resolveCmd(code ?? 1));
    child.on("error", (err) => {
      process.stderr.write(`[test.mjs] spawn error: ${err.message}\n`);
      resolveCmd(1);
    });
  });
}

function buildVitestArgs(extra, watch, filter) {
  const out = ["test"];
  if (extra.length > 0 || watch || filter) {
    out.push("--");
    if (watch) out.push("--watch");
    if (filter) {
      out.push("-t", filter);
    }
    for (const token of extra) out.push(token);
  }
  return out;
}

async function runMode(mode, args) {
  switch (mode) {
    case "unit":
      return runCommand("npm", buildVitestArgs(args.passthrough, args.watch, args.filter));
    case "integration":
      return runCommand(
        "npm",
        ["run", "test:integration", ...(args.passthrough.length > 0 ? ["--", ...args.passthrough] : [])],
      );
    case "golden":
      // TS golden subset under tests/integration/golden. The Python runner
      // canonised in ADR-0017 lives at tests/integration/golden/python/ but
      // is invoked separately; this mode covers the cross-platform vitest
      // smoke.
      return runCommand(
        "npm",
        ["test", "--", "tests/integration/golden", ...args.passthrough],
      );
    case "bench":
      return runCommand("npm", ["run", "bench", ...(args.passthrough.length > 0 ? ["--", ...args.passthrough] : [])]);
    case "mutation":
      return runCommand("npm", ["run", "mutate", ...(args.passthrough.length > 0 ? ["--", ...args.passthrough] : [])]);
    case "coverage":
      return runCommand("npm", ["test", "--", "--coverage", ...args.passthrough]);
    case "all": {
      const unitExit = await runMode("unit", args);
      if (unitExit !== 0) return unitExit;
      return runMode("integration", args);
    }
    default:
      process.stderr.write(`[test.mjs] unknown mode: ${mode}\n${HELP}`);
      return 2;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // Sanity: warn early when running outside the repository root.
  if (!existsSync(resolve(process.cwd(), "package.json"))) {
    process.stderr.write(`[test.mjs] package.json not found in ${process.cwd()}; run from the repo root\n`);
    return 2;
  }

  return runMode(args.mode, args);
}

main().then((code) => process.exit(code ?? 0));
