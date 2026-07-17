import { useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { ConstellationBackground } from "./components/ConstellationBackground";
import { Dashboard } from "./pages/Dashboard";
import { ModulePlaceholder } from "./pages/ModulePlaceholder";
import { StyleguidePage } from "./pages/Styleguide";
import { CodingPage } from "./modules/coding/CodingPage";
import { ChatPage } from "./modules/chat/ChatPage";
import { ImageStudioPage } from "./modules/image/ImageStudioPage";
import { VideoLabPage } from "./modules/video/VideoLabPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { createIpcSkillsClient } from "./pages/settings/ipcSkillsClient";
import { createIpcSkillOptimizerClient } from "./pages/settings/ipcSkillOptimizerClient";
import { LocalModelStatusDock } from "./components/LocalModelStatusDock";
import { createMockTelemetryStream } from "./lib/telemetryMock";
import type { TelemetryStream } from "./components/LocalModelStatus.types";

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

export function App({ telemetryStream }: AppProps = {}): JSX.Element {
  const [stream, setStream] = useState<TelemetryStream | null>(telemetryStream ?? null);

  useEffect(() => {
    if (telemetryStream !== undefined) {
      setStream(telemetryStream);
      return;
    }
    const created = createMockTelemetryStream({ intervalMs: 2000 });
    setStream(created);
    return () => created.stop();
  }, [telemetryStream]);

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
      <div className="nexus-app-backdrop" data-testid="app-backdrop" aria-hidden />
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
        <Sidebar />
        <main
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minWidth: 0,
            position: "relative",
          }}
        >
          <Routes>
            <Route path="/" element={<Dashboard telemetryStream={stream} />} />
            <Route path="/chatbot" element={<ChatPage />} />
            <Route path="/coding" element={<CodingPage />} />
            <Route path="/images" element={<ImageStudioPage />} />
            <Route path="/videos" element={<VideoLabPage />} />
            <Route
              path="/settings"
              element={
                <SettingsPage skillsClient={skillsClient} skillOptimizerClient={skillOptimizerClient} />
              }
            />
            <Route
              path="/profile"
              element={
                <ModulePlaceholder
                  moduleId="coding"
                  message="Profile editor placeholder. Reads ~/.nexus/profile.json once Phase 2 lands the storage migration."
                />
              }
            />
            <Route path="/_styleguide" element={<StyleguidePage />} />
          </Routes>
          <DockMount stream={stream} />
        </main>
      </div>
    </div>
  );
}

function DockMount({ stream }: { stream: TelemetryStream | null }): JSX.Element | null {
  const location = useLocation();
  // The Dashboard hosts the widget inline; every other module page gets
  // the floating dock so telemetry is always visible.
  if (location.pathname === "/" || location.pathname === "/_styleguide") return null;
  return <LocalModelStatusDock stream={stream} />;
}
