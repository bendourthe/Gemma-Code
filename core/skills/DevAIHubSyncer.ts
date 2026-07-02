/**
 * v1.0.0 Phase 10.2 -- DevAI-Hub sync core.
 *
 * Pull a pinned `bendourthe/Nexus-Hub` release into
 * `~/.nexus/skills/devai-hub/<tag>/`, scan it with the prompt-injection
 * scanner (Phase 10.3), and present a manifest diff. The CLI in
 * `bin/nexus.mjs` is a thin shell on top of this module.
 *
 * The sync pipeline:
 *   1. Resolve the latest pinned tag (or use --tag).
 *   2. If the active install matches the requested tag's content hash,
 *      report "already up to date".
 *   3. Otherwise sparse-clone into a tmp dir
 *      (`~/.nexus/skills/.tmp-devai-hub-<tag>/`).
 *   4. Compute a content hash over the checked-out tree.
 *   5. Write `manifest.json` describing the bundle.
 *   6. Diff against the currently-active tag's manifest.
 *   7. Cross-verify the cloned files against the Hub's published
 *      `MANIFEST.sha256` (rides inside the release tag) -- ADVISORY: the result
 *      is surfaced but does not block (the upstream manifest is not currently
 *      EOL-deterministic). The injection scanner remains the fail-closed gate.
 *   8. If `--apply` (and the scan did not block), rename the tmp dir to the
 *      active dir and update the active-tag pointer
 *      (`~/.nexus/skills/devai-hub/ACTIVE`).
 *
 * Tarball fallback: when git is unavailable the syncer downloads
 * `archive/refs/tags/<tag>.tar.gz` and extracts it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { PromptInjectionScanner, type ScanResult } from "./PromptInjectionScanner.js";
import { HUB_SKILL_SCAN_ALLOWLIST } from "./hubSkillScanAllowlist.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncDependencies {
  /** Resolve the latest released tag on the upstream repo. */
  resolveLatestTag: () => Promise<string>;
  /** Sparse-clone the pinned tag into `destDir`. Throws if git is unavailable. */
  sparseClone: (tag: string, destDir: string) => Promise<void>;
  /** Tarball fallback: extract `archive/refs/tags/<tag>.tar.gz` into `destDir`. */
  tarballFetch: (tag: string, destDir: string) => Promise<void>;
  /** Whether `git` is on $PATH. Defaults to `true` in production. */
  hasGit: () => Promise<boolean>;
}

export interface SyncOptions {
  /** Tag to pull. Omit to use the latest. */
  tag?: string;
  /** Apply the result to the active install pointer when set. */
  apply?: boolean;
  /** Root of the user's `.nexus/skills/` tree (defaults to `~/.nexus/skills`). */
  skillsRoot?: string;
  /** Inject deps for tests. */
  deps?: SyncDependencies;
  /** Custom scanner (tests). */
  scanner?: PromptInjectionScanner;
  /**
   * Override the upstream repo. Defaults to `bendourthe/Nexus-Hub`. Used by
   * integration tests against a local fixture.
   */
  upstream?: string;
}

export interface SkillEntry {
  /** Relative path to the SKILL.md (`catalog/skills/<cat>/<slug>/SKILL.md`). */
  readonly relPath: string;
  /** Slug derived from the parent directory of the SKILL.md. */
  readonly name: string;
  /** SHA-256 over the SKILL.md body. */
  readonly contentHash: string;
  /**
   * Category from the Hub's `data/skills.json` index, when the index is present
   * and lists this skill (HUB.P3.DATA). Purely additive metadata: it never
   * affects the bundle hash (which is computed from relPath + contentHash only),
   * so the "already up to date" short-circuit is unchanged.
   */
  readonly category?: string;
}

/** A single skill row read from the Hub's `data/skills.json` index. */
export interface SkillIndexEntry {
  /** relPath relative to `catalog/skills` (matches `SkillEntry.relPath`). */
  readonly relPath: string;
  readonly name: string;
  readonly category?: string;
}

/** Divergence between the Hub's `data/skills.json` index and the on-disk tree. */
export interface IndexConsistency {
  /** Skills the index lists that have no SKILL.md on disk. */
  readonly onlyInIndex: readonly string[];
  /** SKILL.md files on disk the index does not list. */
  readonly onlyOnDisk: readonly string[];
}

export interface DevAIHubManifest {
  readonly tag: string;
  readonly upstream: string;
  /** ISO timestamp the manifest was written. */
  readonly fetchedAt: string;
  /** SHA-256 over the sorted skill hashes (stable across reorderings). */
  readonly bundleHash: string;
  readonly skills: readonly SkillEntry[];
}

export interface ManifestDiff {
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Result of cross-verifying a synced bundle against the Hub's published
 * `MANIFEST.sha256` (a standard `sha256sum` text file that rides inside the
 * release tag, per Nexus-Hub v3.6.0/v3.10.0). This is supply-chain integrity
 * *evidence*: it confirms the files we actually cloned hash to what the release
 * authoritatively published. It is scoped to the sparse subset we fetch --
 * manifest entries for files outside that subset are simply not checked, so an
 * intentionally-unsynced file is never reported as a problem.
 */
export interface ManifestVerification {
  /** `false` when the release ships no `MANIFEST.sha256` (older tags). A no-op. */
  readonly present: boolean;
  /** Number of cloned files that appeared in the manifest and were hashed. */
  readonly checked: number;
  /** relPaths whose on-disk SHA-256 did not match the published manifest. */
  readonly mismatched: readonly string[];
}

export interface SyncResult {
  readonly tag: string;
  readonly tmpDir: string;
  readonly manifest: DevAIHubManifest;
  /** Diff against the currently-active manifest (`null` when no active install). */
  readonly diff: ManifestDiff;
  readonly scan: ScanResult;
  /** `true` when the requested tag's contentHash matches the active install. */
  readonly alreadyUpToDate: boolean;
  /** `true` when --apply ran and rotated the active pointer. */
  readonly applied: boolean;
  /** When applied, the new active dir; otherwise null. */
  readonly activeDir: string | null;
  /**
   * Index-vs-tree divergence from the Hub's `data/skills.json` (HUB.P3.DATA).
   * `null` when the bundle ships no index. Non-empty lists are a Hub-side
   * integrity signal (the published index lags or leads its own skills tree);
   * they never block the sync because the on-disk tree is authoritative.
   */
  readonly indexConsistency: IndexConsistency | null;
  /**
   * Cross-verification of the cloned files against the Hub's published
   * `MANIFEST.sha256`. ADVISORY only -- it never blocks `--apply` (the current
   * upstream manifest is not EOL-deterministic; see the note in `sync`). A
   * non-empty `mismatched` list is surfaced for operator review, not enforced.
   */
  readonly manifestVerification: ManifestVerification;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// v1.4.0 Phase 9 (T033, gap 1.1.P3.B): the upstream skill catalog repo was
// renamed `bendourthe/DevAI-Hub` -> `bendourthe/Nexus-Hub`. The old name was
// the documented blocker for `nexus skills sync` (it resolved no release tag).
// The local on-disk namespace (`~/.nexus/skills/devai-hub/`, the ACTIVE
// pointer, and the `source: "devai-hub"` provenance label) is intentionally
// left unchanged: it is an on-disk contract, not the GitHub coordinate.
export const DEFAULT_UPSTREAM = "bendourthe/Nexus-Hub";

export function defaultSkillsRoot(): string {
  return path.join(os.homedir(), ".nexus", "skills");
}

/**
 * Sparse-checkout paths fetched from a Hub release. These MUST be directory
 * paths: git's cone-mode sparse-checkout (>= 2.36) rejects a file argument with
 * `fatal: '<path>' is not a directory` (older git only warned, so a file arg
 * here silently broke a live sync on any modern git). Two consequences:
 *   - `data` (the directory) is listed, not `data/skills.json` (the file), so
 *     the Hub skill index still lands in the bundle (HUB.P3.DATA).
 *   - The Hub v3.10.0 release `MANIFEST.sha256` is NOT listed: it lives at the
 *     repo root, and cone mode always checks out files in the repo root
 *     automatically -- that is how `verifyReleaseManifest` gets the manifest
 *     without a (rejected) file argument.
 */
export const HUB_SPARSE_CHECKOUT_PATHS: readonly string[] = Object.freeze([
  "catalog/skills",
  "catalog/commands",
  "catalog/agents",
  // v1.5.0 Phase 7 (HUB.P3.HOOK): Hub hook scripts for the HubHookInstaller.
  "catalog/hooks",
  "catalog/rules",
  "rules",
  // The `data` directory carries the Hub skill index (`data/skills.json`).
  "data",
  "extensions",
]);

/**
 * Path of the file that names the currently-active DevAI-Hub tag. The
 * SkillLoader watches this file and reloads when its content changes.
 */
export function activeTagPointerPath(skillsRoot: string): string {
  return path.join(skillsRoot, "devai-hub", "ACTIVE");
}

export function tagDir(skillsRoot: string, tag: string): string {
  return path.join(skillsRoot, "devai-hub", tag);
}

export function tmpDirFor(skillsRoot: string, tag: string): string {
  return path.join(skillsRoot, `.tmp-devai-hub-${tag}`);
}

// ---------------------------------------------------------------------------
// Manifest + diff helpers
// ---------------------------------------------------------------------------

/** Walk `root` for every `SKILL.md` and return a sorted manifest. */
export function buildManifest(
  root: string,
  tag: string,
  upstream: string,
  now: Date = new Date(),
): DevAIHubManifest {
  const skills: SkillEntry[] = [];
  if (fs.existsSync(root)) {
    walkSkillMd(root, root, skills);
  }
  skills.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const bundleHash = createHash("sha256");
  for (const entry of skills) {
    bundleHash.update(entry.relPath);
    bundleHash.update("\0");
    bundleHash.update(entry.contentHash);
    bundleHash.update("\0");
  }

  return {
    tag,
    upstream,
    fetchedAt: now.toISOString(),
    bundleHash: bundleHash.digest("hex"),
    skills,
  };
}

function walkSkillMd(root: string, dir: string, out: SkillEntry[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkSkillMd(root, full, out);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(full);
      } catch {
        continue;
      }
      const contentHash = createHash("sha256").update(buf).digest("hex");
      const relPath = path.relative(root, full).replace(/\\/g, "/");
      const name = path.basename(path.dirname(full));
      out.push({ relPath, name, contentHash });
    }
  }
}

/** Compute the added / modified / removed slug lists between two manifests. */
export function diffManifests(
  prev: DevAIHubManifest | null,
  next: DevAIHubManifest,
): ManifestDiff {
  if (!prev) {
    return {
      added: next.skills.map((s) => s.relPath),
      modified: [],
      removed: [],
    };
  }
  const prevByPath = new Map(prev.skills.map((s) => [s.relPath, s.contentHash]));
  const nextByPath = new Map(next.skills.map((s) => [s.relPath, s.contentHash]));

  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [relPath, hash] of nextByPath) {
    const prevHash = prevByPath.get(relPath);
    if (prevHash === undefined) added.push(relPath);
    else if (prevHash !== hash) modified.push(relPath);
  }
  for (const relPath of prevByPath.keys()) {
    if (!nextByPath.has(relPath)) removed.push(relPath);
  }

  added.sort();
  modified.sort();
  removed.sort();
  return { added, modified, removed };
}

/** Render a one-line human-friendly summary (`+12 new, ~3 modified, -1 removed`). */
export function summarizeDiff(diff: ManifestDiff): string {
  return `+${diff.added.length} new, ~${diff.modified.length} modified, -${diff.removed.length} removed`;
}

// ---------------------------------------------------------------------------
// Skill index (HUB.P3.DATA) -- consume the Hub's data/skills.json
// ---------------------------------------------------------------------------

/** Default path of the Hub skill index inside a synced bundle. */
export function skillIndexPath(bundleDir: string): string {
  return path.join(bundleDir, "data", "skills.json");
}

/**
 * Read the Hub's `data/skills.json` from a synced bundle (HUB.P3.DATA). Returns
 * the listed skills normalized to `relPath` (relative to `catalog/skills`, so it
 * lines up with `SkillEntry.relPath`), or `null` when the file is absent or not
 * the expected shape. Best-effort: a malformed index degrades to "no index", it
 * never throws.
 */
export function readSkillIndex(bundleDir: string): SkillIndexEntry[] | null {
  let raw: string;
  try {
    raw = fs.readFileSync(skillIndexPath(bundleDir), "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const skills = (parsed as { skills?: unknown })?.skills;
  if (!Array.isArray(skills)) return null;
  const prefix = "catalog/skills/";
  const out: SkillIndexEntry[] = [];
  for (const row of skills) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as { file?: unknown; path?: unknown; name?: unknown; category?: unknown };
    // Prefer `file` (full SKILL.md path); fall back to `path` + /SKILL.md.
    let file: string | null = null;
    if (typeof r.file === "string") file = r.file;
    else if (typeof r.path === "string") file = r.path.replace(/\/?$/, "/") + "SKILL.md";
    if (!file) continue;
    const norm = file.replace(/\\/g, "/");
    if (!norm.startsWith(prefix)) continue;
    out.push({
      relPath: norm.slice(prefix.length),
      name: typeof r.name === "string" ? r.name : path.basename(path.dirname(norm)),
      category: typeof r.category === "string" ? r.category : undefined,
    });
  }
  return out;
}

/** Compute index-vs-tree divergence (both lists are sorted relPaths). */
export function computeIndexConsistency(
  manifest: DevAIHubManifest,
  index: readonly SkillIndexEntry[],
): IndexConsistency {
  const onDisk = new Set(manifest.skills.map((s) => s.relPath));
  const inIndex = new Set(index.map((e) => e.relPath));
  const onlyInIndex = [...inIndex].filter((r) => !onDisk.has(r)).sort();
  const onlyOnDisk = [...onDisk].filter((r) => !inIndex.has(r)).sort();
  return { onlyInIndex, onlyOnDisk };
}

/**
 * Build a manifest from the on-disk `catalog/skills` tree, enriched with the
 * `category` recorded in the Hub's `data/skills.json` index (HUB.P3.DATA). The
 * filesystem tree stays authoritative (it is what `SkillLoader` actually loads),
 * so a stale/leading index only affects the additive `category` field, never
 * which skills are tracked or the bundle hash. Returns the manifest plus the
 * index-vs-tree consistency report (`indexConsistency` is `null` when the bundle
 * ships no index).
 */
export function buildManifestWithIndex(
  bundleDir: string,
  tag: string,
  upstream: string,
  now: Date = new Date(),
): { manifest: DevAIHubManifest; indexConsistency: IndexConsistency | null } {
  const skillsDir = path.join(bundleDir, "catalog", "skills");
  const base = buildManifest(skillsDir, tag, upstream, now);
  const index = readSkillIndex(bundleDir);
  if (!index) {
    return { manifest: base, indexConsistency: null };
  }
  const categoryByRel = new Map<string, string | undefined>(
    index.map((e) => [e.relPath, e.category]),
  );
  const skills = base.skills.map((s) =>
    categoryByRel.has(s.relPath) ? { ...s, category: categoryByRel.get(s.relPath) } : s,
  );
  return {
    manifest: { ...base, skills },
    indexConsistency: computeIndexConsistency(base, index),
  };
}

// ---------------------------------------------------------------------------
// Release-manifest verification (supply-chain integrity)
// ---------------------------------------------------------------------------

/** Path of the Hub's published `MANIFEST.sha256` inside a synced bundle. */
export function releaseManifestPath(bundleDir: string): string {
  return path.join(bundleDir, "MANIFEST.sha256");
}

/**
 * Parse a standard `sha256sum` text manifest into a `relPath -> lowercase-hash`
 * map. Each line is `<64-hex-hash><space><space|*><relpath>` (two spaces is
 * text mode, ` *` is binary mode). Blank lines and lines that do not match are
 * skipped. Paths are normalized to forward slashes.
 */
export function parseSha256Manifest(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!m) continue;
    const hash = m[1]!.toLowerCase();
    const relPath = m[2]!.replace(/\\/g, "/");
    out.set(relPath, hash);
  }
  return out;
}

/**
 * Cross-verify a synced bundle against the Hub's published `MANIFEST.sha256`.
 *
 * Iterates the *manifest entries* (not the clone) so bundle artifacts that are
 * not part of the release -- the `.git` dir, our own `manifest.json` -- are
 * never considered. For each manifest entry whose file exists in the clone
 * (the sparse subset we fetched), the on-disk SHA-256 is compared to the
 * published hash. Entries whose files are outside the sparse subset are skipped
 * (they were intentionally not fetched, not tampered). Best-effort and
 * throw-free: a missing or unreadable manifest degrades to `present: false`.
 */
export function verifyReleaseManifest(bundleDir: string): ManifestVerification {
  let text: string;
  try {
    text = fs.readFileSync(releaseManifestPath(bundleDir), "utf-8");
  } catch {
    return { present: false, checked: 0, mismatched: [] };
  }
  const entries = parseSha256Manifest(text);
  let checked = 0;
  const mismatched: string[] = [];
  for (const [relPath, expected] of entries) {
    const full = path.join(bundleDir, relPath);
    let buf: Buffer;
    try {
      if (!fs.statSync(full).isFile()) continue;
      buf = fs.readFileSync(full);
    } catch {
      // Not in the sparse subset (or unreadable): not fetched, so not checked.
      continue;
    }
    checked += 1;
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== expected) mismatched.push(relPath);
  }
  mismatched.sort();
  return { present: true, checked, mismatched };
}

// ---------------------------------------------------------------------------
// Active-tag pointer
// ---------------------------------------------------------------------------

export function readActiveTag(skillsRoot: string): string | null {
  const ptr = activeTagPointerPath(skillsRoot);
  try {
    return fs.readFileSync(ptr, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function writeActiveTag(skillsRoot: string, tag: string): void {
  const ptr = activeTagPointerPath(skillsRoot);
  fs.mkdirSync(path.dirname(ptr), { recursive: true });
  fs.writeFileSync(ptr, tag, { encoding: "utf-8" });
}

export function readManifestOnDisk(dir: string): DevAIHubManifest | null {
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as DevAIHubManifest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Production dependency helpers
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

async function defaultHasGit(): Promise<boolean> {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["git"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

async function defaultResolveLatestTag(upstream: string): Promise<string> {
  // Lightweight fetch via Node's built-in https. Tests inject a fake.
  const { request } = await import("node:https");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "api.github.com",
        path: `/repos/${upstream}/releases/latest`,
        method: "GET",
        headers: { "User-Agent": "nexus-skills-sync", Accept: "application/vnd.github+json" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf-8")));
        res.on("end", () => {
          try {
            const obj = JSON.parse(body) as { tag_name?: string };
            if (!obj.tag_name) reject(new Error("upstream did not return tag_name"));
            else resolve(obj.tag_name);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function defaultSparseClone(upstream: string, tag: string, destDir: string): Promise<void> {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  const repoUrl = `https://github.com/${upstream}.git`;
  const cloneArgs = [
    "clone",
    "--depth=1",
    `--branch=${tag}`,
    "--filter=blob:none",
    "--sparse",
    repoUrl,
    destDir,
  ];
  const clone = spawnSync("git", cloneArgs, { stdio: "ignore" });
  if (clone.status !== 0) throw new Error(`git clone failed (exit ${clone.status ?? "?"})`);
  // Check out canonical LF content. The Hub commits LF blobs under `* text=auto`,
  // so a Windows CRLF smudge on checkout would corrupt byte-faithfulness versus
  // the release tarball + MANIFEST.sha256. Persist the settings in the clone's
  // config so the sparse-checkout below (which is what actually materializes the
  // files) honors them. Best-effort: a failure here just falls back to native EOL.
  spawnSync("git", ["-C", destDir, "config", "core.autocrlf", "false"], { stdio: "ignore" });
  spawnSync("git", ["-C", destDir, "config", "core.eol", "lf"], { stdio: "ignore" });
  const sparse = spawnSync(
    "git",
    ["-C", destDir, "sparse-checkout", "set", ...HUB_SPARSE_CHECKOUT_PATHS],
    { stdio: "ignore" },
  );
  if (sparse.status !== 0) throw new Error(`git sparse-checkout failed (exit ${sparse.status ?? "?"})`);
}

async function defaultTarballFetch(upstream: string, tag: string, destDir: string): Promise<void> {
  // Use spawn to call `tar` after fetching the archive with curl. We don't
  // include this path in unit tests; integration covers it with a fixture.
  const { request } = await import("node:https");
  fs.mkdirSync(destDir, { recursive: true });
  const tmpFile = path.join(destDir, "archive.tar.gz");
  await new Promise<void>((resolve, reject) => {
    const req = request(
      {
        host: "github.com",
        path: `/${upstream}/archive/refs/tags/${tag}.tar.gz`,
        method: "GET",
        headers: { "User-Agent": "nexus-skills-sync" },
      },
      (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          reject(new Error("tarball fetch redirect not handled in default impl; pass a custom deps.tarballFetch"));
          return;
        }
        const stream = fs.createWriteStream(tmpFile);
        res.pipe(stream);
        stream.on("finish", () => stream.close(() => resolve()));
        stream.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
  const tar = spawnSync("tar", ["-xzf", tmpFile, "-C", destDir, "--strip-components=1"], {
    stdio: "ignore",
  });
  if (tar.status !== 0) throw new Error("tar extraction failed");
  fs.unlinkSync(tmpFile);
}

/**
 * Build a production-defaults `SyncDependencies` bound to `upstream`.
 */
export function defaultDependencies(upstream: string = DEFAULT_UPSTREAM): SyncDependencies {
  return {
    resolveLatestTag: () => defaultResolveLatestTag(upstream),
    sparseClone: (tag, dest) => defaultSparseClone(upstream, tag, dest),
    tarballFetch: (tag, dest) => defaultTarballFetch(upstream, tag, dest),
    hasGit: defaultHasGit,
  };
}

// ---------------------------------------------------------------------------
// Main syncer
// ---------------------------------------------------------------------------

export class DevAIHubSyncer {
  private readonly _skillsRoot: string;
  private readonly _deps: SyncDependencies;
  private readonly _scanner: PromptInjectionScanner;
  private readonly _upstream: string;

  constructor(options: SyncOptions = {}) {
    this._skillsRoot = options.skillsRoot ?? defaultSkillsRoot();
    this._upstream = options.upstream ?? DEFAULT_UPSTREAM;
    this._deps = options.deps ?? defaultDependencies(this._upstream);
    // The default scanner carries the reviewed Hub-skill allowlist (HUB310.SCAN):
    // the pinned devai-hub source is a trusted producer catalog whose security
    // skills contain the patterns they teach. Untrusted third-party imports
    // (SkillInstaller) construct their own scanner with no suppressions.
    this._scanner = options.scanner ?? new PromptInjectionScanner(undefined, HUB_SKILL_SCAN_ALLOWLIST);
  }

  /**
   * Run the full sync pipeline. The default behaviour is "preview-only"
   * (the tmp dir is left intact for the user to review). Pass `apply: true`
   * to rotate the active pointer atomically.
   */
  async sync(options: { tag?: string; apply?: boolean } = {}): Promise<SyncResult> {
    const tag = options.tag ?? (await this._deps.resolveLatestTag());
    if (!tag || !/^[A-Za-z0-9._\-+]+$/.test(tag)) {
      throw new Error(`invalid tag: ${tag}`);
    }

    const activeTag = readActiveTag(this._skillsRoot);
    const activeDir = activeTag ? tagDir(this._skillsRoot, activeTag) : null;
    const activeManifest = activeDir ? readManifestOnDisk(activeDir) : null;

    // Short-circuit: already up to date.
    const candidateDir = tagDir(this._skillsRoot, tag);
    const candidateManifest = readManifestOnDisk(candidateDir);
    if (
      activeTag === tag &&
      candidateManifest &&
      activeManifest &&
      candidateManifest.bundleHash === activeManifest.bundleHash
    ) {
      return {
        tag,
        tmpDir: candidateDir,
        manifest: candidateManifest,
        diff: { added: [], modified: [], removed: [] },
        scan: { decision: "pass", findings: [] },
        alreadyUpToDate: true,
        applied: false,
        activeDir: candidateDir,
        // Nothing was re-fetched, so no fresh index check is performed.
        indexConsistency: null,
        manifestVerification: { present: false, checked: 0, mismatched: [] },
      };
    }

    const tmpDir = tmpDirFor(this._skillsRoot, tag);
    // Clean any leftover tmp dir from a prior aborted run.
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    if (await this._deps.hasGit()) {
      await this._deps.sparseClone(tag, tmpDir);
    } else {
      await this._deps.tarballFetch(tag, tmpDir);
    }

    const skillsDir = path.join(tmpDir, "catalog", "skills");
    // HUB.P3.DATA: build from the on-disk tree (authoritative) but enrich each
    // entry with the category recorded in the Hub's data/skills.json index, and
    // capture any index-vs-tree divergence for the caller to surface.
    const { manifest, indexConsistency } = buildManifestWithIndex(tmpDir, tag, this._upstream);
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const scan = scanBundleDir(skillsDir, this._scanner);
    const diff = diffManifests(activeManifest, manifest);

    // Supply-chain integrity: verify the cloned files against the Hub's
    // published MANIFEST.sha256 (rides inside the release tag). This is
    // ADVISORY, not fail-closed: the current Hub manifest is not EOL-
    // deterministic (it was generated from a Windows working tree, so some
    // entries are hashed over CRLF and some over LF), which makes a byte-level
    // match against any single git checkout unreliable. Blocking on it would
    // reject every legitimate sync. We still compute + surface the result so
    // the operator can review it, and so it becomes a hard signal automatically
    // once the Hub publishes a deterministic (LF) manifest. The injection
    // scanner remains the fail-closed content gate. (Gap: HUB310.4.2.ADV.)
    const manifestVerification = verifyReleaseManifest(tmpDir);

    let applied = false;
    let appliedActiveDir: string | null = null;
    if (options.apply && scan.decision !== "block") {
      const dest = tagDir(this._skillsRoot, tag);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(tmpDir, dest);
      writeActiveTag(this._skillsRoot, tag);
      applied = true;
      appliedActiveDir = dest;
    }

    return {
      tag,
      tmpDir: applied ? appliedActiveDir! : tmpDir,
      manifest,
      diff,
      scan,
      alreadyUpToDate: false,
      applied,
      activeDir: applied ? appliedActiveDir : activeDir,
      indexConsistency,
      manifestVerification,
    };
  }
}

function scanBundleDir(dir: string, scanner: PromptInjectionScanner): ScanResult {
  const files: { path: string; content: string }[] = [];
  if (fs.existsSync(dir)) collectScannableFiles(dir, dir, files);
  return scanner.scanBundle(files);
}

function collectScannableFiles(
  root: string,
  dir: string,
  out: { path: string; content: string }[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collectScannableFiles(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      entry.name === "SKILL.md" ||
      entry.name.endsWith(".sh") ||
      entry.name.endsWith(".ps1") ||
      entry.name.endsWith(".mjs") ||
      entry.name.endsWith(".cjs") ||
      entry.name.endsWith(".js")
    ) {
      try {
        const content = fs.readFileSync(full, "utf-8");
        out.push({ path: path.relative(root, full).replace(/\\/g, "/"), content });
      } catch {
        /* skip */
      }
    }
  }
}
