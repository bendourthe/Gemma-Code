import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface WorkspaceScope {
  readonly workspaceId: string;
  /** User-controlled chip order. The first entry is not implicitly primary. */
  readonly workspaceRoots: readonly string[];
  /** Stable sorted roots used only for identity and equality. */
  readonly identityRoots: readonly string[];
  readonly primaryRoot: string;
  readonly displayLabel: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

export interface WorkspaceScopeInput {
  readonly workspaceRoots?: readonly string[];
  /** One-cycle compatibility input. Ignored when workspaceRoots is non-empty. */
  readonly workspacePath?: string;
  readonly primaryRoot?: string;
  readonly workspaceId?: string;
}

export interface WorkspaceScopeOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: () => string;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly realpath?: (root: string) => Promise<string>;
  readonly stat?: (root: string) => Promise<{ isDirectory(): boolean }>;
  readonly previous?: WorkspaceScope;
}

export const WORKSPACE_CANONICALIZE_TIMEOUT_MS = 2_000;

export class WorkspaceScopeError extends Error {
  constructor(message: string, readonly root?: string) {
    super(root ? `${message}: ${root}` : message);
    this.name = "WorkspaceScopeError";
  }
}

function hasParentTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}

function withoutTrailingSeparator(value: string): string {
  const parsed = path.parse(value);
  let next = path.normalize(value);
  while (next.length > parsed.root.length && next.endsWith(path.sep)) {
    next = next.slice(0, -1);
  }
  return next;
}

export function workspacePathKey(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = withoutTrailingSeparator(path.resolve(value)).normalize("NFKC");
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function workspaceIdForRoots(
  roots: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const identity = [...new Set(roots.map((root) => workspacePathKey(root, platform)))].sort();
  return `ws-${createHash("sha256").update(identity.join("\0"), "utf8").digest("hex").slice(0, 24)}`;
}

function labelFor(primaryRoot: string, rootCount: number): string {
  const primaryName = path.basename(primaryRoot) || primaryRoot;
  return rootCount > 1 ? `${primaryName} +${rootCount - 1}` : primaryName;
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, root: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new WorkspaceScopeError("Workspace directory validation timed out", root)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function createWorkspaceScope(
  input: WorkspaceScopeInput = {},
  options: WorkspaceScopeOptions = {},
): Promise<WorkspaceScope> {
  const platform = options.platform ?? process.platform;
  const rawRoots = input.workspaceRoots?.length
    ? [...input.workspaceRoots]
    : input.workspacePath?.trim()
      ? [input.workspacePath]
      : [(options.homeDir ?? os.homedir)()];
  if (rawRoots.length === 0) throw new WorkspaceScopeError("At least one workspace root is required");

  const realpath = options.realpath ?? fs.realpath;
  const stat = options.stat ?? fs.stat;
  const timeoutMs = options.timeoutMs ?? WORKSPACE_CANONICALIZE_TIMEOUT_MS;
  const ordered: string[] = [];
  const byKey = new Map<string, string>();
  for (const raw of rawRoots) {
    const root = typeof raw === "string" ? raw.trim() : "";
    if (!root) throw new WorkspaceScopeError("Workspace root must be a non-empty path");
    if (!path.isAbsolute(root)) throw new WorkspaceScopeError("Workspace root must be absolute", root);
    if (hasParentTraversal(root)) throw new WorkspaceScopeError("Workspace root must not contain parent traversal", root);
    let canonical: string;
    try {
      const info = await bounded(stat(root), timeoutMs, root);
      if (!info.isDirectory()) throw new WorkspaceScopeError("Workspace root is not a directory", root);
      canonical = withoutTrailingSeparator(await bounded(realpath(root), timeoutMs, root));
    } catch (error) {
      if (error instanceof WorkspaceScopeError) throw error;
      throw new WorkspaceScopeError(
        `Workspace root is unavailable (${error instanceof Error ? error.message : String(error)})`,
        root,
      );
    }
    const key = workspacePathKey(canonical, platform);
    if (byKey.has(key)) continue;
    byKey.set(key, canonical);
    ordered.push(canonical);
  }
  if (ordered.length === 0) throw new WorkspaceScopeError("At least one workspace root is required");

  let primaryRoot = ordered[0]!;
  if (input.primaryRoot?.trim()) {
    if (!path.isAbsolute(input.primaryRoot) || hasParentTraversal(input.primaryRoot)) {
      throw new WorkspaceScopeError("Primary root must be an absolute selected directory", input.primaryRoot);
    }
    const primaryKey = workspacePathKey(input.primaryRoot, platform);
    const selected = byKey.get(primaryKey);
    if (!selected) throw new WorkspaceScopeError("Primary root must be one of the selected roots", input.primaryRoot);
    primaryRoot = selected;
  }

  const identityRoots = [...byKey.keys()].sort();
  const workspaceId = workspaceIdForRoots(ordered, platform);
  if (input.workspaceId && input.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Workspace id does not match the selected roots");
  }
  const now = (options.now ?? (() => new Date()))().toISOString();
  const previous = options.previous?.workspaceId === workspaceId ? options.previous : undefined;
  return Object.freeze({
    workspaceId,
    workspaceRoots: Object.freeze([...ordered]),
    identityRoots: Object.freeze(identityRoots),
    primaryRoot,
    displayLabel: labelFor(primaryRoot, ordered.length),
    createdAt: previous?.createdAt ?? now,
    lastUsedAt: now,
  });
}

/** Build a tolerant snapshot from already-persisted roots without filesystem access. */
export function workspaceScopeFromPersisted(
  input: WorkspaceScopeInput & { readonly createdAt?: string; readonly lastUsedAt?: string },
  options: Pick<WorkspaceScopeOptions, "platform" | "homeDir" | "now"> = {},
): WorkspaceScope {
  const platform = options.platform ?? process.platform;
  const roots = input.workspaceRoots?.length
    ? input.workspaceRoots
    : input.workspacePath?.trim()
      ? [input.workspacePath]
      : [(options.homeDir ?? os.homedir)()];
  const ordered: string[] = [];
  const keys = new Set<string>();
  for (const root of roots) {
    if (!path.isAbsolute(root) || hasParentTraversal(root)) continue;
    const normalized = withoutTrailingSeparator(path.resolve(root));
    const key = workspacePathKey(normalized, platform);
    if (keys.has(key)) continue;
    keys.add(key);
    ordered.push(normalized);
  }
  if (ordered.length === 0) throw new WorkspaceScopeError("Persisted workspace has no valid roots");
  const primaryKey = input.primaryRoot ? workspacePathKey(input.primaryRoot, platform) : "";
  const primaryRoot = ordered.find((root) => workspacePathKey(root, platform) === primaryKey) ?? ordered[0]!;
  const workspaceId = workspaceIdForRoots(ordered, platform);
  const now = (options.now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    workspaceId,
    workspaceRoots: Object.freeze([...ordered]),
    identityRoots: Object.freeze([...keys].sort()),
    primaryRoot,
    displayLabel: labelFor(primaryRoot, ordered.length),
    createdAt: input.createdAt ?? now,
    lastUsedAt: input.lastUsedAt ?? now,
  });
}
