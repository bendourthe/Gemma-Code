/**
 * v2.2.8 Phase 2 -- collapsible FolderTree host used by Chatbot, Agents,
 * Image Studio, and Video Lab.
 */

import { useCallback, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  HISTORY_PANE_COLLAPSED_WIDTH,
  HISTORY_PANE_WIDTH,
} from "./historyPaneLayout";

export function readCollapsedPreference(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

export function usePersistentCollapsed(storageKey: string): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(storageKey));
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        /* preference is optional */
      }
      return next;
    });
  }, [storageKey]);
  return { collapsed, toggle };
}

export interface CollapsibleHistoryAsideProps {
  readonly testId: string;
  readonly ariaLabel: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly toggleTestId: string;
  readonly expandLabel: string;
  readonly collapseLabel: string;
  readonly children: ReactNode;
}

export function CollapsibleHistoryAside({
  testId,
  ariaLabel,
  collapsed,
  onToggle,
  toggleTestId,
  expandLabel,
  collapseLabel,
  children,
}: CollapsibleHistoryAsideProps): JSX.Element {
  const width = collapsed ? HISTORY_PANE_COLLAPSED_WIDTH : HISTORY_PANE_WIDTH;
  return (
    <aside
      data-testid={testId}
      data-history-collapsed={collapsed ? "true" : "false"}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        zIndex: 1,
        width,
        flex: `0 0 ${width}px`,
        minHeight: 0,
        overflow: "visible",
        borderRight: "1px solid var(--border-1)",
        backgroundColor: "var(--bg-1)",
      }}
    >
      <div
        style={{
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {children}
      </div>
      <button
        type="button"
        className="nexus-sidebar-collapse-pill nexus-chats-collapse-pill"
        data-testid={toggleTestId}
        aria-label={collapsed ? expandLabel : collapseLabel}
        aria-expanded={!collapsed}
        title={collapsed ? expandLabel : collapseLabel}
        style={{ width: 24, minWidth: 24, minHeight: 24, height: 40 }}
        onClick={onToggle}
      >
        {collapsed ? (
          <ChevronRight size={12} aria-hidden />
        ) : (
          <ChevronLeft size={12} aria-hidden />
        )}
      </button>
    </aside>
  );
}
