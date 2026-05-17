/**
 * v0.8.0 Phase 3.2 -- Persistent plan-version archive (item A8).
 *
 * Every revision of a plan recorded by `PlanMode.setPlan(steps)` is appended
 * under `~/.gemma-code/plans/<workspace>/<slug>/<N>.md`, where `N` is a
 * monotonically increasing 4-digit zero-padded index starting at `0001`.
 *
 * The archive is local-only: no remote sync, no network egress, no
 * background scheduler. Disk writes are synchronous and small (plans are a
 * few KB). The directory is created lazily on first write.
 *
 * Concurrent writes against the same `(workspace, slug)` are not expected --
 * a single chat session writes serially -- but we still guard against id
 * collisions by always taking `listVersions(slug).length + 1` for the next
 * write. Reads tolerate gaps (e.g., the user manually deletes `0002.md`).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createPatch, diffWordsWithSpace, diffLines } from "diff";

export interface PlanVersionEntry {
  /** Monotonic version number, starting at 1. */
  version: number;
  /** Absolute path to the version file on disk. */
  filePath: string;
  /** Plan content as read from disk. */
  content: string;
  /** File mtime as a UTC ISO-8601 string. */
  modifiedAt: string;
}

export type PlanDiffMode = "clean" | "classic" | "raw";

export interface PlanDiffResult {
  /** Word-level diff rendered as inline markdown (additions in `**bold**`, deletions struck through with `~~strike~~`). */
  clean: string;
  /** Line-level block diff with `+` / `-` / ` ` prefixes; suitable for a side-by-side renderer. */
  classic: string;
  /** Standard unified diff produced by `createPatch`. */
  raw: string;
}

/** Whitelisted character class for path-safe slug + workspace components. */
const SAFE_COMPONENT_RE = /^[A-Za-z0-9._-]+$/;

function normalizeWorkspace(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (trimmed.length === 0) return "default";
  // Replace path separators and any non-whitelisted character with `_` so a
  // workspace id derived from a filesystem path stays single-segment.
  return trimmed.replace(/[\\/]/g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
}

function ensureSafeSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!SAFE_COMPONENT_RE.test(trimmed)) {
    throw new Error(
      `PlanArchive: invalid plan slug ${JSON.stringify(slug)}; only A-Z, a-z, 0-9, dot, underscore, and dash allowed.`,
    );
  }
  return trimmed;
}

export interface PlanArchiveOptions {
  /** Override the archive root; defaults to `~/.gemma-code/plans/`. */
  rootDir?: string;
  /** Workspace identifier (folder name component). Defaults to `default`. */
  workspaceId?: string;
}

export class PlanArchive {
  private readonly _root: string;
  private readonly _workspace: string;

  constructor(options: PlanArchiveOptions = {}) {
    this._root =
      options.rootDir ?? path.join(os.homedir(), ".gemma-code", "plans");
    this._workspace = normalizeWorkspace(options.workspaceId ?? "default");
  }

  /** Absolute path to the `<root>/<workspace>/<slug>/` directory. */
  slugDir(slug: string): string {
    return path.join(this._root, this._workspace, ensureSafeSlug(slug));
  }

  /**
   * Append a new version for `slug`. Returns the new version number.
   * Creates the slug directory if missing.
   */
  appendVersion(slug: string, content: string): number {
    const dir = this.slugDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    const next = this.listVersions(slug).length + 1;
    const filePath = path.join(dir, this._versionFileName(next));
    fs.writeFileSync(filePath, content, "utf8");
    return next;
  }

  /** Return every persisted version for `slug`, oldest first. */
  listVersions(slug: string): PlanVersionEntry[] {
    const dir = this.slugDir(slug);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const entries: PlanVersionEntry[] = [];
    for (const name of names) {
      const match = /^(\d{4})\.md$/.exec(name);
      if (!match) continue;
      const version = Number.parseInt(match[1]!, 10);
      const filePath = path.join(dir, name);
      let stat: fs.Stats;
      let content: string;
      try {
        stat = fs.statSync(filePath);
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      entries.push({
        version,
        filePath,
        content,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
    entries.sort((a, b) => a.version - b.version);
    return entries;
  }

  /** Return the content of a specific version, or `null` when missing. */
  getVersion(slug: string, version: number): string | null {
    const filePath = path.join(
      this.slugDir(slug),
      this._versionFileName(version),
    );
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  /**
   * Compute the 3-mode diff between two persisted versions. Throws if either
   * version is missing from disk.
   */
  diff(slug: string, fromVersion: number, toVersion: number): PlanDiffResult {
    const a = this.getVersion(slug, fromVersion);
    const b = this.getVersion(slug, toVersion);
    if (a === null) {
      throw new Error(`PlanArchive: missing version ${fromVersion} for slug ${slug}.`);
    }
    if (b === null) {
      throw new Error(`PlanArchive: missing version ${toVersion} for slug ${slug}.`);
    }
    return PlanArchive.computeDiff(a, b, slug, fromVersion, toVersion);
  }

  /**
   * Pure helper: compute the 3-mode diff from raw strings. Exposed for tests
   * and callers that hold the strings in memory rather than on disk.
   */
  static computeDiff(
    fromContent: string,
    toContent: string,
    slug: string = "plan",
    fromVersion: number = 0,
    toVersion: number = 1,
  ): PlanDiffResult {
    // v0.9.0 Phase 6.4 (from v0.8.0 known-gaps 10.O.I) -- strip trailing
    // newlines from add/del runs before wrapping with `**` / `~~`, then
    // re-emit the newline AFTER the closing marker so the rendered
    // markdown still has the line break but the closing token does not
    // orphan onto the next line.
    const wordDiff = diffWordsWithSpace(fromContent, toContent);
    const cleanParts: string[] = [];
    for (const part of wordDiff) {
      if (part.added) {
        cleanParts.push(wrapDiffRun(part.value, "**"));
      } else if (part.removed) {
        cleanParts.push(wrapDiffRun(part.value, "~~"));
      } else {
        cleanParts.push(part.value);
      }
    }
    const clean = cleanParts.join("");

    const lineDiff = diffLines(fromContent, toContent);
    const classicLines: string[] = [];
    for (const part of lineDiff) {
      const prefix = part.added ? "+" : part.removed ? "-" : " ";
      const lines = part.value.split("\n");
      // `diffLines` keeps the trailing newline as a final empty entry; drop
      // it so we don't emit an empty marker line.
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      for (const line of lines) classicLines.push(`${prefix}${line}`);
    }
    const classic = classicLines.join("\n");

    const raw = createPatch(
      `${slug}.md`,
      fromContent,
      toContent,
      `v${fromVersion}`,
      `v${toVersion}`,
    );

    return { clean, classic, raw };
  }

  private _versionFileName(version: number): string {
    return `${String(version).padStart(4, "0")}.md`;
  }
}

/**
 * v0.9.0 Phase 6.4 -- clean diff trailing-newline helper.
 *
 * Strips trailing `\n` characters from the inner payload before wrapping
 * with `marker` (`**` or `~~`), then re-appends the trailing newlines after
 * the closing marker. The result keeps the markdown emphasis/strikethrough
 * scoped to the visible text on a single line while preserving the line
 * breaks the original diff carried. Exposed so the unit test can target
 * the helper directly without rebuilding a full diff fixture.
 */
export function wrapDiffRun(value: string, marker: string): string {
  if (value.length === 0) return value;
  let trailing = 0;
  while (trailing < value.length && value[value.length - 1 - trailing] === "\n") {
    trailing += 1;
  }
  if (trailing === 0) return `${marker}${value}${marker}`;
  const inner = value.slice(0, value.length - trailing);
  const newlines = value.slice(value.length - trailing);
  if (inner.length === 0) return value; // run is pure newlines; leave as-is
  return `${marker}${inner}${marker}${newlines}`;
}
