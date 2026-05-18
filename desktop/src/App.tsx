import { useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { ModulePlaceholder } from "./pages/ModulePlaceholder";
import { StyleguidePage } from "./pages/Styleguide";
import { CodingPage } from "./modules/coding/CodingPage";
import { ChatPage } from "./modules/chat/ChatPage";
import { ImageStudioPage } from "./modules/image/ImageStudioPage";
import { VideoLabPage } from "./modules/video/VideoLabPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { LocalModelStatusDock } from "./components/LocalModelStatusDock";
import { createMockTelemetryStream } from "./lib/telemetryMock";
import type { TelemetryStream } from "./components/LocalModelStatus.types";

export interface AppProps {
  // Test seam: callers may inject a fake telemetry stream.
  telemetryStream?: TelemetryStream | null;
}

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

  const layoutStyle = useMemo<React.CSSProperties>(
    () => ({
      display: "flex",
      minHeight: "100vh",
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-0)",
    }),
    [],
  );

  return (
    <div data-testid="app-root" style={layoutStyle}>
      <Sidebar />
      <main style={{ display: "flex", flex: 1, flexDirection: "column" }}>
        <Routes>
          <Route path="/" element={<Dashboard telemetryStream={stream} />} />
          <Route path="/chatbot" element={<ChatPage />} />
          <Route path="/coding" element={<CodingPage />} />
          <Route path="/images" element={<ImageStudioPage />} />
          <Route path="/videos" element={<VideoLabPage />} />
          <Route path="/settings" element={<SettingsPage />} />
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
  );
}

function DockMount({ stream }: { stream: TelemetryStream | null }): JSX.Element | null {
  const location = useLocation();
  // The Dashboard hosts the widget inline; every other module page gets
  // the floating dock so telemetry is always visible.
  if (location.pathname === "/" || location.pathname === "/_styleguide") return null;
  return <LocalModelStatusDock stream={stream} />;
}
