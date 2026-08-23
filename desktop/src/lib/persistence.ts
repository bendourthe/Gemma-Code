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
 * v2.2.3 Phase 1 (1.2, U7): the routes a stored value may restore to. Local
 * Chatbot is the default module; Dashboard is intentionally absent so a
 * stored `/dashboard` (or `/`, or garbage) lands on `/chatbot` next launch.
 */
const RESTORABLE_ROUTES = ["/chatbot", "/coding", "/images", "/videos", "/settings"] as const;

/**
 * Map a stored route onto a real module route. Missing, `/`, `/dashboard`,
 * and any unknown path all normalize to `/chatbot`; the five module routes
 * (including their sub-paths, e.g. `/settings/...`) restore unchanged.
 */
export function normalizeActiveRoute(stored: string | null): string {
  if (stored) {
    for (const route of RESTORABLE_ROUTES) {
      if (stored === route || stored.startsWith(`${route}/`)) return stored;
    }
  }
  return "/chatbot";
}
