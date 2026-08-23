import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Code2,
  Image as ImageIcon,
  Film,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { MODULES, type ModuleId } from "../types/modules";
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
  accentVar: string;
  shortcut: string;
}

const NAV_ENTRIES: readonly NavEntry[] = [
  {
    id: "chatbot",
    label: MODULES.chatbot.label,
    to: MODULES.chatbot.route,
    icon: MessageSquare,
    accentVar: MODULES.chatbot.accentVar,
    shortcut: "Ctrl+1",
  },
  {
    id: "coding",
    label: MODULES.coding.label,
    to: MODULES.coding.route,
    icon: Code2,
    accentVar: MODULES.coding.accentVar,
    shortcut: "Ctrl+2",
  },
  {
    id: "image",
    label: MODULES.image.label,
    to: MODULES.image.route,
    icon: ImageIcon,
    accentVar: MODULES.image.accentVar,
    shortcut: "Ctrl+3",
  },
  {
    id: "video",
    label: MODULES.video.label,
    to: MODULES.video.route,
    icon: Film,
    accentVar: MODULES.video.accentVar,
    shortcut: "Ctrl+4",
  },
];

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
        borderRight: "1px solid var(--border-subtle)",
        width: compact ? RAIL_WIDTH : FULL_WIDTH,
        transition: "width 120ms ease",
        display: "flex",
        flexDirection: "column",
        padding: compact ? "var(--space-3) var(--space-2)" : "var(--space-4)",
        gap: "var(--space-3)",
      }}
    >
      {/*
        v2.2.0 Phase 6 (6.1): the brand block is gone. The frameless title bar
        already shows "Nexus AI Studio" one row above; repeating it here cost a
        row of vertical space and read as a duplicate.
      */}
      <button
        type="button"
        data-testid="sidebar-collapse-toggle"
        aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!compact}
        onClick={toggleCompact}
        style={{
          alignSelf: compact ? "center" : "flex-end",
          background: "transparent",
          border: "none",
          color: "var(--fg-muted)",
          cursor: "pointer",
          padding: "var(--space-1)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {compact ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
      </button>

      <nav
        aria-label="Modules"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
      >
        {NAV_ENTRIES.map((entry) => (
          <NavLink
            key={entry.id}
            to={entry.to}
            data-testid={`nav-${entry.id}`}
            title={`${entry.label} (${entry.shortcut})`}
            aria-label={entry.label}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              justifyContent: compact ? "center" : "flex-start",
              gap: compact ? 0 : "var(--space-3)",
              padding: compact ? "var(--space-2)" : "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md)",
              color: isActive ? "var(--fg-0)" : "var(--fg-1)",
              backgroundColor: isActive ? `var(${entry.accentVar}-soft)` : "transparent",
              borderLeft: isActive
                ? `3px solid var(${entry.accentVar})`
                : "3px solid transparent",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
            })}
          >
            <entry.icon size={18} aria-hidden color={`var(${entry.accentVar})`} />
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
    </aside>
  );
}

export { NAV_ENTRIES };
