/**
 * v1.0.0 Phase 5.5 -- Settings shell.
 * v1.0.0 Phase 10.4 -- adds a "Skills" tab next to Models.
 */

import { useMemo, useState } from "react";

import { ModelsSettings, type ModelsClient } from "./ModelsSettings";
import { SkillsSettings, type SkillsSettingsClient } from "./SkillsSettings";
import { SkillOptimizerSettings, type SkillOptimizerClient } from "./SkillOptimizerSettings";
import { CredentialsSettings } from "./CredentialsSettings";
import type { CredentialsClient } from "./credentialsTypes";
import { ServingSettings } from "./ServingSettings";
import type { ServingClient } from "./servingTypes";
import { createMockModelsClient } from "./mockModelsClient";
import { createMockSkillsClient } from "./mockSkillsClient";
import { createMockSkillOptimizerClient } from "./mockSkillOptimizerClient";
import { createMockCredentialsClient } from "./mockCredentialsClient";
import { createMockServingClient } from "./mockServingClient";

type SettingsTab = "models" | "skills" | "optimizer" | "credentials" | "serving";

export interface SettingsPageProps {
  modelsClient?: ModelsClient;
  skillsClient?: SkillsSettingsClient;
  skillOptimizerClient?: SkillOptimizerClient;
  credentialsClient?: CredentialsClient;
  /** v1.16.0 Phase 1.5 -- Local API server (serving gateway) section. */
  servingClient?: ServingClient;
  initialTab?: SettingsTab;
}

export function SettingsPage({
  modelsClient,
  skillsClient,
  skillOptimizerClient,
  credentialsClient,
  servingClient,
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
  const skillOptimizer = useMemo<SkillOptimizerClient>(
    () => skillOptimizerClient ?? createMockSkillOptimizerClient(),
    [skillOptimizerClient],
  );
  const credentials = useMemo<CredentialsClient>(
    () => credentialsClient ?? createMockCredentialsClient(),
    [credentialsClient],
  );
  const serving = useMemo<ServingClient>(
    () => servingClient ?? createMockServingClient(),
    [servingClient],
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
        <button
          type="button"
          data-testid="settings-tab-optimizer"
          onClick={() => setTab("optimizer")}
          style={tabButtonStyle(tab === "optimizer")}
        >
          Skill Optimizer
        </button>
        <button
          type="button"
          data-testid="settings-tab-credentials"
          onClick={() => setTab("credentials")}
          style={tabButtonStyle(tab === "credentials")}
        >
          Credentials
        </button>
        <button
          type="button"
          data-testid="settings-tab-serving"
          onClick={() => setTab("serving")}
          style={tabButtonStyle(tab === "serving")}
        >
          Local API server
        </button>
      </nav>
      {tab === "models" ? (
        <ModelsSettings client={models} />
      ) : tab === "skills" ? (
        <SkillsSettings client={skills} />
      ) : tab === "optimizer" ? (
        <SkillOptimizerSettings client={skillOptimizer} />
      ) : tab === "serving" ? (
        <ServingSettings client={serving} />
      ) : (
        <CredentialsSettings client={credentials} />
      )}
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
