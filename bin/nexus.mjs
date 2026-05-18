#!/usr/bin/env node
/**
 * v1.0.0 Phase 10.2 -- top-level `nexus` CLI.
 *
 * Subcommands shipped in Phase 10:
 *   nexus skills sync [--tag <tag>] [--apply]
 *   nexus skills list [--namespace <ns>]
 *   nexus skills install <namespace>/<name> [--from <url>]
 *   nexus skills remove <namespace>/<name>
 *
 * Pass-through (existing CLIs from earlier phases):
 *   nexus check ...        -> bin/nexus-check.mjs
 *   nexus image ...        -> bin/nexus-image.mjs
 *   nexus video ...        -> bin/nexus-video.mjs
 *
 * The skills sync core logic lives in `core/skills/DevAIHubSyncer.ts` so it
 * is unit-testable without spawning a CLI process. Only the argv parsing
 * and console-rendering surface lives in this file.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `nexus -- Nexus desktop CLI

Usage:
  nexus skills sync [--tag <tag>] [--apply]
  nexus skills list [--namespace <ns>]
  nexus skills install <namespace>/<name> [--from <url>]
  nexus skills remove <namespace>/<name>
  nexus check [...]                     deterministic source-code checks
  nexus image [...]                     image-pipeline helpers
  nexus video [...]                     video-pipeline helpers

Exit codes:
  0  success
  1  validation error (e.g. injection scan blocked the sync)
  2  invalid invocation
`;

export function parseArgs(argv) {
  const args = {
    command: null,
    subcommand: null,
    positional: [],
    flags: {},
    help: false,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        args.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.flags[a.slice(2)] = argv[++i];
      } else {
        args.flags[a.slice(2)] = true;
      }
      continue;
    }
    if (args.command === null) args.command = a;
    else if (args.subcommand === null) args.subcommand = a;
    else args.positional.push(a);
  }
  return args;
}

async function loadSyncer() {
  // Try the compiled bundle first; fall back to importing the TS source via
  // a registered loader is not available in plain Node, so we require the
  // built artifact when this CLI is invoked from a packaged install.
  const compiled = resolvePath(__dirname, "..", "out", "core", "skills", "DevAIHubSyncer.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "DevAIHubSyncer build artifact missing. Run `npm run build` before invoking `nexus skills sync` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

export async function runSkillsSync(flags, stdout = process.stdout, stderr = process.stderr) {
  const mod = await loadSyncer();
  const syncer = new mod.DevAIHubSyncer({});
  const result = await syncer.sync({
    tag: typeof flags.tag === "string" ? flags.tag : undefined,
    apply: flags.apply === true || flags.apply === "true",
  });
  if (result.alreadyUpToDate) {
    stdout.write(`nexus skills sync: already up to date at ${result.tag}\n`);
    return 0;
  }
  stdout.write(`nexus skills sync: fetched ${result.tag}\n`);
  stdout.write(`  diff: ${mod.summarizeDiff(result.diff)}\n`);
  if (result.scan.decision === "block") {
    stderr.write(
      `nexus skills sync: blocked by injection scanner (${result.scan.findings.length} finding(s))\n`,
    );
    for (const f of result.scan.findings) {
      stderr.write(`  [${f.severity}] ${f.source}:${f.line} ${f.ruleId}: ${f.message}\n`);
    }
    return 1;
  }
  if (result.scan.decision === "warn") {
    stderr.write(
      `nexus skills sync: ${result.scan.findings.length} warning(s) from injection scanner\n`,
    );
  }
  if (result.applied) {
    stdout.write(`nexus skills sync: applied ${result.tag} -> ${result.activeDir}\n`);
  } else {
    stdout.write(
      `nexus skills sync: preview written to ${result.tmpDir}. Re-run with --apply to activate.\n`,
    );
  }
  return 0;
}

export async function runSkillsList(_flags, stdout = process.stdout) {
  // List is a thin wrapper over the on-disk active manifest until the
  // SkillCatalog IPC adapter lands in v1.1.0.
  const mod = await loadSyncer();
  const syncer = new mod.DevAIHubSyncer({});
  const root = syncer["_skillsRoot"]; // not exported; use the well-known default
  const active = mod.readActiveTag(root);
  if (!active) {
    stdout.write("nexus skills list: no DevAI-Hub tag is active.\n");
    return 0;
  }
  const manifest = mod.readManifestOnDisk(mod.tagDir(root, active));
  if (!manifest) {
    stdout.write(`nexus skills list: active tag ${active} has no manifest.\n`);
    return 0;
  }
  stdout.write(`Active tag: ${active}\n`);
  for (const skill of manifest.skills) {
    stdout.write(`  devai-hub/${skill.name}\t${skill.contentHash.slice(0, 12)}\n`);
  }
  return 0;
}

export function runSkillsInstallStub(stdout = process.stdout) {
  stdout.write(
    "nexus skills install: ad-hoc install from a URL is not implemented in v1.0.0 (use `nexus skills sync` against DevAI-Hub or copy SKILL.md into ~/.nexus/skills/user/<name>/).\n",
  );
  return 0;
}

export function runSkillsRemoveStub(stdout = process.stdout) {
  stdout.write(
    "nexus skills remove: not implemented in v1.0.0. Delete the SKILL.md from ~/.nexus/skills/user/ (or run `nexus skills sync --apply` to refresh devai-hub/).\n",
  );
  return 0;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help && args.command === null) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.command === "skills") {
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    switch (args.subcommand) {
      case "sync":
        return runSkillsSync(args.flags);
      case "list":
        return runSkillsList(args.flags);
      case "install":
        return runSkillsInstallStub();
      case "remove":
        return runSkillsRemoveStub();
      default:
        process.stderr.write(`nexus skills: unknown subcommand "${args.subcommand}"\n${HELP}`);
        return 2;
    }
  }

  // Pass-through: re-exec the existing sibling CLIs without an extra
  // subprocess; we just import their module and call main().
  if (args.command === "check") {
    const mod = await import(pathToFileURL(resolvePath(__dirname, "nexus-check.mjs")).href);
    return mod.main(argv.slice(1));
  }

  process.stderr.write(`nexus: unknown command "${args.command ?? ""}"\n${HELP}`);
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`nexus: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    });
}

export { HELP };
