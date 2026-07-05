import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Code2,
  Film,
  HelpCircle,
  Image as ImageIcon,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { ModuleCard } from "../components/ModuleCard";
import { LocalModelStatus } from "../components/LocalModelStatus";
import { FloatingLogo } from "../components/FloatingLogo";
import { TopBar } from "../components/TopBar";
import type { TelemetryStream } from "../components/LocalModelStatus.types";
import { readProfileSync } from "../lib/profile";
import { ipc } from "../lib/ipc";
import type { ChatExplorerClient } from "../modules/chat/chatExplorerClient";
import type { MemorySearchAdapter } from "../components/TopBar";

interface DashboardProps {
  telemetryStream: TelemetryStream | null;
  recentProjects?: ReadonlyArray<{ name: string; model: string; updated: string }>;
  /** Phase 4.5: search backends. Tests can inject mocks. */
  chatClient?: ChatExplorerClient;
  memoryAdapter?: MemorySearchAdapter;
}

const FALLBACK_PROJECTS = [
  { name: "Phase 1 shell", model: "Gemma 4 7B", updated: "2 minutes ago" },
  { name: "Image experiments", model: "SDXL Turbo", updated: "yesterday" },
];

export function Dashboard({
  telemetryStream,
  recentProjects = FALLBACK_PROJECTS,
  chatClient,
  memoryAdapter,
}: DashboardProps): JSX.Element {
  const navigate = useNavigate();
  const profile = useMemo(() => readProfileSync(), []);
  const [pingResult, setPingResult] = useState<string | null>(null);

  useEffect(() => {
    setPingResult(null);
  }, []);

  async function onPing(): Promise<void> {
    const reply = await ipc.call("ping", {});
    if (reply.ok) {
      setPingResult(`pong: ${JSON.stringify(reply.value)}`);
    } else {
      setPingResult(`ipc-error: ${reply.message}`);
    }
  }

  return (
    <section
      data-testid="dashboard"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
        padding: "var(--space-6)",
        overflowY: "auto",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-4)",
        }}
      >
        <div
          data-testid="dashboard-hero"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}
        >
          <FloatingLogo src="/nexus-mark.png" size={52} glow="md" data-testid="dashboard-hero-logo" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <h1
              className="nexus-gradient-text"
              style={{
                margin: 0,
                fontSize: "var(--text-2xl)",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              Nexus AI Studio
            </h1>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
              Your Local AI Workspace
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <TopBar
            chatClient={chatClient}
            memoryAdapter={memoryAdapter}
            onChatClick={() => navigate("/chatbot")}
            onFolderClick={() => navigate("/chatbot")}
            onMemoryClick={() => navigate("/chatbot")}
            extraButtons={
              <button
                type="button"
                aria-label="Notifications"
                data-testid="dashboard-bell"
                style={{
                  position: "relative",
                  background: "transparent",
                  border: "none",
                  color: "var(--fg-1)",
                }}
              >
                <Bell size={18} aria-hidden />
                <span
                  aria-hidden
                  data-testid="dashboard-bell-badge"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: "var(--status-err)",
                  }}
                />
              </button>
            }
            onSettingsClick={() => navigate("/settings")}
            settingsTestId="dashboard-gear"
          />
        </div>
      </header>

      <p
        data-testid="dashboard-greeting"
        style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--fg-1)" }}
      >
        Welcome, {profile.firstName}!
      </p>

      <div
        data-testid="dashboard-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        <ModuleCard
          moduleId="coding"
          subtitle="Multi-LLM coding partner"
          body="Plan, edit, test, and ship code with a local agentic loop powered by Gemma 4 / Llama 3 / Qwen 2.5."
          cta="Open Code Assistant"
          to="/coding"
          icon={<Code2 size={18} aria-hidden />}
        />
        <ModuleCard
          moduleId="chatbot"
          subtitle="Folder-organized chats"
          body="Browse and resume local chats with nested folders, per-folder context isolation, and memory carryover."
          cta="Start New Chat"
          to="/chatbot"
          icon={<MessageSquare size={18} aria-hidden />}
        />
        <ModuleCard
          moduleId="image"
          subtitle="Local diffusion studio"
          body="txt2img, img2img, inpaint, outpaint, LoRA + ControlNet - all on your GPU, no cloud round-trip."
          cta="Create Image"
          to="/images"
          icon={<ImageIcon size={18} aria-hidden />}
        />
        <ModuleCard
          moduleId="video"
          subtitle="Local video synthesis"
          body="LTX-Video text-to-video, SVD image+text-to-video, CogVideoX opt-in. Timeline preview included."
          cta="Generate Video"
          to="/videos"
          icon={<Film size={18} aria-hidden />}
        />
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr minmax(280px, 360px)",
          gap: "var(--space-4)",
          alignItems: "stretch",
        }}
      >
        <div
          data-testid="dashboard-recent"
          className="nx-card"
          style={{ padding: "var(--space-4)" }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--fg-0)" }}>
            Recent Projects
          </h2>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "var(--space-3) 0 0 0",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            {recentProjects.map((p) => (
              <li
                key={p.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: "var(--space-3)",
                  fontSize: "var(--text-sm)",
                  color: "var(--fg-1)",
                  padding: "var(--space-2) 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span>{p.name}</span>
                <span style={{ color: "var(--fg-muted)" }}>{p.model}</span>
                <span style={{ color: "var(--fg-muted)" }}>{p.updated}</span>
              </li>
            ))}
          </ul>
        </div>
        <LocalModelStatus stream={telemetryStream} />
      </section>

      <div
        data-testid="dashboard-dev"
        style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}
      >
        <button
          type="button"
          onClick={onPing}
          data-testid="dashboard-ping"
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border-subtle)",
            color: "var(--fg-1)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-2) var(--space-3)",
            fontSize: "var(--text-sm)",
          }}
        >
          Ping sidecar (dev)
        </button>
        {pingResult && (
          <code
            data-testid="dashboard-ping-result"
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--fg-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {pingResult}
          </code>
        )}
      </div>

      <div
        aria-hidden
        style={{
          position: "fixed",
          right: "var(--space-5)",
          bottom: "var(--space-5)",
          display: "flex",
          gap: "var(--space-2)",
        }}
      >
        <button
          type="button"
          aria-label="AI assist"
          data-testid="dashboard-fab-sparkle"
          style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius-xl)",
            border: "none",
            background: "var(--accent-coding)",
            color: "var(--bg-0)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <Sparkles size={20} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Help"
          data-testid="dashboard-fab-help"
          style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius-xl)",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-1)",
            color: "var(--fg-1)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <HelpCircle size={20} aria-hidden />
        </button>
      </div>
    </section>
  );
}
