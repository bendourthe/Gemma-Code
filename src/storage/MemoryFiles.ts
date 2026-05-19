import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { matchesSecretPath } from "../../modules/coding/utils/secretPaths.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import {
  redactInvisibleUnicode,
  scan as scanForInjection,
  summarize as summarizeFindings,
} from "../guardrails/PromptInjectionScanner.js";

/**
 * v0.7.0 Phase 2 -- file-backed memory architecture. Owns the four user-editable
 * Markdown files under `<baseDir>/<workspaceId>/`:
 *
 *   Instructions.md  -- who you are / what you do / rules / what good outputs look like
 *   Memory.md        -- preferences / corrections / patterns / decisions (accumulated)
 *   Context.md       -- about this project / audience / tools and stack / important background
 *   Archive/<YYYY-MM-DD>/ -- weekly snapshots when /memory archive runs
 *
 * The class is the prerequisite for Phase 5's manual memory page UI; this file
 * keeps the I/O concerns isolated so PromptBuilder, the slash-command surface,
 * and the future webview tab can share the same shape.
 *
 * Reads are mtime-cached -- PromptBuilder runs on every turn and stat'ing
 * three files per call would amplify into thousands of syscalls per session.
 *
 * Writes from `appendToMemory` and `import` go through the secret-path
 * denylist so a malicious skill cannot trick the architecture into reading
 * `.env`, an SSH private key, or a credential file.
 */

export type MemorySection = "Preferences" | "Corrections" | "Patterns" | "Decisions";

export interface MemoryFilesContents {
  readonly instructions: string;
  readonly memory: string;
  readonly context: string;
  readonly instructionsPath: string;
  readonly memoryPath: string;
  readonly contextPath: string;
}

export interface InitResult {
  readonly instructions: "created" | "skipped";
  readonly memory: "created" | "skipped";
  readonly context: "created" | "skipped";
  readonly instructionsPath: string;
  readonly memoryPath: string;
  readonly contextPath: string;
}

export interface ArchiveResult {
  readonly archivedPath: string;
  readonly archivedAt: Date;
}

export interface MemoryExportPayload {
  readonly version: 1;
  readonly exportedAt: string;
  readonly workspaceId: string;
  readonly files: {
    readonly instructions: string;
    readonly memory: string;
    readonly context: string;
  };
  readonly sqlMemories: readonly { readonly source: "sql"; readonly content: string; readonly type?: string }[];
}

export interface MemoryImportInput {
  readonly version?: number;
  readonly files?: {
    readonly instructions?: string;
    readonly memory?: string;
    readonly context?: string;
  };
}

/**
 * Compute the default base directory at call time (NOT at import time) so a
 * test-time `process.env.HOME` override is respected on the next constructor
 * call. Caching `path.join(os.homedir(), ...)` in a module constant would
 * freeze the value before tests get a chance to redirect.
 */
function defaultBaseDir(): string {
  return path.join(os.homedir(), ".nexus", "memory");
}

const INSTRUCTIONS_SCAFFOLD =
  "# Instructions\n\n" +
  "## Who you are\n\n" +
  "_(Describe yourself: role, expertise, communication style.)_\n\n" +
  "## What you do\n\n" +
  "_(Day-to-day responsibilities, primary projects, tools you live in.)_\n\n" +
  "## Rules\n\n" +
  "_(Hard preferences and anti-patterns -- the things that should never need to be said twice.)_\n\n" +
  "## What good outputs look like\n\n" +
  "_(Concrete examples of responses you find valuable: format, depth, tone.)_\n\n" +
  "---\n\n" +
  "Update Memory.md with my preferences over time.\n";

const MEMORY_SCAFFOLD =
  "# Memory\n\n" +
  "## Preferences\n\n" +
  "## Corrections\n\n" +
  "## Patterns\n\n" +
  "## Decisions\n";

const CONTEXT_SCAFFOLD =
  "# Context\n\n" +
  "## About this project\n\n" +
  "_(One paragraph -- purpose, audience, status.)_\n\n" +
  "## Audience\n\n" +
  "## Tools & stack\n\n" +
  "## Important background\n";

const ARCHIVE_DIRNAME = "Archive";

const SECTION_HEADERS: ReadonlyArray<MemorySection> = [
  "Preferences",
  "Corrections",
  "Patterns",
  "Decisions",
];

interface MtimeCacheEntry {
  readonly mtimeMs: number;
  readonly content: string;
}

/**
 * Derive a stable per-workspace identifier from a workspace's absolute path.
 * Format: `<basename>-<short-hash>` where the hash is the first 10 hex chars
 * of SHA-1(absoluteFsPath). The basename gives the directory a human-readable
 * prefix; the hash prevents collisions when two workspaces share a basename.
 *
 * This is exported as a static helper so callers (panel bootstrap, tests,
 * future webview) all derive the same ID without duplicating logic.
 */
export function deriveWorkspaceId(workspacePath: string): string {
  const absolute = path.resolve(workspacePath);
  const hash = crypto.createHash("sha1").update(absolute).digest("hex").slice(0, 10);
  const baseRaw = path.basename(absolute) || "workspace";
  // Keep the prefix filesystem-safe: only [A-Za-z0-9._-], collapse the rest.
  const safeBase = baseRaw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
  return `${safeBase}-${hash}`;
}

/**
 * v0.8.0 Phase 5 sub-task 5.5 (item G2) -- walk from `startDir` up to the
 * filesystem root (or the workspace root), collecting any `.gemma.md` file at
 * each level. The walk stops at:
 *
 *   - a directory containing `.git/` (treated as the project root)
 *   - the filesystem root (`path.parse(p).root`)
 *
 * Files matching the secret-path denylist (e.g. inside `~/.ssh/`) are skipped
 * defensively. The return order is deepest-first: callers downstream
 * (PromptBuilder) concatenate them so the closest file overrides outer ones.
 */
export function discoverGemmaContextFiles(startDir: string): string[] {
  const out: string[] = [];
  let current = path.resolve(startDir);
  const visited = new Set<string>();
  const fsRoot = path.parse(current).root;
  while (current && !visited.has(current)) {
    visited.add(current);
    const candidate = path.join(current, ".gemma.md");
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        if (!matchesSecretPath(candidate)) {
          out.push(candidate);
        }
      }
    } catch {
      // Non-fatal: directory may be unreadable.
    }
    // Stop at git root (inclusive of its .gemma.md) or filesystem root.
    if (fs.existsSync(path.join(current, ".git"))) break;
    if (current === fsRoot) break;
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return out;
}

/**
 * Read and concatenate every `.gemma.md` file from `discoverGemmaContextFiles`
 * with a section header per file. Returns the empty string when no file is
 * discovered. Used by PromptBuilder to inject the merged context after the
 * memory snapshot but before the skill index.
 */
export function readGemmaContextFiles(startDir: string): string {
  const files = discoverGemmaContextFiles(startDir);
  if (files.length === 0) return "";
  const blocks: string[] = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const rel = path.basename(filePath);
      blocks.push(`### ${rel} (\`${filePath}\`)\n\n${content.trim()}`);
    } catch {
      // Skip unreadable file but continue walking.
    }
  }
  return blocks.join("\n\n---\n\n");
}

export class MemoryFiles {
  public readonly baseDir: string;

  private readonly _workspaceDir: string;
  private readonly _instructionsPath: string;
  private readonly _memoryPath: string;
  private readonly _contextPath: string;
  private readonly _archiveDir: string;

  private readonly _cache: Map<string, MtimeCacheEntry> = new Map();

  constructor(
    public readonly workspaceId: string,
    baseDir?: string,
  ) {
    this.baseDir = baseDir ?? defaultBaseDir();
    this._workspaceDir = path.join(this.baseDir, workspaceId);
    this._instructionsPath = path.join(this._workspaceDir, "Instructions.md");
    this._memoryPath = path.join(this._workspaceDir, "Memory.md");
    this._contextPath = path.join(this._workspaceDir, "Context.md");
    this._archiveDir = path.join(this._workspaceDir, ARCHIVE_DIRNAME);
  }

  get workspaceDir(): string {
    return this._workspaceDir;
  }
  get instructionsPath(): string {
    return this._instructionsPath;
  }
  get memoryPath(): string {
    return this._memoryPath;
  }
  get contextPath(): string {
    return this._contextPath;
  }
  get archiveDir(): string {
    return this._archiveDir;
  }

  /**
   * Scaffold the three memory files. When `force` is false (default), an
   * existing file on disk is left untouched -- the user's edits are
   * authoritative. With `force` true, every file is rewritten to its scaffold,
   * which the caller should warn about because it discards user content.
   */
  init(force = false): InitResult {
    fs.mkdirSync(this._workspaceDir, { recursive: true });
    return {
      instructions: this._writeIfAbsent(this._instructionsPath, INSTRUCTIONS_SCAFFOLD, force),
      memory: this._writeIfAbsent(this._memoryPath, MEMORY_SCAFFOLD, force),
      context: this._writeIfAbsent(this._contextPath, CONTEXT_SCAFFOLD, force),
      instructionsPath: this._instructionsPath,
      memoryPath: this._memoryPath,
      contextPath: this._contextPath,
    };
  }

  /**
   * Read the three files, returning empty strings for any that do not exist
   * (no auto-init from read; callers run `init()` once at session start).
   * Cached by mtime so the hot prompt-build path stays cheap.
   */
  read(): MemoryFilesContents {
    return {
      instructions: this._readCached(this._instructionsPath),
      memory: this._readCached(this._memoryPath),
      context: this._readCached(this._contextPath),
      instructionsPath: this._instructionsPath,
      memoryPath: this._memoryPath,
      contextPath: this._contextPath,
    };
  }

  /** Drop the mtime cache so the next read is forced to disk. */
  invalidateCache(): void {
    this._cache.clear();
  }

  /**
   * Snapshot the three files into `Archive/<YYYY-MM-DD>/`. The day is taken
   * from the local clock; if a snapshot for today already exists it is
   * overwritten so multiple archive calls within a day collapse to the latest.
   */
  archive(): ArchiveResult {
    const now = new Date();
    const stamp = formatLocalDate(now);
    const target = path.join(this._archiveDir, stamp);
    fs.mkdirSync(target, { recursive: true });
    for (const [src, name] of [
      [this._instructionsPath, "Instructions.md"],
      [this._memoryPath, "Memory.md"],
      [this._contextPath, "Context.md"],
    ] as const) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(target, name));
      }
    }
    return { archivedPath: target, archivedAt: now };
  }

  /**
   * Find the most recent archive directory and return its date, or null when
   * no archive has run yet. Used by the auto-archive scheduler to decide
   * whether a new snapshot is due.
   */
  latestArchiveDate(): Date | null {
    if (!fs.existsSync(this._archiveDir)) return null;
    const entries = fs.readdirSync(this._archiveDir, { withFileTypes: true });
    let latest: Date | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const parsed = parseLocalDate(entry.name);
      if (parsed && (!latest || parsed > latest)) {
        latest = parsed;
      }
    }
    return latest;
  }

  /**
   * Append `line` under the requested section heading in Memory.md. If the
   * heading is missing the section is appended at end-of-file with the line
   * underneath. Bullet prefix is added when the line does not already start
   * with one.
   */
  appendToMemory(section: MemorySection, line: string): void {
    if (!SECTION_HEADERS.includes(section)) {
      throw new Error(`Unknown memory section: ${section}`);
    }
    if (containsSecretPathReference(line)) {
      throw new Error(
        `Refused to append: line references a secret-path pattern. Edit Memory.md by hand if intentional.`,
      );
    }
    fs.mkdirSync(this._workspaceDir, { recursive: true });
    const current = fs.existsSync(this._memoryPath)
      ? fs.readFileSync(this._memoryPath, "utf8")
      : MEMORY_SCAFFOLD;
    const formatted = line.trim().startsWith("-") ? line.trim() : `- ${line.trim()}`;
    const next = appendUnderHeading(current, section, formatted);
    fs.writeFileSync(this._memoryPath, next, "utf8");
    this._cache.delete(this._memoryPath);
  }

  /**
   * Remove every line in Memory.md matching `pattern`. Catastrophic patterns
   * (raw `.*` without anchors) are rejected so the user cannot accidentally
   * blow the file away. Returns the number of lines removed.
   */
  removeFromMemory(pattern: string | RegExp): { removedLines: number } {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    if (isCatastrophicPattern(re)) {
      throw new Error(
        `Refused to remove: pattern "${re.source}" is too greedy. Anchor the pattern (e.g. ^...$) to be explicit.`,
      );
    }
    if (!fs.existsSync(this._memoryPath)) {
      return { removedLines: 0 };
    }
    const before = fs.readFileSync(this._memoryPath, "utf8");
    const lines = before.split(/\r?\n/);
    const kept: string[] = [];
    let removed = 0;
    for (const line of lines) {
      if (re.test(line)) {
        removed++;
      } else {
        kept.push(line);
      }
    }
    if (removed === 0) return { removedLines: 0 };
    fs.writeFileSync(this._memoryPath, kept.join("\n"), "utf8");
    this._cache.delete(this._memoryPath);
    return { removedLines: removed };
  }

  /**
   * Write a JSON dump of all three files plus any SQL-backed memories the
   * caller supplies. Used by `/memory export` (lands in Phase 5) and by the
   * import round-trip tests in this phase.
   */
  export(
    targetPath: string,
    options: { sqlMemories?: readonly { content: string; type?: string }[] } = {},
  ): void {
    if (matchesSecretPath(targetPath)) {
      throw new Error(`Refused to export to a secret path: ${targetPath}`);
    }
    const contents = this.read();
    const payload: MemoryExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workspaceId: this.workspaceId,
      files: {
        instructions: contents.instructions,
        memory: contents.memory,
        context: contents.context,
      },
      sqlMemories: (options.sqlMemories ?? []).map((m) => ({
        source: "sql" as const,
        content: m.content,
        ...(m.type ? { type: m.type } : {}),
      })),
    };
    fs.mkdirSync(path.dirname(path.resolve(targetPath)), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
  }

  /**
   * Read a previously-exported JSON dump from `srcPath` and merge or replace
   * the three files. `mode = "merge"` appends each file's payload to the
   * existing on-disk content; `mode = "replace"` overwrites. Source paths
   * inside the secret-path denylist are rejected so a malicious caller
   * cannot use `import` to read `.env` or `.ssh/id_rsa`.
   */
  import(srcPath: string, mode: "merge" | "replace"): void {
    if (matchesSecretPath(srcPath)) {
      throw new Error(`Refused to import from a secret path: ${srcPath}`);
    }
    const raw = fs.readFileSync(srcPath, "utf8");
    let parsed: MemoryImportInput;
    try {
      parsed = JSON.parse(raw) as MemoryImportInput;
    } catch (err) {
      throw new Error(`Invalid memory export at ${srcPath}: ${(err as Error).message}`);
    }
    const files = parsed.files ?? {};
    fs.mkdirSync(this._workspaceDir, { recursive: true });
    this._mergeOrReplace(this._instructionsPath, files.instructions ?? "", mode, INSTRUCTIONS_SCAFFOLD);
    this._mergeOrReplace(this._memoryPath, files.memory ?? "", mode, MEMORY_SCAFFOLD);
    this._mergeOrReplace(this._contextPath, files.context ?? "", mode, CONTEXT_SCAFFOLD);
    this.invalidateCache();
  }

  private _writeIfAbsent(target: string, content: string, force: boolean): "created" | "skipped" {
    if (!force && fs.existsSync(target)) return "skipped";
    fs.writeFileSync(target, content, "utf8");
    this._cache.delete(target);
    return "created";
  }

  private _readCached(target: string): string {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(target);
    } catch {
      return "";
    }
    const cached = this._cache.get(target);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.content;
    }
    const raw = fs.readFileSync(target, "utf8");
    // v0.8.0 Phase 2 (item G1): fail-open scanner on the read boundary.
    // Legacy content may already contain invisible-unicode steganography
    // from an earlier model run, and a hard throw here would lock the
    // user out of their own Memory.md. Instead we log the findings and
    // strip the invisibles before caching. Findings other than
    // invisible-unicode are reported but the content still flows through
    // so the user can edit it out by hand.
    const content = sanitizeForRead(raw, target);
    this._cache.set(target, { mtimeMs: stat.mtimeMs, content });
    return content;
  }

  private _mergeOrReplace(
    target: string,
    incoming: string,
    mode: "merge" | "replace",
    scaffold: string,
  ): void {
    if (mode === "replace") {
      fs.writeFileSync(target, incoming || scaffold, "utf8");
      return;
    }
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : scaffold;
    if (!incoming) {
      fs.writeFileSync(target, existing, "utf8");
      return;
    }
    const trimmedExisting = existing.replace(/\s+$/, "");
    const trimmedIncoming = incoming.replace(/^\s+/, "");
    fs.writeFileSync(target, `${trimmedExisting}\n\n${trimmedIncoming}\n`, "utf8");
  }
}

function appendUnderHeading(content: string, section: MemorySection, line: string): string {
  const heading = `## ${section}`;
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) {
    const trimmed = content.replace(/\s+$/, "");
    return `${trimmed}\n\n${heading}\n\n${line}\n`;
  }

  // Find the end of this section (next H2 or EOF).
  let endOfSection = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      endOfSection = i;
      break;
    }
  }

  // Trim trailing blank lines from the section body so the appended bullet
  // sits flush against existing content rather than separated by a hole.
  let bodyEnd = endOfSection;
  while (bodyEnd > idx + 1 && lines[bodyEnd - 1]!.trim() === "") {
    bodyEnd--;
  }

  const head = lines.slice(0, idx + 1);
  const body = lines.slice(idx + 1, bodyEnd);
  const rest = lines.slice(endOfSection);

  // Standard shape: heading -> blank -> body -> bullet -> blank -> next section.
  const sectionBlock: string[] = [""];
  // Drop leading blank from body so we do not double up on whitespace.
  const trimmedBody = [...body];
  while (trimmedBody.length > 0 && trimmedBody[0]!.trim() === "") {
    trimmedBody.shift();
  }
  if (trimmedBody.length > 0) {
    sectionBlock.push(...trimmedBody);
  }
  sectionBlock.push(line);

  const next: string[] = [];
  if (rest.length > 0) {
    next.push("", ...rest);
  } else {
    next.push("");
  }

  return [...head, ...sectionBlock, ...next].join("\n");
}

function isCatastrophicPattern(re: RegExp): boolean {
  // Reject patterns that are unanchored AND match anything ("." or ".*" or
  // ".+" without a literal context). These would silently delete the entire
  // file. Anchored variants (^.*$ over a single line) are still risky but
  // explicit, so we let them through with a debug log.
  const src = re.source;
  if (/^\.\*?\+?$/.test(src)) return true;
  if (src === ".") return true;
  if (src === "" || src === "^$") {
    getLogger().debug(`[MemoryFiles] removeFromMemory called with empty pattern; treating as no-op.`);
  }
  return false;
}

/**
 * v0.8.0 Phase 2 (item G1) -- fail-open read-path scanner. Invisible
 * unicode is stripped; other findings are logged but the content is
 * passed through so the user is never locked out of their own memory
 * files. The write boundary in `MemoryStore.save` is the hard rejection
 * point.
 */
function sanitizeForRead(raw: string, target: string): string {
  if (!raw) return raw;
  const scanResult = scanForInjection(raw);
  if (!scanResult.ok) {
    getLogger().warn(
      `[MemoryFiles] prompt-injection patterns detected in ${target} on read (fail-open): ${summarizeFindings(scanResult.findings)}`,
    );
  }
  return redactInvisibleUnicode(raw);
}

function containsSecretPathReference(line: string): boolean {
  // Cheap pre-check -- the secret-path matcher operates on path-like inputs.
  // We split the line on whitespace and run each token through matchesSecretPath
  // to detect "added a credential at /home/me/.aws/credentials" style mistakes.
  const tokens = line.split(/[\s,;:]+/).filter(Boolean);
  for (const tok of tokens) {
    if (matchesSecretPath(tok)) return true;
  }
  return false;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(stamp: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
