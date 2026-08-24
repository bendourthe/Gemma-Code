// Minimal localStorage wrapper that no-ops when storage is unavailable (SSR,
// Tauri sandbox edge cases, private-mode browsers).

const ACTIVE_ROUTE_KEY = "nexus.shell.activeRoute";
const CODING_WORKSPACE_PATH_KEY = "nexus.coding.workspacePath";

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

export const PERSISTENCE_KEYS = {
  activeRoute: ACTIVE_ROUTE_KEY,
  codingWorkspacePath: CODING_WORKSPACE_PATH_KEY,
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
