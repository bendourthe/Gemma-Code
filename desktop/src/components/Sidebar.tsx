import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Code2,
  Image as ImageIcon,
  Film,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { moduleList, type ModuleId } from "../types/modules";
import { writeActiveRoute } from "../lib/persistence";
import type { AskInboxClient } from "../pages/inbox/askInboxTypes";
import { useAskInboxPendingCount } from "../pages/inbox/useAskInboxPendingCount";
import { GpuStatusFooter } from "./GpuStatusFooter";
import { ApprovalsBell } from "./ApprovalsBell";
import type { TelemetryStream } from "./LocalModelStatus.types";

interface NavEntry {
  id: ModuleId;
  label: string;
  to: string;
  icon: typeof MessageSquare;
  shortcut: string;
}

const NAV_PRESENTATION: Record<ModuleId, Pick<NavEntry, "icon" | "shortcut">> = {
  chatbot: { icon: MessageSquare, shortcut: "Ctrl+1" },
  coding: { icon: Code2, shortcut: "Ctrl+2" },
  image: { icon: ImageIcon, shortcut: "Ctrl+3" },
  video: { icon: Film, shortcut: "Ctrl+4" },
};

const NAV_ENTRIES: readonly NavEntry[] = moduleList.map((module) => ({
  id: module.id,
  label: module.label,
  to: module.route,
  ...NAV_PRESENTATION[module.id],
}));

// v2.2.0 Phase 6 (6.3): "Ask inbox" left the nav for a bell in the footer --
// a surface with zero pending items most of the time does not deserve a
// permanent tab. Approvals are still one click away, and never auto-approved.
const ADMIN_ENTRIES = [
  { label: "Settings", to: "/settings", icon: SettingsIcon, shortcut: "Ctrl+," },
] as const;

/** Persisted collapse preference. */
const COMPACT_KEY = "nexus.sidebar.compact";
const FULL_WIDTH = 248;
const RAIL_WIDTH = 56;

function readCompactPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(COMPACT_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    // Private mode / blocked storage: fall back to the breakpoint.
    return null;
  }
}

export interface SidebarProps {
  askInboxClient?: AskInboxClient;
  /** v2.2.0 Phase 6 (6.2): GPU status now lives at the sidebar foot. */
  telemetryStream?: TelemetryStream | null;
  /** Test seam for the initial window width. */
  initialWidth?: number;
}

export function Sidebar({
  askInboxClient,
  telemetryStream,
  initialWidth: _initialWidth,
}: SidebarProps = {}): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const pendingCount = useAskInboxPendingCount(askInboxClient);

  // v2.2.1: compact icon rail is the default. An explicit expand (stored
  // false) still persists, including on a narrow window -- auto-compact must
  // not clobber that choice. With no stored preference the rail is compact
  // even on a wide window (v2.2.0 used `storedCompact ?? narrow`, so a 1440px
  // window started expanded).
  const [storedCompact, setStoredCompact] = useState<boolean | null>(() =>
    readCompactPreference(),
  );
  const compact = storedCompact ?? true;

  const toggleCompact = useCallback(() => {
    setStoredCompact((prev) => {
      const next = !(prev ?? true);
      try {
        localStorage.setItem(COMPACT_KEY, String(next));
      } catch {
        // Preference is a convenience; failing to persist must not break the toggle.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    writeActiveRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (e.key === ",") {
        e.preventDefault();
        navigate("/settings");
        return;
      }
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) {
        const entry = NAV_ENTRIES[idx];
        if (entry) {
          e.preventDefault();
          navigate(entry.to);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);


  return (
    <aside
      data-testid="sidebar"
      aria-label="Primary navigation"
      className="nexus-glass"
      style={{
        position: "relative",
        zIndex: 2,
        overflow: "visible",
        borderRight: "1px solid var(--border-subtle)",
        width: compact ? RAIL_WIDTH : FULL_WIDTH,
        transition: "width 120ms ease",
        display: "flex",
        flexDirection: "column",
        padding: compact ? "var(--space-2)" : "var(--space-3) var(--space-4)",
        gap: "var(--space-2)",
      }}
    >
      {/*
        v2.2.0 Phase 6 (6.1): the brand block is gone. The frameless title bar
        already shows "Nexus AI Studio" one row above; repeating it here cost a
        row of vertical space and read as a duplicate.
        v2.2.4 Phase 1 (1.3): collapse is an edge pill, not the first flex
        child, so Chatbot is the first row with no spacer gap above it.
      */}
      <nav
        aria-label="Modules"
        data-testid="sidebar-module-nav"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
      >
        {/*
          v2.2.3 Phase 2 (2.1): no per-tab accent on the rail. The selected
          state is the liquid-glass `.nexus-nav-link` treatment (frosted
          fill, hairline, inset highlight) keyed off aria-current; icons
          inherit currentColor. MODULES.*.accentVar stays for styleguide /
          module cards only.
        */}
        {NAV_ENTRIES.map((entry) => (
          <NavLink
            key={entry.id}
            to={entry.to}
            data-testid={`nav-${entry.id}`}
            title={`${entry.label} (${entry.shortcut})`}
            aria-label={entry.label}
            className="nexus-nav-link"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: compact ? "center" : "flex-start",
              gap: compact ? 0 : "var(--space-3)",
              padding: compact ? "var(--space-2)" : "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md)",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
            }}
          >
            <entry.icon size={18} aria-hidden />
            {!compact && <span>{entry.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <div className="nx-divider" role="separator" />

      <nav
        aria-label="Admin"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
      >
        {ADMIN_ENTRIES.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            data-testid={`nav-admin-${entry.to.replace("/", "")}`}
            title={entry.shortcut ? `${entry.label} (${entry.shortcut})` : entry.label}
            aria-label={entry.label}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              justifyContent: compact ? "center" : "flex-start",
              gap: compact ? 0 : "var(--space-3)",
              padding: compact ? "var(--space-2)" : "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md)",
              color: isActive ? "var(--fg-0)" : "var(--fg-muted)",
              backgroundColor: isActive ? "var(--bg-2)" : "transparent",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
            })}
          >
            <entry.icon size={18} aria-hidden />
            {!compact && <span>{entry.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/*
        v2.2.0 Phase 6 (6.2 / 6.3): approvals and GPU status live at the foot
        of the rail. The GPU card used to float over the bottom-right corner of
        every page, where it covered the Send and Generate buttons.
      */}
      <ApprovalsBell
        pendingCount={pendingCount}
        compact={compact}
        client={askInboxClient}
      />
      <GpuStatusFooter compact={compact} stream={telemetryStream ?? null} />
      <button
        type="button"
        className="nexus-sidebar-collapse-pill"
        data-testid="sidebar-collapse-toggle"
        aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!compact}
        title={compact ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggleCompact}
      >
        {compact ? (
          <ChevronRight size={12} aria-hidden />
        ) : (
          <ChevronLeft size={12} aria-hidden />
        )}
      </button>
    </aside>
  );
}

export { NAV_ENTRIES };
