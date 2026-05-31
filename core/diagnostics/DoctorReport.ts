/**
 * v1.4.0 Phase 5 (A6) -- `nexus doctor` stale-state inventory.
 *
 * Adopts claude-code-harness `bin/harness doctor --migration-report`
 * (re-full): a non-destructive inventory of stale on-disk state. The
 * harness's doctor is the operator's "what would a cleanup touch?" report;
 * Nexus reimplements the behavior in TS/Node rather than porting the Go.
 *
 * READ-ONLY BY CONTRACT. Every function in this module uses only the
 * read APIs of `fs` (`existsSync`, `readdirSync`, `statSync`, `lstatSync`,
 * `readFileSync`). It MUST NOT create, move, write, or delete anything --
 * the doctor reports; a human (or a future, separate `--fix` surface)
 * decides what to clean up. The integration test asserts the inventory
 * leaves the scanned tree byte-for-byte unchanged.
 *
 * The inventory covers the five surfaces the comparison calls out:
 *   1. legacy `~/.gemma-code/` state (the pre-v1.0.0 data root),
 *   2. stale caches under `~/.nexus/`,
 *   3. duplicate skills (same display name across skill roots),
 *   4. old / dangling symlinks under `~/.nexus/`,
 *   5. memory state under `~/.nexus/`.
 *
 * The pure builder takes every path and the `fs` surface as injected
 * inputs so it is unit-testable without touching the real home dir; the
 * `bin/nexus.mjs` surface resolves the live paths and renders the report.
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";

export type DoctorSeverity = "info" | "warn";

/** One inventoried observation. Purely descriptive; the doctor never acts. */
export interface DoctorFinding {
  /** Stable machine category, e.g. "legacy-state", "stale-cache". */
  readonly category: string;
  readonly severity: DoctorSeverity;
  readonly title: string;
  readonly detail: string;
  /** Absolute path the finding concerns, when applicable. */
  readonly path?: string;
  /** Approximate size in bytes, for cache / memory findings. */
  readonly sizeBytes?: number;
  /** Human-facing next step. The doctor never executes it. */
  readonly suggestion?: string;
}

export interface DoctorReport {
  readonly generatedAt: string;
  readonly nexusHome: string;
  readonly legacyGemmaHome: string;
  /** True when `--migration-report` requested the full inventory. */
  readonly migrationReport: boolean;
  readonly findings: readonly DoctorFinding[];
  readonly summary: { readonly info: number; readonly warn: number; readonly total: number };
}

export interface SkillRootInput {
  readonly dir: string;
  /** Provenance label, e.g. "builtin" | "user" | "devai-hub". */
  readonly source: string;
}

/** The read-only subset of `fs` the inventory depends on (injected for tests). */
export interface DoctorFsApi {
  existsSync: typeof nodeFs.existsSync;
  readdirSync: typeof nodeFs.readdirSync;
  statSync: typeof nodeFs.statSync;
  lstatSync: typeof nodeFs.lstatSync;
  readFileSync: typeof nodeFs.readFileSync;
}

export interface DoctorInputs {
  readonly nexusHome: string;
  readonly legacyGemmaHome: string;
  readonly skillRoots?: readonly SkillRootInput[];
  /** Full per-entry inventory (`--migration-report`) vs. the summary pass. */
  readonly migrationReport?: boolean;
  /** Injected for tests; defaults to `node:fs`. Only read APIs are used. */
  readonly fsApi?: DoctorFsApi;
  readonly platform?: NodeJS.Platform;
  /** Injected clock for deterministic tests. */
  readonly now?: () => Date;
  /** Cache entries older than this many days are flagged stale. Default 30. */
  readonly staleCacheDays?: number;
}

/** Cache-like subdirectories under `~/.nexus/` the doctor inspects for staleness. */
export const KNOWN_CACHE_DIRS: readonly string[] = [
  "cache",
  "tool-output-cache",
  "web-cache",
];

/** The marker `StorageMigration` drops after copying `~/.gemma-code/` -> `~/.nexus/`. */
export const MIGRATION_MARKER_FILE = "migrated-from-gemma-code.txt";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sum the size of every regular file under `dir`, recursively. Read-only;
 * symlinks are never followed (counted as 0) so a cyclic link cannot trap
 * the walk. Per-entry errors are swallowed so an unreadable file does not
 * abort the inventory.
 */
function dirSize(fsApi: DoctorFsApi, dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  let entries: nodeFs.Dirent[];
  try {
    entries = fsApi.readdirSync(dir, { withFileTypes: true }) as nodeFs.Dirent[];
  } catch {
    return { bytes, files };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const sub = dirSize(fsApi, full);
      bytes += sub.bytes;
      files += sub.files;
      continue;
    }
    if (entry.isFile()) {
      try {
        bytes += fsApi.statSync(full).size;
        files += 1;
      } catch {
        // Unreadable file -- skip; inventory continues.
      }
    }
  }
  return { bytes, files };
}

/** Human-friendly byte formatting (B / KB / MB) for report lines. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Minimal SKILL.md frontmatter `name` extractor. Mirrors the single-line
 * YAML subset the rest of the CLI parses; intentionally dependency-free.
 */
function readSkillName(fsApi: DoctorFsApi, file: string): string | null {
  let content: string;
  try {
    content = fsApi.readFileSync(file, "utf8") as string;
  } catch {
    return null;
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return null;
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === "name") {
      const val = line.slice(idx + 1).trim();
      return val.length > 0 ? val : null;
    }
  }
  return null;
}

/** Collect every `SKILL.md` path under `dir` (symlinks skipped). Read-only. */
function walkSkillFiles(fsApi: DoctorFsApi, dir: string, out: string[]): void {
  let entries: nodeFs.Dirent[];
  try {
    entries = fsApi.readdirSync(dir, { withFileTypes: true }) as nodeFs.Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSkillFiles(fsApi, full, out);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") out.push(full);
  }
}

// ---------------------------------------------------------------------------
// Inventory producers. Each returns the findings for one surface.
// ---------------------------------------------------------------------------

function inventoryLegacyState(inputs: DoctorInputs, fsApi: DoctorFsApi): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const legacy = inputs.legacyGemmaHome;
  if (!fsApi.existsSync(legacy)) return findings;
  let isSymlink = false;
  try {
    isSymlink = fsApi.lstatSync(legacy).isSymbolicLink();
  } catch {
    // Treat an unreadable lstat as a real directory for reporting purposes.
  }
  if (isSymlink) {
    findings.push({
      category: "legacy-state",
      severity: "info",
      title: "Legacy ~/.gemma-code/ is a symlink",
      detail:
        "The pre-v1.0.0 data root is a symlink (POSIX migration compat shim). Harmless; safe to remove once nothing references the old path.",
      path: legacy,
      suggestion: "Remove the symlink after confirming no external tooling reads ~/.gemma-code/.",
    });
    return findings;
  }
  const size = dirSize(fsApi, legacy);
  findings.push({
    category: "legacy-state",
    severity: "warn",
    title: "Legacy ~/.gemma-code/ data root still present",
    detail: `A real ~/.gemma-code/ directory remains (${formatBytes(size.bytes)}, ${size.files} file(s)). StorageMigration stopped reading it in v1.1.0; its contents were already copied into ~/.nexus/.`,
    path: legacy,
    sizeBytes: size.bytes,
    suggestion: "Verify Nexus works against ~/.nexus/, then delete ~/.gemma-code/ to reclaim space.",
  });
  return findings;
}

function inventoryMigrationMarker(inputs: DoctorInputs, fsApi: DoctorFsApi): DoctorFinding[] {
  const marker = path.join(inputs.nexusHome, MIGRATION_MARKER_FILE);
  if (!fsApi.existsSync(marker)) return [];
  return [
    {
      category: "migration-marker",
      severity: "info",
      title: "Migration marker present",
      detail:
        "~/.nexus/ carries the migrated-from-gemma-code marker, confirming the v1.0.0 storage migration ran.",
      path: marker,
      suggestion: "Informational only; the marker can be left in place.",
    },
  ];
}

function inventoryStaleCaches(inputs: DoctorInputs, fsApi: DoctorFsApi): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const staleDays = inputs.staleCacheDays ?? 30;
  const nowMs = (inputs.now ? inputs.now() : new Date()).getTime();
  for (const name of KNOWN_CACHE_DIRS) {
    const dir = path.join(inputs.nexusHome, name);
    if (!fsApi.existsSync(dir)) continue;
    const size = dirSize(fsApi, dir);
    let ageDays: number | null = null;
    try {
      ageDays = Math.floor((nowMs - fsApi.statSync(dir).mtimeMs) / DAY_MS);
    } catch {
      ageDays = null;
    }
    const stale = ageDays !== null && ageDays >= staleDays;
    findings.push({
      category: "stale-cache",
      severity: stale ? "warn" : "info",
      title: stale ? `Stale cache dir: ${name}` : `Cache dir: ${name}`,
      detail:
        `${formatBytes(size.bytes)} across ${size.files} file(s)` +
        (ageDays !== null ? `, last modified ${ageDays} day(s) ago` : "") +
        (stale ? ` (>= ${staleDays}-day staleness threshold)` : "") +
        ". Caches are safe to delete; Nexus regenerates them on demand.",
      path: dir,
      sizeBytes: size.bytes,
      suggestion: stale ? `Delete ${name}/ to reclaim ${formatBytes(size.bytes)}.` : undefined,
    });
  }
  return findings;
}

function inventoryDuplicateSkills(inputs: DoctorInputs, fsApi: DoctorFsApi): DoctorFinding[] {
  const roots = inputs.skillRoots ?? [];
  if (roots.length === 0) return [];
  // name -> set of source labels it appears under
  const byName = new Map<string, Set<string>>();
  for (const root of roots) {
    const files: string[] = [];
    walkSkillFiles(fsApi, root.dir, files);
    for (const file of files) {
      const name = readSkillName(fsApi, file);
      if (!name) continue;
      let sources = byName.get(name);
      if (!sources) {
        sources = new Set<string>();
        byName.set(name, sources);
      }
      sources.add(root.source);
    }
  }
  const findings: DoctorFinding[] = [];
  for (const [name, sources] of byName) {
    if (sources.size < 2) continue;
    const where = Array.from(sources).sort().join(", ");
    findings.push({
      category: "duplicate-skill",
      severity: "warn",
      title: `Duplicate skill name: ${name}`,
      detail: `The skill "${name}" is defined under multiple roots (${where}). nexus.skills.preferUpstream decides which wins in autocomplete; the loser is shadowed.`,
      suggestion: `Remove or rename one copy of "${name}" so a single root owns it.`,
    });
  }
  return findings.sort((a, b) => a.title.localeCompare(b.title));
}

function inventorySymlinks(inputs: DoctorInputs, fsApi: DoctorFsApi): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const root = inputs.nexusHome;
  let entries: nodeFs.Dirent[];
  try {
    entries = fsApi.readdirSync(root, { withFileTypes: true }) as nodeFs.Dirent[];
  } catch {
    return findings;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    let dangling = false;
    try {
      // statSync resolves the link target; ENOENT => dangling.
      fsApi.statSync(full);
    } catch {
      dangling = true;
    }
    findings.push({
      category: "symlink",
      severity: dangling ? "warn" : "info",
      title: dangling ? `Dangling symlink: ${entry.name}` : `Symlink: ${entry.name}`,
      detail: dangling
        ? "Symlink under ~/.nexus/ whose target no longer exists."
        : "Symlink under ~/.nexus/. Reported for visibility; not necessarily a problem.",
      path: full,
      suggestion: dangling ? `Remove the dangling symlink ${entry.name}.` : undefined,
    });
  }
  return findings;
}

function inventoryMemoryState(inputs: DoctorInputs, fsApi: DoctorFsApi): DoctorFinding[] {
  const dir = path.join(inputs.nexusHome, "memory");
  if (!fsApi.existsSync(dir)) return [];
  const size = dirSize(fsApi, dir);
  return [
    {
      category: "memory-state",
      severity: "info",
      title: "Memory state",
      detail: `~/.nexus/memory holds ${formatBytes(size.bytes)} across ${size.files} file(s). Inspect with \`nexus memory audit\`; prune with \`nexus memory decay --now\`.`,
      path: dir,
      sizeBytes: size.bytes,
      suggestion: undefined,
    },
  ];
}

/**
 * Build the full doctor report from injected inputs. Pure with respect to
 * disk mutation: it only reads. The summary pass (no `migrationReport`)
 * still runs every producer -- the flag only changes how much per-entry
 * detail the renderer surfaces; the underlying inventory is identical so
 * the JSON shape is stable.
 */
export function buildDoctorReport(inputs: DoctorInputs): DoctorReport {
  const fsApi = inputs.fsApi ?? (nodeFs as unknown as DoctorFsApi);
  const now = inputs.now ? inputs.now() : new Date();

  const findings: DoctorFinding[] = [
    ...inventoryLegacyState(inputs, fsApi),
    ...inventoryMigrationMarker(inputs, fsApi),
    ...inventoryStaleCaches(inputs, fsApi),
    ...inventoryDuplicateSkills(inputs, fsApi),
    ...inventorySymlinks(inputs, fsApi),
    ...inventoryMemoryState(inputs, fsApi),
  ];

  let info = 0;
  let warn = 0;
  for (const f of findings) {
    if (f.severity === "warn") warn += 1;
    else info += 1;
  }

  return {
    generatedAt: now.toISOString(),
    nexusHome: inputs.nexusHome,
    legacyGemmaHome: inputs.legacyGemmaHome,
    migrationReport: inputs.migrationReport === true,
    findings,
    summary: { info, warn, total: findings.length },
  };
}

/** Render the report as a human-readable plain-text block. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("nexus doctor -- stale-state inventory (read-only; nothing was modified)");
  lines.push(`  generated: ${report.generatedAt}`);
  lines.push(`  nexus home: ${report.nexusHome}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No stale state detected. Nothing to clean up.");
    lines.push("");
    return lines.join("\n");
  }

  // Group by category so the report reads section-by-section.
  const order = [
    "legacy-state",
    "migration-marker",
    "stale-cache",
    "duplicate-skill",
    "symlink",
    "memory-state",
  ];
  const grouped = new Map<string, DoctorFinding[]>();
  for (const f of report.findings) {
    const list = grouped.get(f.category) ?? [];
    list.push(f);
    grouped.set(f.category, list);
  }

  for (const category of order) {
    const list = grouped.get(category);
    if (!list || list.length === 0) continue;
    lines.push(`## ${category} (${list.length})`);
    for (const f of list) {
      const tag = f.severity === "warn" ? "[warn]" : "[info]";
      lines.push(`  ${tag} ${f.title}`);
      lines.push(`         ${f.detail}`);
      if (report.migrationReport && f.path) lines.push(`         path: ${f.path}`);
      if (report.migrationReport && f.suggestion) lines.push(`         suggestion: ${f.suggestion}`);
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${report.summary.total} finding(s) -- ${report.summary.warn} warning(s), ${report.summary.info} info.`,
  );
  if (!report.migrationReport) {
    lines.push("Re-run with --migration-report for per-entry paths and suggested next steps.");
  }
  lines.push("");
  return lines.join("\n");
}
