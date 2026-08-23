import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ModuleErrorBoundary } from "./components/ModuleErrorBoundary";
import { TitleBar } from "./components/TitleBar";
import { ConstellationBackground } from "./components/ConstellationBackground";
import { ReadyOverlay } from "./components/ReadyOverlay";
import { useReadyGate } from "./lib/readyGate";
import { Dashboard } from "./pages/Dashboard";
import { StyleguidePage } from "./pages/Styleguide";
import { CodingPage } from "./modules/coding/CodingPage";
import { ChatPage } from "./modules/chat/ChatPage";
import { ImageStudioPage } from "./modules/image/ImageStudioPage";
import { VideoLabPage } from "./modules/video/VideoLabPage";
import { classifyDiffusionTier } from "../../core/config/DiffusionTier";
import { InMemoryMemoryHub } from "../../core/memory/MemoryHub";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { createIpcSkillsClient } from "./pages/settings/ipcSkillsClient";
import { createIpcSkillOptimizerClient } from "./pages/settings/ipcSkillOptimizerClient";
import { createIpcModelsClient } from "./pages/settings/ipcModelsClient";
import { createIpcServingClient } from "./pages/settings/ipcServingClient";
import { createIpcFineTuningClient } from "./pages/settings/ipcFineTuningClient";
import { createIpcAuditClient } from "./pages/settings/ipcAuditClient";
import { createIpcMcpRegistryClient } from "./pages/settings/ipcMcpRegistryClient";
import { createIpcAskInboxClient } from "./pages/inbox/ipcAskInboxClient";
import { AskInboxPanel } from "./pages/inbox/AskInboxPanel";
import { SETTINGS_MODELS_PATH } from "./shared/models/installedFeed";
import { createMockTelemetryStream } from "./lib/telemetryMock";
import { createLiveTelemetryStream } from "./lib/liveTelemetry";
import type { TelemetryStream } from "./components/LocalModelStatus.types";
import { ipcCall } from "./lib/ipc";
import { MotionActivityProvider, useMotionActivity } from "./motion";

export interface AppProps {
  // Test seam: callers may inject a fake telemetry stream.
  telemetryStream?: TelemetryStream | null;
}

// v1.10.0 Phase 6: the Settings > Skills tab drives its update-detection surface
// through the real sidecar `skills.*` IPC (installed version, upstream latest,
// one-click resync). Constructed once at module load so SettingsPage's memo
// does not re-run its load effect on every App render.
const skillsClient = createIpcSkillsClient();
// v1.12.0 EM.P2.A: the Settings > Skill Optimizer tab drives preview/apply through
// the real sidecar `skills.optimize.*` IPC. Constructed once at module load.
const skillOptimizerClient = createIpcSkillOptimizerClient();
// v1.15.0 Phase 4 (Issue 3): the Settings > Models tab now drives the real
// sidecar `models.*` IPC (reflect installed set + install/remove), replacing the
// hardcoded mock. Constructed once at module load.
const modelsClient = createIpcModelsClient();
// v1.16.0 Phase 1 (adoption item A1): the Settings > Local API server tab drives
// the real sidecar `serving.*` IPC (status + enable/disable of the loopback
// OpenAI/Anthropic gateway). Constructed once at module load.
const servingClient = createIpcServingClient();
const fineTuningClient = createIpcFineTuningClient();
const auditClient = createIpcAuditClient();
const mcpClient = createIpcMcpRegistryClient();
const askInboxClient = createIpcAskInboxClient();
const chatMemoryHub = new InMemoryMemoryHub();

async function sampleChatVideoFrames(dataUrl: string): Promise<{ frames: string[]; notice?: string }> {
  const reply = await ipcCall<{ frames: string[]; notice?: string }>("media.sampleVideoFrames", { dataUrl });
  if (!reply.ok) {
    return { frames: [], notice: "Video was not sent: frame sampling is unavailable. Attach a still image instead." };
  }
  return reply.value;
}

export function App({ telemetryStream }: AppProps = {}): JSX.Element {
  return (
    <MotionActivityProvider>
      <AppLayout telemetryStream={telemetryStream} />
    </MotionActivityProvider>
  );
}

function AppLayout({ telemetryStream }: AppProps): JSX.Element {
  const [stream, setStream] = useState<TelemetryStream | null>(telemetryStream ?? null);
  const [hostVramGB, setHostVramGB] = useState<number | null>(null);
  const navigate = useNavigate();
  // v2.2.3 Phase 1 (1.1): the error boundary is keyed by pathname so a crashed
  // module remounts cleanly when the user switches to another route.
  const location = useLocation();
  const { isAmbientReceded } = useMotionActivity();
  const ready = useReadyGate();

  useEffect(() => {
    if (telemetryStream !== undefined) {
      setStream(telemetryStream);
      return;
    }
    // v2.2.0 Phase 2 (2.4): poll the sidecar for REAL GPU telemetry. The mock
    // stream stays available behind an explicit dev flag, but it must never be
    // the shipped default -- it reported a loaded model and GPU load on hosts
    // where neither existed.
    const useMock = import.meta.env?.VITE_NEXUS_MOCK_TELEMETRY === "1";
    const created = useMock
      ? createMockTelemetryStream({ intervalMs: 2000 })
      : createLiveTelemetryStream({ intervalMs: 2000 });
    setStream(created);
    return () => created.stop();
  }, [telemetryStream]);

  useEffect(() => {
    if (!stream) return;
    return stream.subscribe((sample) => {
      if (typeof sample.vramTotalGB === "number") setHostVramGB(sample.vramTotalGB);
    });
  }, [stream]);

  // Fixed-viewport shell: the title bar is fixed chrome and the content row
  // scrolls internally. The ambient radial-glow + constellation backdrop sits
  // behind everything (z-index 0); foreground chrome layers above at z-index 1.
  const layoutStyle = useMemo<React.CSSProperties>(
    () => ({
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      overflow: "hidden",
      position: "relative",
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-0)",
    }),
    [],
  );

  return (
    <div data-testid="app-root" style={layoutStyle}>
      <div
        className={["nexus-app-backdrop", isAmbientReceded ? "nexus-ambient-recede" : ""]
          .filter(Boolean)
          .join(" ")}
        data-testid="app-backdrop"
        data-ambient-receded={isAmbientReceded ? "true" : "false"}
        aria-hidden
      />
      <ConstellationBackground opacity={0.5} zIndex={0} data-testid="app-constellation" />
      <TitleBar />
      <div
        data-testid="app-content"
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        {/*
          v2.2.0 Phase 6 (6.2): GPU telemetry moved from a fixed
          bottom-right dock (which covered Send / Generate on every page)
          into the sidebar footer.
        */}
        <Sidebar askInboxClient={askInboxClient} telemetryStream={stream} />
        <ReadyOverlay
          phase={ready.phase}
          status={ready.status}
          restarting={ready.restarting}
          restartError={ready.restartError}
          onRestart={() => void ready.restart()}
        />
        <main
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minWidth: 0,
            position: "relative",
          }}
        >
          {/*
            v2.2.3 Phase 1 (1.1): a module crash degrades to an in-pane error
            instead of blanking the whole app -- desktop/src had no error
            boundary anywhere before this.
          */}
          <ModuleErrorBoundary key={location.pathname}>
          <Routes>
            {/*
              v2.2.3 Phase 1 (1.2, U7): first launch and `/` land on Local
              Chatbot. Dashboard stays reachable at /dashboard for tests and
              deep links, but it is not the first-run landing.
            */}
            <Route path="/" element={<Navigate to="/chatbot" replace />} />
            <Route
              path="/dashboard"
              element={<Dashboard telemetryStream={stream} askInboxClient={askInboxClient} />}
            />
            <Route
              path="/chatbot"
              element={
                <ChatPage
                  onGetMoreModels={() => navigate(SETTINGS_MODELS_PATH)}
                  memoryHub={chatMemoryHub}
                  sampleVideoFrames={sampleChatVideoFrames}
                />
              }
            />
            <Route path="/coding" element={<CodingPage onGetMoreModels={() => navigate(SETTINGS_MODELS_PATH)} />} />
            <Route
              path="/images"
              element={<ImageStudioPage onGetMoreModels={() => navigate(SETTINGS_MODELS_PATH)} />}
            />
            <Route
              path="/videos"
              element={
                <VideoLabPage
                  onGetMoreModels={() => navigate(SETTINGS_MODELS_PATH)}
                  vramGB={hostVramGB ?? 0}
                  diffusionTier={classifyDiffusionTier(hostVramGB ?? 0)}
                  resolveMp4Url={convertFileSrc}
                />
              }
            />
            <Route
              path="/inbox"
              element={<AskInboxPanel client={askInboxClient} />}
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  modelsClient={modelsClient}
                  skillsClient={skillsClient}
                  skillOptimizerClient={skillOptimizerClient}
                  servingClient={servingClient}
                  fineTuningClient={fineTuningClient}
                  auditClient={auditClient}
                  mcpClient={mcpClient}
                  hostVramGB={hostVramGB}
                />
              }
            />
            {/*
              v2.2.0 Phase 7 (7.3) / Phase 6 (6.3): the User Profile page was a
              placeholder that never read a profile, and Ask inbox moved to the
              sidebar bell. Both redirect so old links and shortcuts still land
              somewhere real instead of on an empty screen.
            */}
            <Route path="/profile" element={<Navigate to="/settings" replace />} />
            <Route path="/inbox" element={<Navigate to="/settings" replace />} />
            <Route path="/_styleguide" element={<StyleguidePage />} />
          </Routes>
          </ModuleErrorBoundary>
        </main>
      </div>
    </div>
  );
}
