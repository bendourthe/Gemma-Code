import { useEffect, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Code2,
  Image as ImageIcon,
  Film,
  Settings as SettingsIcon,
  UserCircle2,
  Inbox,
} from "lucide-react";
import { moduleList, MODULES, type ModuleId } from "../types/modules";
import { writeActiveRoute } from "../lib/persistence";
import type { AskInboxClient } from "../pages/inbox/askInboxTypes";
import { useAskInboxPendingCount } from "../pages/inbox/useAskInboxPendingCount";

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

const ADMIN_ENTRIES = [
  { label: "Ask inbox", to: "/inbox", icon: Inbox, shortcut: null },
  { label: "Settings", to: "/settings", icon: SettingsIcon, shortcut: "Ctrl+," },
  { label: "User Profile", to: "/profile", icon: UserCircle2, shortcut: null },
] as const;

function activeAccent(activePath: string): string | undefined {
  const match = moduleList.find((m) => activePath.startsWith(m.route));
  return match?.accentVar;
}

export function Sidebar({ askInboxClient }: { askInboxClient?: AskInboxClient } = {}): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const pendingCount = useAskInboxPendingCount(askInboxClient);

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

  const activeBorder = useMemo(() => activeAccent(location.pathname), [location.pathname]);

  return (
    <aside
      data-testid="sidebar"
      aria-label="Primary navigation"
      className="nexus-glass"
      style={{
        borderRight: "1px solid var(--border-subtle)",
        width: 248,
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-4)",
        gap: "var(--space-4)",
      }}
    >
      <div
        data-testid="sidebar-brand"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-1)",
        }}
      >
        <img
          src="/nexus-mark.png"
          alt=""
          aria-hidden
          width={28}
          height={28}
          style={{
            borderRadius: 6,
            filter: "drop-shadow(var(--glow-sm))",
            outline: activeBorder ? `1px solid var(${activeBorder})` : "none",
          }}
        />
        <span
          style={{
            fontSize: "var(--text-md)",
            fontWeight: 700,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            color: "var(--fg-0)",
          }}
        >
          Nexus <span className="nexus-gradient-text">AI Studio</span>
        </span>
      </div>

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
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-2) var(--space-3)",
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
            <span>{entry.label}</span>
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
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md)",
              color: isActive ? "var(--fg-0)" : "var(--fg-muted)",
              backgroundColor: isActive ? "var(--bg-2)" : "transparent",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
            })}
          >
            <entry.icon size={18} aria-hidden />
            <span>{entry.label}</span>
            {entry.to === "/inbox" && pendingCount > 0 ? (
              <span
                data-testid="ask-inbox-nav-badge"
                style={{
                  marginLeft: "auto",
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: "var(--status-err)",
                  color: "var(--fg-0)",
                  fontSize: 11,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                }}
              >
                {pendingCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export { NAV_ENTRIES };
