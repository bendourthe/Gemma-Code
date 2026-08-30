// Minimal localStorage wrapper that no-ops when storage is unavailable (SSR,
// Tauri sandbox edge cases, private-mode browsers).

const ACTIVE_ROUTE_KEY = "nexus.shell.activeRoute";
const CODING_WORKSPACE_PATH_KEY = "nexus.coding.workspacePath";
const CODING_WORKSPACE_KEY = "nexus.coding.workspace";

export interface CodingWorkspaceSelection {
  roots: readonly string[];
  primaryRoot: string;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    if (typeof window.localStorage === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readActiveRoute(): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    return storage.getItem(ACTIVE_ROUTE_KEY);
  } catch {
    return null;
  }
}

export function writeActiveRoute(route: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(ACTIVE_ROUTE_KEY, route);
  } catch {
    // ignore quota / disabled-storage errors
  }
}

export function readCodingWorkspacePath(): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    return storage.getItem(CODING_WORKSPACE_PATH_KEY);
  } catch {
    return null;
  }
}

export function writeCodingWorkspacePath(workspacePath: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(CODING_WORKSPACE_PATH_KEY, workspacePath);
  } catch {
    // ignore quota / disabled-storage errors
  }
}

function workspacePathKey(value: string): string {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")
    ? value.toLocaleLowerCase()
    : value;
}

export function normalizeCodingWorkspaceSelection(
  roots: readonly string[],
  primaryRoot?: string | null,
): CodingWorkspaceSelection | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of roots) {
    const root = raw.trim();
    if (!root) continue;
    const key = workspacePathKey(root);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(root);
  }
  if (unique.length === 0) return null;
  const requested = primaryRoot?.trim();
  const primary = requested
    ? unique.find((root) => workspacePathKey(root) === workspacePathKey(requested))
    : undefined;
  const resolvedPrimary = primary ?? unique[0]!;
  return {
    roots: [resolvedPrimary, ...unique.filter((root) => root !== resolvedPrimary)],
    primaryRoot: resolvedPrimary,
  };
}

export function readCodingWorkspaceSelection(): CodingWorkspaceSelection | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CODING_WORKSPACE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { roots?: unknown; primaryRoot?: unknown };
        if (Array.isArray(parsed.roots) && parsed.roots.every((root) => typeof root === "string")) {
          const normalized = normalizeCodingWorkspaceSelection(
            parsed.roots,
            typeof parsed.primaryRoot === "string" ? parsed.primaryRoot : null,
          );
          if (normalized) return normalized;
        }
      } catch {
        // Fall through to the legacy primary path.
      }
    }
    const legacy = storage.getItem(CODING_WORKSPACE_PATH_KEY);
    return legacy ? normalizeCodingWorkspaceSelection([legacy], legacy) : null;
  } catch {
    return null;
  }
}

export function writeCodingWorkspaceSelection(selection: CodingWorkspaceSelection): void {
  const storage = safeStorage();
  if (!storage) return;
  const normalized = normalizeCodingWorkspaceSelection(selection.roots, selection.primaryRoot);
  if (!normalized) return;
  try {
    storage.setItem(CODING_WORKSPACE_KEY, JSON.stringify(normalized));
    storage.setItem(CODING_WORKSPACE_PATH_KEY, normalized.primaryRoot);
  } catch {
    // ignore quota / disabled-storage errors
  }
}

export const PERSISTENCE_KEYS = {
  activeRoute: ACTIVE_ROUTE_KEY,
  codingWorkspacePath: CODING_WORKSPACE_PATH_KEY,
  codingWorkspace: CODING_WORKSPACE_KEY,
};

/**
 * v2.2.4 Phase 1 (1.1): cold start always opens Chatbot. Last-module restore
 * of /coding, /images, /videos, and /settings is reversed. A Chatbot thread
 * sub-path (/chatbot/...) still restores so in-module conversation state is
 * not thrown away.
 */
export function normalizeActiveRoute(stored: string | null): string {
  if (stored === "/chatbot" || (stored !== null && stored.startsWith("/chatbot/"))) {
    return stored;
  }
  return "/chatbot";
}
