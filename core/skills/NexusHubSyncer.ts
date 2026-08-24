/**
 * v1.0.0 Phase 10.2 -- Nexus-Hub sync core.
 * v1.10.0 Phase 2 -- renamed from `DevAIHubSyncer`; retargeted to the single
 * standardized catalog subtree `~/.nexus-ai/catalog/` (read like `~/.claude/`).
 *
 * Pull a pinned `bendourthe/Nexus-Hub` release into `~/.nexus-ai/catalog/`, scan
 * it with the prompt-injection scanner, and present a manifest diff. The CLI in
 * `bin/nexus.mjs` is a thin shell on top of this module.
 *
 * The sync pipeline:
 *   1. Resolve the latest released tag (or use --tag).
 *   2. If the installed `nexus-hub-version.json` already records that tag,
 *      report "already up to date".
 *   3. Otherwise sparse-clone into a tmp staging dir that is a SIBLING of the
 *      catalog subtree (`~/.nexus-ai/.tmp-catalog-<tag>/`), never inside app data.
 *   4. Build a manifest over the staged `catalog/skills` tree and scan it.
 *   5. Diff against the currently-installed catalog's skills tree.
 *   6. Cross-verify the cloned files against the Hub's published
 *      `MANIFEST.sha256` -- ADVISORY (does not block; the injection scanner is
 *      the fail-closed gate).
 *   7. If `--apply` (and the scan did not block), atomically swap the staged
 *      `catalog/` directory into `~/.nexus-ai/catalog/` and write a deterministic
 *      `nexus-hub-version.json`.
 *
 * SAFETY (v1.10.0): every destructive operation is scoped to the catalog subtree
 * (`assertScopedCatalogRoot`). The syncer never touches `~/.nexus/` or app data;
 * the catalog refresh is structurally unable to escape its own subtree.
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
import {
  catalogRoot as resolveCatalogRoot,
  hubLayoutDir,
  type HubLayout,
} from "../storage/paths.js";
import {
  readHubVersionManifest,
  writeHubVersionManifest,
  resolveHubLayout,
} from "../storage/hubVersionManifest.js";

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
  /** Apply the result to the installed catalog when set. */
  apply?: boolean;
  /** Root of the isolated catalog subtree (defaults to `~/.nexus-ai/catalog`). */
  catalogRoot?: string;
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
  /** Relative path to the SKILL.md, relative to the catalog `skills/` dir. */
  readonly relPath: string;
  /** Slug derived from the parent directory of the SKILL.md. */
  readonly name: string;
  /** SHA-256 over the SKILL.md body. */
  readonly contentHash: string;
  /**
   * Category from the Hub's `data/skills.json` index, when the index is present
   * and lists this skill. Purely additive metadata: it never affects the bundle
   * hash (which is computed from relPath + contentHash only).
   */
  readonly category?: string;
}

/** A single skill row read from the Hub's `data/skills.json` index. */
export interface SkillIndexEntry {
  /** relPath relative to the catalog `skills/` dir (matches `SkillEntry.relPath`). */
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

export interface NexusHubManifest {
  readonly tag: string;
  readonly upstream: string;
  /** ISO timestamp the manifest was built (in-memory only; not persisted). */
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
 * release tag). Supply-chain integrity *evidence*, scoped to the sparse subset
 * we fetch -- manifest entries for files outside that subset are simply not
 * checked, so an intentionally-unsynced file is never reported as a problem.
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
  readonly manifest: NexusHubManifest;
  /** Diff against the previously-installed catalog (`null`-safe when fresh). */
  readonly diff: ManifestDiff;
  readonly scan: ScanResult;
  /** `true` when the installed version already matches the requested tag. */
  readonly alreadyUpToDate: boolean;
  /** `true` when --apply ran and swapped the catalog subtree. */
  readonly applied: boolean;
  /** The catalog root when a catalog is installed; otherwise null. */
  readonly activeDir: string | null;
  /**
   * Index-vs-tree divergence from the Hub's `data/skills.json`. `null` when the
   * bundle ships no index. Never blocks the sync (the on-disk tree is
   * authoritative).
   */
  readonly indexConsistency: IndexConsistency | null;
  /**
   * Cross-verification of the cloned files against the Hub's published
   * `MANIFEST.sha256`. ADVISORY only -- it never blocks `--apply`.
   */
  readonly manifestVerification: ManifestVerification;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// The upstream skill catalog repo. The local on-disk store was retargeted in
// v1.10.0 from the version-scoped `~/.nexus/skills/devai-hub/<tag>/` path to the
// single standardized subtree `~/.nexus-ai/catalog/` (see `core/storage/paths.ts`).
export const DEFAULT_UPSTREAM = "bendourthe/Nexus-Hub";

/**
 * Sparse-checkout paths fetched from a Hub release. These MUST be directory
 * paths: git's cone-mode sparse-checkout (>= 2.36) rejects a file argument.
 *   - `catalog` is the entire published catalog; it becomes `~/.nexus-ai/catalog/`
 *     verbatim on apply (repo `catalog/skills` -> `<catalogRoot>/skills`).
 *   - `.claude-plugin` carries `plugin.json`, the catalog's declared version
 *     (read for `nexus-hub-version.json`); it is read from the staging clone and
 *     is NOT part of the applied catalog subtree.
 * Cone mode auto-checks-out repo-root files (e.g. `MANIFEST.sha256`), so those
 * are available to `verifyReleaseManifest` without a (rejected) file argument.
 */
export const HUB_SPARSE_CHECKOUT_PATHS: readonly string[] = Object.freeze([
  "catalog",
  ".claude-plugin",
]);

export function defaultSkillsRoot(): string {
  return path.join(os.homedir(), ".nexus", "skills");
}

// v1.10.0 Phase 3: the legacy `~/.nexus/skills/devai-hub/<tag>/` + ACTIVE-pointer
// path helpers were removed here once the readers rerouted to the catalog
// resolver (`core/storage/paths.ts` + `hubVersionManifest.ts`). The single-root
// model needs no per-tag pointer -- the installed version lives in
// `nexus-hub-version.json`. (`defaultSkillsRoot`, above, stays: it is the
// app-data user-skills root, not the Hub catalog.)

// ---------------------------------------------------------------------------
// Subtree-scope guard
// ---------------------------------------------------------------------------

/**
 * Guard: the syncer's destructive operations (wipe + swap) may only ever touch
 * the catalog subtree it owns. Refuse an empty path or a filesystem root so a
 * misconfigured `catalogRoot` can never escalate into deleting app data or the
 * home directory. This is the structural backstop behind the "catalog refresh
 * can never touch app data" invariant (v1.10.0).
 */
export function assertScopedCatalogRoot(root: string): void {
  if (!root || root.trim() === "") {
    throw new Error("NexusHubSyncer: catalog root must not be empty");
  }
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || path.dirname(resolved) === resolved) {
    throw new Error(
      `NexusHubSyncer: refusing to operate on a filesystem root: ${resolved}`,
    );
  }
}

/** Read the catalog's declared version from a cloned `.claude-plugin/plugin.json`. */
function readPluginVersion(repoDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(repoDir, ".claude-plugin", "plugin.json"), "utf-8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version.trim() !== "" ? version : null;
  } catch {
    return null;
  }
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
): NexusHubManifest {
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
  prev: NexusHubManifest | null,
  next: NexusHubManifest,
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
// Skill index -- consume the Hub's data/skills.json (when present)
// ---------------------------------------------------------------------------

/** Default path of the Hub skill index inside a synced catalog dir. */
export function skillIndexPath(bundleDir: string): string {
  return path.join(bundleDir, "data", "skills.json");
}

/**
 * Read the Hub's `data/skills.json` from a synced catalog dir. Returns the listed
 * skills normalized to `relPath` (relative to the `skills/` dir, matching
 * `SkillEntry.relPath`), or `null` when the file is absent or not the expected
 * shape. Best-effort: a malformed index degrades to "no index", never throws.
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
  manifest: NexusHubManifest,
  index: readonly SkillIndexEntry[],
): IndexConsistency {
  const onDisk = new Set(manifest.skills.map((s) => s.relPath));
  const inIndex = new Set(index.map((e) => e.relPath));
  const onlyInIndex = [...inIndex].filter((r) => !onDisk.has(r)).sort();
  const onlyOnDisk = [...onDisk].filter((r) => !inIndex.has(r)).sort();
  return { onlyInIndex, onlyOnDisk };
}

/**
 * Build a manifest from the on-disk `skills/` tree, enriched with the `category`
 * recorded in the Hub's `data/skills.json` index (when present). The filesystem
 * tree stays authoritative, so a stale/leading index only affects the additive
 * `category` field, never which skills are tracked or the bundle hash.
 *
 * `bundleDir` is the catalog dir (skills at `<bundleDir>/skills`, index at
 * `<bundleDir>/data/skills.json`) -- v1.10.0 dropped the old `catalog/` prefix
 * so the local layout matches `~/.nexus-ai/catalog/`.
 */
export function buildManifestWithIndex(
  bundleDir: string,
  tag: string,
  upstream: string,
  now: Date = new Date(),
): { manifest: NexusHubManifest; indexConsistency: IndexConsistency | null } {
  const skillsDir = path.join(bundleDir, "skills");
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

/** Path of the Hub's published `MANIFEST.sha256` inside a cloned repo dir. */
export function releaseManifestPath(bundleDir: string): string {
  return path.join(bundleDir, "MANIFEST.sha256");
}

/**
 * Parse a standard `sha256sum` text manifest into a `relPath -> lowercase-hash`
 * map. Each line is `<64-hex-hash><space><space|*><relpath>`. Blank / non-matching
 * lines are skipped. Paths are normalized to forward slashes.
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
 * Cross-verify a cloned repo dir against the Hub's published `MANIFEST.sha256`.
 * Iterates the manifest entries (not the clone) so artifacts not part of the
 * release are never considered. Entries whose files are outside the sparse
 * subset are skipped. Best-effort and throw-free: a missing manifest degrades
 * to `present: false`.
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
  // Check out canonical LF content so a Windows CRLF smudge does not corrupt
  // byte-faithfulness versus the release tarball + MANIFEST.sha256. Best-effort.
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

export class NexusHubSyncer {
  private readonly _catalogRoot: string;
  private readonly _deps: SyncDependencies;
  private readonly _scanner: PromptInjectionScanner;
  private readonly _upstream: string;

  constructor(options: SyncOptions = {}) {
    this._catalogRoot = options.catalogRoot ?? resolveCatalogRoot();
    this._upstream = options.upstream ?? DEFAULT_UPSTREAM;
    this._deps = options.deps ?? defaultDependencies(this._upstream);
    // The default scanner carries the reviewed Hub-skill allowlist: the trusted
    // upstream source is a producer catalog whose security skills contain
    // the patterns they teach. Untrusted third-party imports (SkillInstaller)
    // construct their own scanner with no suppressions.
    this._scanner = options.scanner ?? new PromptInjectionScanner(undefined, HUB_SKILL_SCAN_ALLOWLIST);
  }

  /** Staging dir: a SIBLING of the catalog subtree, never inside app data. */
  private _stagingDir(tag: string): string {
    return path.join(path.dirname(this._catalogRoot), `.tmp-catalog-${tag}`);
  }

  /**
   * Run the full sync pipeline. The default behaviour is "preview-only" (the
   * staging dir is left intact for the user to review). Pass `apply: true` to
   * swap the catalog subtree and write the version manifest.
   */
  async sync(options: { tag?: string; apply?: boolean } = {}): Promise<SyncResult> {
    const tag = options.tag ?? (await this._deps.resolveLatestTag());
    if (!tag || !/^[A-Za-z0-9._\-+]+$/.test(tag)) {
      throw new Error(`invalid tag: ${tag}`);
    }

    const catalogRootDir = this._catalogRoot;
    assertScopedCatalogRoot(catalogRootDir);

    // The currently-installed catalog (if any): scan its skills tree to diff
    // against, and read its recorded version for the up-to-date short-circuit.
    const layout: HubLayout = resolveHubLayout(catalogRootDir);
    const installedSkillsDir = hubLayoutDir(catalogRootDir, "skills", layout);
    const installedMeta = readHubVersionManifest(catalogRootDir);
    const prevManifest = fs.existsSync(installedSkillsDir)
      ? buildManifest(installedSkillsDir, installedMeta?.version ?? "", this._upstream)
      : null;

    // Short-circuit: the recorded version already matches the requested tag.
    if (installedMeta?.version === tag && prevManifest) {
      return {
        tag,
        tmpDir: catalogRootDir,
        manifest: prevManifest,
        diff: { added: [], modified: [], removed: [] },
        scan: { decision: "pass", findings: [] },
        alreadyUpToDate: true,
        applied: false,
        activeDir: catalogRootDir,
        indexConsistency: null,
        manifestVerification: { present: false, checked: 0, mismatched: [] },
      };
    }

    const tmpDir = this._stagingDir(tag);
    // Clean any leftover staging dir from a prior aborted run.
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    if (await this._deps.hasGit()) {
      await this._deps.sparseClone(tag, tmpDir);
    } else {
      await this._deps.tarballFetch(tag, tmpDir);
    }

    // The Hub repo stores everything under `catalog/`; that directory becomes the
    // local catalog root verbatim (repo `catalog/skills` -> `<catalogRoot>/skills`).
    const stagedCatalogDir = path.join(tmpDir, "catalog");
    const stagedSkillsDir = path.join(stagedCatalogDir, "skills");

    const { manifest, indexConsistency } = buildManifestWithIndex(
      stagedCatalogDir,
      tag,
      this._upstream,
    );
    const scan = scanBundleDir(stagedSkillsDir, this._scanner);
    const diff = diffManifests(prevManifest, manifest);
    // Supply-chain evidence against the repo-root MANIFEST.sha256. ADVISORY: it
    // never blocks `--apply` (the injection scanner is the fail-closed gate).
    const manifestVerification = verifyReleaseManifest(tmpDir);
    // Record the catalog's declared version (plugin.json) when present, else the tag.
    const version = readPluginVersion(tmpDir) ?? tag;

    let applied = false;
    let appliedActiveDir: string | null = fs.existsSync(installedSkillsDir)
      ? catalogRootDir
      : null;
    if (options.apply && scan.decision !== "block") {
      // Destructive swap, scoped to the catalog subtree ONLY (never app data).
      assertScopedCatalogRoot(catalogRootDir);
      if (fs.existsSync(catalogRootDir)) {
        fs.rmSync(catalogRootDir, { recursive: true, force: true });
      }
      fs.mkdirSync(path.dirname(catalogRootDir), { recursive: true });
      fs.renameSync(stagedCatalogDir, catalogRootDir);
      // Drop the rest of the clone (repo-root files, .git, .claude-plugin).
      fs.rmSync(tmpDir, { recursive: true, force: true });
      writeHubVersionManifest(catalogRootDir, { version, sourceRepo: this._upstream });
      applied = true;
      appliedActiveDir = catalogRootDir;
    }

    return {
      tag,
      tmpDir: applied ? catalogRootDir : tmpDir,
      manifest,
      diff,
      scan,
      alreadyUpToDate: false,
      applied,
      activeDir: appliedActiveDir,
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
