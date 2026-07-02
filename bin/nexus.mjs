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
import { dirname, resolve as resolvePath, join as joinPath, isAbsolute } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `nexus -- Nexus desktop CLI

Usage:
  nexus skills sync [--tag <tag>] [--apply]
  nexus skills list [--namespace <ns>]
  nexus skills install <namespace>/<name> [--from <url>]
  nexus skills remove <namespace>/<name>
  nexus skills audit [--context-tokens <N>] [--budget-percent <N>] [--months <N>] [--skills-root <dir>] [--sessions-root <dir>] [--by-root builtin|user|devai-hub] [--deep-logs] [--json]
  nexus memory audit [--since <ISO>] [--tier <t>] [--scope <id>] [--session <id>] [--op <op>] [--format table|json]
  nexus memory export --out <file> [--scope <id>] [--tier <list>] [--since <ISO>]
  nexus memory import --in <file>
  nexus memory decay --now
  nexus memory compress --file <path> [--session <id>] [--model <name>] [--dry-run]
  nexus doctor [--migration-report] [--json] [--home <dir>] [--legacy-home <dir>] [--skills-root <dir>] [--stale-days <N>]
  nexus trace export --trace <id> --out <file> --db <path> [--title <t>]
  nexus golden run [--task <id>] [--mode dry|live] [--model <name>]
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

// v1.1.0 Phase 8.3 -- real install/remove implementations replace the
// v1.0.0 stubs. Heavy logic lives in `core/skills/SkillInstaller.ts` and
// `core/skills/installAllowlist.ts`; the CLI just parses argv and
// renders results.

async function loadSkillInstaller() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "skills", "SkillInstaller.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "SkillInstaller build artifact missing. Run `npm run build` before invoking `nexus skills install/remove` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

export async function runSkillsInstall(args, stdout = process.stdout, stderr = process.stderr) {
  const positional = args.positional ?? [];
  // `nexus skills install <ns>/<name> ...` -- first positional after the
  // "install" subcommand is the spec.
  const specRaw = positional[0];
  if (!specRaw) {
    stderr.write("nexus skills install: missing <namespace>/<name> argument.\n");
    return 2;
  }
  const fromUrl = typeof args.flags.from === "string" ? args.flags.from : "";
  if (!fromUrl) {
    stderr.write("nexus skills install: --from <url> is required.\n");
    return 2;
  }
  const overwrite = args.flags.overwrite === true || args.flags.overwrite === "true";

  const mod = await loadSkillInstaller();
  const spec = mod.parseSkillSpec(specRaw);
  if (!spec) {
    stderr.write(
      `nexus skills install: invalid spec '${specRaw}'. Expected '<namespace>/<name>'.\n`,
    );
    return 2;
  }
  const result = await mod.installSkill(spec, {
    url: fromUrl,
    overwrite,
  });
  if (result.ok) {
    stdout.write(`nexus skills install: wrote ${result.writtenTo}\n`);
    if (result.scan && result.scan.decision === "warn") {
      stderr.write(
        `nexus skills install: ${result.scan.findings.length} scanner warning(s) recorded (install allowed).\n`,
      );
      for (const f of result.scan.findings) {
        stderr.write(`  [${f.severity}] ${f.source}:${f.line} ${f.ruleId}: ${f.message}\n`);
      }
    }
    return 0;
  }
  stderr.write(`nexus skills install: ${result.reason ?? "failed"}: ${result.message ?? ""}\n`);
  if (result.scan && result.scan.findings.length > 0) {
    for (const f of result.scan.findings) {
      stderr.write(`  [${f.severity}] ${f.source}:${f.line} ${f.ruleId}: ${f.message}\n`);
    }
  }
  // Use exit code 1 for validation / scanner / fetch failures (semantically
  // "blocked"), 2 only for clearly malformed invocations.
  return result.reason === "invalid-spec" || result.reason === "wrong-namespace" ? 2 : 1;
}

export async function runSkillsRemove(args, stdout = process.stdout, stderr = process.stderr) {
  const positional = args.positional ?? [];
  const specRaw = positional[0];
  if (!specRaw) {
    stderr.write("nexus skills remove: missing <namespace>/<name> argument.\n");
    return 2;
  }
  const mod = await loadSkillInstaller();
  const spec = mod.parseSkillSpec(specRaw);
  if (!spec) {
    stderr.write(
      `nexus skills remove: invalid spec '${specRaw}'. Expected '<namespace>/<name>'.\n`,
    );
    return 2;
  }
  const result = mod.removeSkill(spec);
  if (result.ok) {
    stdout.write(`nexus skills remove: deleted ${result.removed}\n`);
    return 0;
  }
  stderr.write(`nexus skills remove: ${result.reason ?? "failed"}: ${result.message ?? ""}\n`);
  return result.reason === "invalid-spec" || result.reason === "wrong-namespace"
    ? 2
    : 1;
}

// ---------------------------------------------------------------------------
// v1.3.0 Phase 3 (adoption-skill-cleaner T009) -- `nexus skills audit`.
//
// The audit composition logic lives in `core/skills/SkillAuditor.ts` so it is
// unit-testable without a CLI process. This surface only locates the live
// skill roots on disk, builds an in-memory catalog from them, and renders the
// report. Audit is strictly read-only (insight I-12): it never writes to
// `~/.nexus/` or mutates any persisted state.
// ---------------------------------------------------------------------------

async function loadSkillAuditor() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "skills", "SkillAuditor.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "SkillAuditor build artifact missing. Run `npm run build` before invoking `nexus skills audit` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadSkillCatalogModule() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "skills", "SkillCatalog.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "SkillCatalog build artifact missing. Run `npm run build` before invoking `nexus skills audit` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadModelRegistryModule() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "registry", "ModelRegistry.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "ModelRegistry build artifact missing. Run `npm run build` before invoking `nexus skills audit` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

/**
 * Minimal SKILL.md frontmatter parser (name + description). Mirrors the
 * single-line YAML subset that `modules/coding/skills/SkillLoader.ts` already consumes;
 * intentionally dependency-free since this runs in the plain-JS CLI.
 */
function parseSkillFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!m) return null;
  const meta = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, body: (m[2] ?? "").trim() };
}

/** Recursively collect every `SKILL.md` path under `dir` (symlinks skipped). */
function walkSkillFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = joinPath(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkSkillFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") out.push(full);
  }
}

/**
 * Resolve the skill roots to audit. With `--skills-root <dir>` only that
 * directory is scanned (source `user`); otherwise the default trio is used:
 * the bundled built-in catalog, the user skills dir, and the active DevAI-Hub
 * tag (when one is pinned).
 */
function skillRootsFor(flags) {
  const override = typeof flags["skills-root"] === "string" ? flags["skills-root"] : null;
  if (override) return [{ dir: override, source: "user" }];

  const roots = [{ dir: resolvePath(__dirname, "..", "src", "skills", "catalog"), source: "builtin" }];
  const skillsRoot = joinPath(nexusHomeDir(), "skills");
  roots.push({ dir: joinPath(skillsRoot, "user"), source: "user" });
  try {
    const tag = readFileSync(joinPath(skillsRoot, "devai-hub", "ACTIVE"), "utf8").trim();
    if (tag) roots.push({ dir: joinPath(skillsRoot, "devai-hub", tag), source: "devai-hub" });
  } catch {
    // No active DevAI-Hub tag -- skip that root.
  }
  return roots;
}

/** Build an in-memory catalog from the live on-disk skill roots. */
function buildLiveCatalog(flags, catalogMod) {
  const skills = [];
  for (const { dir, source } of skillRootsFor(flags)) {
    const files = [];
    walkSkillFiles(dir, files);
    for (const file of files) {
      let content;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSkillFrontmatter(content);
      if (!parsed || !parsed.meta.name) continue;
      const name = parsed.meta.name;
      const description = parsed.meta.description ?? "";
      const contentHash = createHash("sha256").update(content).digest("hex");
      skills.push({
        id: catalogMod.canonicalSkillId(source, name),
        displayName: name,
        path: file,
        provenance: { source, contentHash },
        frontmatter: { name, description },
        body: parsed.body,
      });
    }
  }
  return new catalogMod.InMemorySkillCatalog(skills);
}

export async function runSkillsAudit(flags, stdout = process.stdout, stderr = process.stderr) {
  const [auditorMod, catalogMod, registryMod] = await Promise.all([
    loadSkillAuditor(),
    loadSkillCatalogModule(),
    loadModelRegistryModule(),
  ]);

  const catalog = buildLiveCatalog(flags, catalogMod);
  if (catalog.list().length === 0) {
    stderr.write(
      "nexus skills audit: no skills loaded. Check the catalog root or run `nexus skills sync`.\n",
    );
    return 1;
  }

  const registry = new registryMod.InMemoryModelRegistry();
  registry.setActiveModel("gemma4:e4b");

  const opts = { catalog, modelRegistry: registry };
  if (typeof flags["context-tokens"] === "string") {
    const n = Number.parseInt(flags["context-tokens"], 10);
    if (Number.isFinite(n) && n > 0) opts.contextTokens = n;
  }
  if (typeof flags["budget-percent"] === "string") {
    const n = Number.parseFloat(flags["budget-percent"]);
    if (Number.isFinite(n) && n >= 0) opts.budgetPercent = n;
  }
  if (typeof flags.months === "string") {
    const n = Number.parseInt(flags.months, 10);
    if (Number.isFinite(n) && n > 0) opts.months = n;
  }

  // v1.3.0 Phase 6 (T018) -- P3 backlog flags.
  // `--by-root <name>` scopes every report section to one provenance source.
  if (typeof flags["by-root"] === "string") {
    const root = flags["by-root"];
    if (root !== "builtin" && root !== "user" && root !== "devai-hub") {
      stderr.write(
        `nexus skills audit: --by-root must be one of builtin, user, devai-hub (got "${root}").\n`,
      );
      return 1;
    }
    opts.byRoot = root;
  }
  // `--deep-logs` extends the usage scan into the sessions archive + gz logs.
  if (flags["deep-logs"] === true || flags["deep-logs"] === "true") opts.deepLogs = true;

  // v1.3.0 Phase 4 (T013) -- wire the usage scan end-to-end. The Unused report
  // scans the session logs for the primary skill root (the `--skills-root`
  // override when given, otherwise the bundled built-in catalog, which holds
  // the bulk of the catalog). When `--by-root` is set, scan the matching root
  // so the Unused evidence aligns with the scoped report. `--sessions-root`
  // overrides the log root (used by tests for a hermetic scan); it otherwise
  // defaults to `~/.nexus/sessions/` inside `scanUsage`. Audit stays read-only.
  const roots = skillRootsFor(flags);
  opts.skillsRoot = opts.byRoot
    ? (roots.find((r) => r.source === opts.byRoot)?.dir ?? roots[0]?.dir)
    : roots[0]?.dir;
  if (typeof flags["sessions-root"] === "string") opts.sessionsRoot = flags["sessions-root"];

  const report = await auditorMod.auditSkills(opts);
  if (flags.json === true || flags.json === "true") {
    stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    stdout.write(auditorMod.formatAuditReport(report));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// v1.4.0 Phase 5 (A6) -- `nexus doctor` stale-state inventory.
//
// The inventory logic lives in `core/diagnostics/DoctorReport.ts` so it is
// unit-testable without a CLI process. This surface only resolves the live
// paths (nexus home, legacy gemma home, skill roots), runs the read-only
// inventory, and renders. Doctor is read-only by contract (it never writes,
// moves, or deletes anything); `--migration-report` only widens how much
// per-entry detail the renderer surfaces.
// ---------------------------------------------------------------------------

async function loadDoctorReport() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "diagnostics", "DoctorReport.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "DoctorReport build artifact missing. Run `npm run build` before invoking `nexus doctor` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

/** Resolve the legacy `~/.gemma-code/` root, honoring NEXUS_HOME-style overrides. */
function legacyGemmaHomeDir() {
  return joinPath(homedir(), ".gemma-code");
}

export async function runDoctor(flags, stdout = process.stdout, stderr = process.stderr) {
  const mod = await loadDoctorReport();

  const home = typeof flags.home === "string" ? flags.home : nexusHomeDir();
  const legacyHome =
    typeof flags["legacy-home"] === "string" ? flags["legacy-home"] : legacyGemmaHomeDir();
  // Reuse the audit's skill-root resolver so duplicate-skill detection spans
  // the same builtin / user / devai-hub trio (or the --skills-root override).
  const skillRoots = skillRootsFor(flags);

  const inputs = {
    nexusHome: home,
    legacyGemmaHome: legacyHome,
    skillRoots,
    migrationReport: flags["migration-report"] === true || flags["migration-report"] === "true",
  };
  if (typeof flags["stale-days"] === "string") {
    const n = Number.parseInt(flags["stale-days"], 10);
    if (Number.isFinite(n) && n >= 0) inputs.staleCacheDays = n;
  }

  const report = mod.buildDoctorReport(inputs);
  if (flags.json === true || flags.json === "true") {
    stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    stdout.write(mod.formatDoctorReport(report));
  }
  // Doctor is diagnostic, not a gate: it always exits 0 (a clean report and a
  // report full of warnings both succeed). Errors loading the artifact throw.
  return 0;
}

// ---------------------------------------------------------------------------
// v1.6.0 Phase 2 (A4) -- `nexus trace export` standalone trace viewer.
//
// The serialization logic lives in
// `modules/coding/observability/TraceHtmlExport.ts` so it is unit-tested
// without spawning a CLI process. This surface only opens the local trace
// store, fetches the requested trace, serializes it to a self-contained HTML
// file, and writes it. Local-only: it reads a SQLite trace DB and writes one
// HTML file; no network, no telemetry.
// ---------------------------------------------------------------------------

async function loadCompiled(relParts, label) {
  const compiled = resolvePath(__dirname, "..", "out", ...relParts);
  if (!existsSync(compiled)) {
    throw new Error(
      `${label} build artifact missing. Run \`npm run build\` before invoking \`nexus trace export\` from source.`,
    );
  }
  return import(pathToFileURL(compiled).href);
}

// ---------------------------------------------------------------------------
// v1.7.0 SO001.P1.B -- `nexus golden run` live golden-task runner.
//
// Loads the compiled TS-native GoldenTaskRunner (Phase 1) + the vscode-free
// HeadlessAgentDriver (SO001.P1.A) and runs the golden corpus. `--mode dry`
// (default) evaluates each task's snapshot against its success_criteria with
// no agent (offline, CI-safe); `--mode live` drives the real headless agent
// against a fresh snapshot copy via the local Ollama backend. Local-only.
// ---------------------------------------------------------------------------

export async function runGoldenRun(flags, stdout = process.stdout, stderr = process.stderr) {
  const mode = flags.mode === "live" ? "live" : "dry";
  const tasksDir = resolvePath(__dirname, "..", "tests", "golden", "tasks");
  const snapshotRoot = resolvePath(__dirname, "..", "tests", "golden", "snapshots");

  const [runnerMod, loaderMod] = await Promise.all([
    loadCompiled(["modules", "coding", "evaluation", "GoldenTaskRunner.js"], "GoldenTaskRunner"),
    loadCompiled(["modules", "coding", "evaluation", "goldenTaskLoader.js"], "goldenTaskLoader"),
  ]);

  let tasks;
  try {
    tasks = loaderMod.loadAllGoldenTasks(tasksDir);
  } catch (err) {
    stderr.write(
      `nexus golden run: failed to load tasks from ${tasksDir}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  if (typeof flags.task === "string") {
    tasks = tasks.filter((t) => t.id === flags.task);
    if (tasks.length === 0) {
      stderr.write(`nexus golden run: no task with id "${flags.task}".\n`);
      return 1;
    }
  }

  const options = { mode, snapshotRoot, initGit: false };
  if (mode === "live") {
    const model = typeof flags.model === "string" ? flags.model : "gemma4:e4b";
    const [driverMod, llmMod] = await Promise.all([
      loadCompiled(["modules", "coding", "runtime", "HeadlessAgentDriver.js"], "HeadlessAgentDriver"),
      loadCompiled(["modules", "coding", "llm", "OllamaClient.js"], "OllamaClient"),
    ]);
    options.driver = new driverMod.HeadlessAgentDriver({
      llm: llmMod.createOllamaClient(),
      model,
    });
  }

  let passed = 0;
  for (const spec of tasks) {
    const result = await runnerMod.runGoldenTask(spec, options);
    if (result.passed) passed += 1;
    const detail = result.failures.length > 0 ? ` -- ${result.failures[0]}` : "";
    stdout.write(`${result.passed ? "PASS" : "FAIL"} ${spec.id}${detail}\n`);
  }
  stdout.write(`nexus golden run: ${passed}/${tasks.length} passed (${mode} mode)\n`);
  return passed === tasks.length ? 0 : 1;
}

export async function runTraceExport(flags, stdout = process.stdout, stderr = process.stderr) {
  const traceId = typeof flags.trace === "string" ? flags.trace : null;
  const out = typeof flags.out === "string" ? flags.out : null;
  const db = typeof flags.db === "string" ? flags.db : null;
  if (!traceId) {
    stderr.write("nexus trace export: --trace <id> is required.\n");
    return 2;
  }
  if (!out) {
    stderr.write("nexus trace export: --out <file> is required.\n");
    return 2;
  }
  if (!db) {
    stderr.write(
      "nexus trace export: --db <path> is required (the SQLite trace store; the desktop app stores it under its global storage dir).\n",
    );
    return 2;
  }
  if (!existsSync(db)) {
    stderr.write(`nexus trace export: trace database not found: ${db}\n`);
    return 2;
  }

  // Use the vscode-free reader (not TraceStore): TraceStore pulls in the
  // vscode-coupled logger via secureDbPermissions and cannot load in a plain
  // Node CLI. The reader opens the SQLite store read-only.
  const [{ readExportableTrace }, { serializeTraceToHtml }] = await Promise.all([
    loadCompiled(["modules", "coding", "observability", "TraceDbReader.js"], "TraceDbReader"),
    loadCompiled(["modules", "coding", "observability", "TraceHtmlExport.js"], "TraceHtmlExport"),
  ]);

  const trace = readExportableTrace(db, traceId);
  if (!trace) {
    stderr.write(`nexus trace export: no trace with id "${traceId}" in ${db}\n`);
    return 1;
  }
  const options = {};
  if (typeof flags.title === "string") options.title = flags.title;
  const html = serializeTraceToHtml(trace, options);
  const absolute = isAbsolute(out) ? out : resolvePath(process.cwd(), out);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, html, "utf8");
  stdout.write(`nexus trace export: wrote ${trace.spanCount} span(s) to ${absolute}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// v1.1.0 Phase 6 -- `nexus memory` subcommand surface.
//
// The CLI keeps the heavy lifting in `core/memory/MemoryAudit.ts`,
// `core/memory/MemoryExport.ts`, and `core/memory/DecaySweep.ts` so the
// formatters / parsers can be unit-tested without spawning a process.
//
// The `--source` flag injects a JSONL file as the audit log / export
// source / decay corpus. Production wiring (sidecar + SQLite-backed
// implementations) connects the modules directly and never spawns the
// CLI; the `--source` flag exists so operators can run audits against a
// captured snapshot without touching the live database.
// ---------------------------------------------------------------------------

const EXPORTS_DIRNAME = "exports";

function nexusHomeDir() {
  const override = process.env["NEXUS_HOME"];
  if (override && override.length > 0) return override;
  return joinPath(homedir(), ".nexus");
}

function exportsRoot() {
  return joinPath(nexusHomeDir(), EXPORTS_DIRNAME);
}

async function loadMemoryAudit() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "memory", "MemoryAudit.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "MemoryAudit build artifact missing. Run `npm run build` before invoking `nexus memory audit` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadMemoryAuditLog() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "memory", "MemoryAuditLog.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "MemoryAuditLog build artifact missing. Run `npm run build` before invoking the memory CLI from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadMemoryExport() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "memory", "MemoryExport.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "MemoryExport build artifact missing. Run `npm run build` before invoking `nexus memory export` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadDecaySweep() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "memory", "DecaySweep.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "DecaySweep build artifact missing. Run `npm run build` before invoking `nexus memory decay` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadFileCompressor() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "memory", "FileCompressor.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "FileCompressor build artifact missing. Run `npm run build` before invoking `nexus memory compress` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

async function loadLocalEmbedder() {
  const compiled = resolvePath(__dirname, "..", "out", "core", "memory", "LocalEmbedder.js");
  if (!existsSync(compiled)) {
    throw new Error(
      "LocalEmbedder build artifact missing. Run `npm run build` before invoking `nexus memory compress` from source.",
    );
  }
  return import(pathToFileURL(compiled).href);
}

/**
 * Read a JSONL file and return the rows as a plain array. Lines that fail
 * to parse are reported on stderr but do not abort the read (matches the
 * tolerance the import sink applies in MemoryExport.importFromJsonl).
 */
function readJsonl(path, stderr = process.stderr) {
  const raw = readFileSync(path, "utf8");
  const out = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      stderr.write(
        `nexus memory: malformed JSONL on line ${i + 1} of ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  return out;
}

export async function runMemoryAudit(flags, stdout = process.stdout, stderr = process.stderr) {
  const sourcePath = typeof flags.source === "string" ? flags.source : null;
  if (!sourcePath) {
    stderr.write(
      "nexus memory audit: --source <jsonl> is required. The sidecar-direct path is wired in the desktop daemon; the CLI requires a captured log.\n",
    );
    return 2;
  }
  if (!existsSync(sourcePath)) {
    stderr.write(`nexus memory audit: source not found: ${sourcePath}\n`);
    return 2;
  }
  const [{ formatAuditTable, formatAuditJsonl, parseSinceFlag }, { InMemoryAuditLog }] =
    await Promise.all([loadMemoryAudit(), loadMemoryAuditLog()]);
  const rows = readJsonl(sourcePath, stderr);
  const log = new InMemoryAuditLog(Math.max(rows.length, 1));
  for (const row of rows) log.append(row);

  const filter = {};
  if (typeof flags.since === "string") {
    const sinceMs = parseSinceFlag(flags.since);
    if (sinceMs === null) {
      stderr.write(`nexus memory audit: unparseable --since value "${flags.since}"\n`);
      return 2;
    }
    filter.sinceMs = sinceMs;
  }
  if (typeof flags.tier === "string") filter.tier = flags.tier;
  if (typeof flags.session === "string") filter.sessionId = flags.session;
  if (typeof flags.op === "string") filter.op = flags.op;
  if (typeof flags.limit === "string") {
    const n = Number.parseInt(flags.limit, 10);
    if (Number.isFinite(n) && n > 0) filter.limit = n;
  }

  const filtered = log.query(filter);
  const format = typeof flags.format === "string" ? flags.format : "table";
  if (format === "json" || format === "jsonl") {
    stdout.write(formatAuditJsonl(filtered));
  } else {
    stdout.write(formatAuditTable(filtered) + (filtered.length > 0 ? "\n" : ""));
  }
  return 0;
}

export async function runMemoryExport(flags, stdout = process.stdout, stderr = process.stderr) {
  const out = typeof flags.out === "string" ? flags.out : null;
  if (!out) {
    stderr.write("nexus memory export: --out <file> is required.\n");
    return 2;
  }
  const source = typeof flags.source === "string" ? flags.source : null;
  if (!source) {
    stderr.write(
      "nexus memory export: --source <jsonl> is required when invoking from the CLI (the sidecar wires the source directly).\n",
    );
    return 2;
  }

  const [{ exportToJsonl, isPathInside }] = await Promise.all([loadMemoryExport()]);
  const root = exportsRoot();
  const absolute = isAbsolute(out) ? out : resolvePath(process.cwd(), out);
  if (!isPathInside(absolute, root)) {
    stderr.write(
      `nexus memory export: --out must resolve inside ${root}. Refusing to write to ${absolute} (path traversal guard).\n`,
    );
    return 2;
  }

  const rows = readJsonl(source, stderr);
  const filter = {};
  if (typeof flags.tier === "string") {
    filter.tiers = flags.tier.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  if (typeof flags.scope === "string") filter.scopeId = flags.scope;
  if (typeof flags.since === "string") {
    const ms = Date.parse(flags.since);
    if (Number.isFinite(ms)) filter.sinceMs = ms;
  }

  const inMemorySource = {
    list(f) {
      const tiers = f.tiers ? new Set(f.tiers) : null;
      const out = [];
      for (const row of rows) {
        if (tiers && !tiers.has(row.tier)) continue;
        if (f.scopeId !== undefined && row.scopeId !== f.scopeId) continue;
        if (f.sinceMs !== undefined && (row.createdAt ?? 0) < f.sinceMs) continue;
        out.push(row);
      }
      return out;
    },
  };

  const result = exportToJsonl(inMemorySource, filter);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, result.text, "utf8");
  stdout.write(`nexus memory export: wrote ${result.rowCount} row(s) to ${absolute}\n`);
  return 0;
}

export async function runMemoryImport(flags, stdout = process.stdout, stderr = process.stderr) {
  const inPath = typeof flags.in === "string" ? flags.in : null;
  if (!inPath) {
    stderr.write("nexus memory import: --in <file> is required.\n");
    return 2;
  }
  if (!existsSync(inPath)) {
    stderr.write(`nexus memory import: file not found: ${inPath}\n`);
    return 2;
  }
  const [{ importFromJsonl }] = await Promise.all([loadMemoryExport()]);
  const text = readFileSync(inPath, "utf8");
  const imported = [];
  const sink = {
    upsert(row) {
      imported.push(row);
    },
  };
  const result = importFromJsonl(text, sink);
  stdout.write(
    `nexus memory import: imported ${result.imported} row(s), skipped ${result.skipped}, errors ${result.errors.length}\n`,
  );
  for (const err of result.errors) {
    stderr.write(`  line ${err.line}: ${err.reason}\n`);
  }
  if (typeof flags.out === "string" && imported.length > 0) {
    const absolute = isAbsolute(flags.out) ? flags.out : resolvePath(process.cwd(), flags.out);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, JSON.stringify(imported, null, 2), "utf8");
    stdout.write(`nexus memory import: imported rows written to ${absolute}\n`);
  }
  return result.errors.length > 0 ? 1 : 0;
}

export async function runMemoryDecay(flags, stdout = process.stdout, stderr = process.stderr) {
  if (flags.now !== true && flags.now !== "true") {
    stderr.write("nexus memory decay: --now is required (CLI only supports manual sweeps).\n");
    return 2;
  }
  const source = typeof flags.source === "string" ? flags.source : null;
  if (!source) {
    stderr.write(
      "nexus memory decay: --source <jsonl> with DecayableEntry rows is required from the CLI; the sidecar wires the live provider directly.\n",
    );
    return 2;
  }
  if (!existsSync(source)) {
    stderr.write(`nexus memory decay: source not found: ${source}\n`);
    return 2;
  }
  const [{ DecaySweep }] = await Promise.all([loadDecaySweep()]);
  const rows = readJsonl(source, stderr);
  const provider = {
    list() {
      return rows;
    },
    evict(_id) {
      return true;
    },
  };
  const sweep = new DecaySweep(provider);
  const result = sweep.sweep();
  stdout.write(
    `nexus memory decay: scanned=${result.scanned} kept=${result.kept} evicted=${result.evicted.length}\n`,
  );
  for (const e of result.evicted) {
    stdout.write(`  evicted ${e.tier}/${e.id} (retention=${e.retention.toExponential(2)})\n`);
  }
  return 0;
}

export async function runMemoryCompress(flags, stdout = process.stdout, stderr = process.stderr) {
  const filePath = typeof flags.file === "string" ? flags.file : null;
  if (!filePath) {
    stderr.write("nexus memory compress: --file <path> is required.\n");
    return 2;
  }
  if (!existsSync(filePath)) {
    stderr.write(`nexus memory compress: file not found: ${filePath}\n`);
    return 2;
  }
  const enabled =
    flags["dry-run"] === true || flags["dry-run"] === "true"
      ? false
      : flags.enabled === false || flags.enabled === "false"
        ? false
        : true;
  if (!enabled) {
    stdout.write(
      `nexus memory compress: dry-run mode -- no LLM call will be made.\n`,
    );
  }
  const model = typeof flags.model === "string" ? flags.model : "gemma4:e4b";
  const sessionId = typeof flags.session === "string" ? flags.session : "cli";

  const [{ FileCompressor }, { LocalEmbedder }] = await Promise.all([
    loadFileCompressor(),
    loadLocalEmbedder(),
  ]);

  const writes = [];
  const writer = {
    async upsert(row) {
      writes.push(row);
    },
  };
  const links = [];
  const graph = {
    async link(args) {
      links.push(args);
    },
  };

  // The CLI surface does not call a real Ollama process: it records the
  // intended call so an operator can inspect what the production sidecar
  // would have sent without spinning up the daemon. The desktop sidecar
  // wires the real client directly into the compressor.
  const calls = [];
  const ollama = {
    model,
    chat: async (prompt) => {
      calls.push(prompt);
      return '{"summary":"(cli dry-run)","key_facts":[],"code_patterns":[]}';
    },
  };
  Object.defineProperty(ollama, "invocationCount", {
    get: () => calls.length,
  });

  const embedder = new LocalEmbedder({ forceFallback: true });
  const compressor = new FileCompressor({
    embedder,
    writer,
    ollama,
    graph,
    options: { enabled },
  });
  const result = await compressor.compressFile(filePath, {
    sessionId,
    hookKind: "cli.memory.compress",
    toolName: "memory.compress",
  });
  if (result.kind !== "compressed") {
    stderr.write(`nexus memory compress: ${result.kind}: ${result.message ?? ""}\n`);
    return result.kind === "disabled" ? 0 : 1;
  }
  stdout.write(
    `nexus memory compress: wrote semantic-tier id=${result.entryId} chunks=${result.observation?.chunkCount ?? 0} model=${model} llmCalls=${calls.length}\n`,
  );
  if (links.length > 0) {
    stdout.write(`  graph link: ${links[0].kind} -> ${links[0].to}\n`);
  }
  // Surface the first write as a sanity check.
  if (writes[0]) {
    const preview = writes[0].content.split("\n").slice(0, 4).join(" | ");
    stdout.write(`  preview: ${preview}\n`);
  }
  return 0;
}

export async function runMemoryCommand(args, stdout = process.stdout, stderr = process.stderr) {
  switch (args.subcommand) {
    case "audit":
      return runMemoryAudit(args.flags, stdout, stderr);
    case "export":
      return runMemoryExport(args.flags, stdout, stderr);
    case "import":
      return runMemoryImport(args.flags, stdout, stderr);
    case "decay":
      return runMemoryDecay(args.flags, stdout, stderr);
    case "compress":
      return runMemoryCompress(args.flags, stdout, stderr);
    default:
      stderr.write(
        `nexus memory: unknown subcommand "${args.subcommand ?? ""}". Expected one of audit, export, import, decay, compress.\n`,
      );
      return 2;
  }
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
        return runSkillsInstall(args);
      case "remove":
        return runSkillsRemove(args);
      case "audit":
        return runSkillsAudit(args.flags);
      default:
        process.stderr.write(`nexus skills: unknown subcommand "${args.subcommand}"\n${HELP}`);
        return 2;
    }
  }

  if (args.command === "memory") {
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    return runMemoryCommand(args);
  }

  if (args.command === "doctor") {
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    return runDoctor(args.flags);
  }

  if (args.command === "trace") {
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (args.subcommand === "export") {
      return runTraceExport(args.flags);
    }
    process.stderr.write(
      `nexus trace: unknown subcommand "${args.subcommand ?? ""}". Expected: export.\n${HELP}`,
    );
    return 2;
  }

  if (args.command === "golden") {
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (args.subcommand === "run") {
      return runGoldenRun(args.flags);
    }
    process.stderr.write(
      `nexus golden: unknown subcommand "${args.subcommand ?? ""}". Expected: run.\n${HELP}`,
    );
    return 2;
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
