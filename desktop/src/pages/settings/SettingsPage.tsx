/**
 * v1.0.0 Phase 5.5 -- Settings shell.
 * v1.0.0 Phase 10.4 -- adds a "Skills" tab next to Models.
 */

import { useMemo, useState } from "react";

import { ModelsSettings, type ModelsClient } from "./ModelsSettings";
import { SkillsSettings, type SkillsSettingsClient } from "./SkillsSettings";
import { createMockModelsClient } from "./mockModelsClient";
import { createMockSkillsClient } from "./mockSkillsClient";

type SettingsTab = "models" | "skills";

export interface SettingsPageProps {
  modelsClient?: ModelsClient;
  skillsClient?: SkillsSettingsClient;
  initialTab?: SettingsTab;
}

export function SettingsPage({
  modelsClient,
  skillsClient,
  initialTab = "models",
}: SettingsPageProps = {}): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const models = useMemo<ModelsClient>(
    () => modelsClient ?? createMockModelsClient(),
    [modelsClient],
  );
  const skills = useMemo<SkillsSettingsClient>(
    () => skillsClient ?? createMockSkillsClient(),
    [skillsClient],
  );

  return (
    <div data-testid="settings-shell" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <nav data-testid="settings-tabs" style={tabsStyle}>
        <button
          type="button"
          data-testid="settings-tab-models"
          onClick={() => setTab("models")}
          style={tabButtonStyle(tab === "models")}
        >
          Models
        </button>
        <button
          type="button"
          data-testid="settings-tab-skills"
          onClick={() => setTab("skills")}
          style={tabButtonStyle(tab === "skills")}
        >
          Skills
        </button>
      </nav>
      {tab === "models" ? <ModelsSettings client={models} /> : <SkillsSettings client={skills} />}
    </div>
  );
}

const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-2, 8px)",
  padding: "var(--space-3, 12px) var(--space-6, 24px) 0",
  borderBottom: "1px solid var(--border-1, #2a2a2a)",
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "var(--space-2, 8px) var(--space-3, 12px)",
    border: "none",
    borderBottom: active ? "2px solid var(--accent-primary, #6366f1)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--fg-0)" : "var(--fg-muted)",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  };
}
