// v1.0.0 Phase 8.3 -- floating dock placement of the Local Model Status
// widget. The Dashboard renders the widget inline; every other module
// page receives the widget via this fixed-position dock so the four
// pillars share a consistent telemetry view.

import { LocalModelStatus } from "./LocalModelStatus";
import type { TelemetryStream } from "./LocalModelStatus.types";

interface LocalModelStatusDockProps {
  stream: TelemetryStream | null;
}

export function LocalModelStatusDock({ stream }: LocalModelStatusDockProps): JSX.Element {
  return (
    <div
      data-testid="local-model-status-dock"
      style={{
        position: "fixed",
        right: "var(--space-5)",
        bottom: "var(--space-5)",
        width: 280,
        zIndex: 50,
      }}
    >
      <LocalModelStatus stream={stream} />
    </div>
  );
}
