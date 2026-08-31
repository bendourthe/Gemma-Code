/**
 * v2.4.2 Phase 1 -- pillar history lives in the left sidebar, not a second
 * rail or a horizontal Agents band. This supersedes v2.4.1 architecture
 * decision 8 (history as a second column / Agents History strip).
 *
 * Pages portal their existing FolderTree (or studio tree) into the host
 * under the four module tabs. Settings and Approvals register nothing, so
 * the slot is omitted. Compact icon-rail mode hides session titles via the
 * tree's `collapsed` flag; it does not open a second column.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const SIDEBAR_COMPACT_STORAGE_KEY = "nexus.sidebar.compact";

const HISTORY_ROUTES = new Set(["/chatbot", "/coding", "/images", "/videos"]);

export function isSidebarHistoryRoute(pathname: string): boolean {
  return HISTORY_ROUTES.has(pathname);
}

export function readSidebarCompactPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_COMPACT_STORAGE_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

export interface SidebarHistoryContextValue {
  hostEl: HTMLElement | null;
  setHostEl: (el: HTMLElement | null) => void;
  compact: boolean;
  toggleCompact: () => void;
}

const SidebarHistoryContext = createContext<SidebarHistoryContextValue | null>(null);

export function SidebarHistoryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hostEl, setHostEl] = useState<HTMLElement | null>(null);
  const [storedCompact, setStoredCompact] = useState<boolean | null>(() =>
    readSidebarCompactPreference(),
  );
  // Module routes default expanded so session titles fit (about 280px).
  const compact = storedCompact ?? false;
  const toggleCompact = useCallback(() => {
    setStoredCompact((prev) => {
      const next = !(prev ?? false);
      try {
        localStorage.setItem(SIDEBAR_COMPACT_STORAGE_KEY, String(next));
      } catch {
        // Preference is a convenience; failing to persist must not break the toggle.
      }
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({ hostEl, setHostEl, compact, toggleCompact }),
    [hostEl, compact, toggleCompact],
  );
  return (
    <SidebarHistoryContext.Provider value={value}>{children}</SidebarHistoryContext.Provider>
  );
}

export function useSidebarHistory(): SidebarHistoryContextValue | null {
  return useContext(SidebarHistoryContext);
}

export function useSidebarCompact(): boolean {
  return useContext(SidebarHistoryContext)?.compact ?? false;
}

/**
 * Relocates children into the sidebar history slot. Pages rendered without
 * the App provider (unit tests) keep the tree in place so FolderTree
 * interactions still work.
 */
export function SidebarHistorySlot({ children }: { children: ReactNode }): JSX.Element | null {
  const ctx = useContext(SidebarHistoryContext);
  if (!ctx) return <>{children}</>;
  if (!ctx.hostEl) return null;
  return createPortal(children, ctx.hostEl);
}
