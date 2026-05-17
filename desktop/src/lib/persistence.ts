// Minimal localStorage wrapper that no-ops when storage is unavailable (SSR,
// Tauri sandbox edge cases, private-mode browsers).

const ACTIVE_ROUTE_KEY = "nexus.shell.activeRoute";

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

export const PERSISTENCE_KEYS = { activeRoute: ACTIVE_ROUTE_KEY };
