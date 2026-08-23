/**
 * v1.0.0 Phase 5.5 -- Settings shell.
 * v1.0.0 Phase 10.4 -- adds a "Skills" tab next to Models.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DataSettings } from "./DataSettings";

import { ModelsSettings, type ModelsClient } from "./ModelsSettings";
import { SkillsSettings, type SkillsSettingsClient } from "./SkillsSettings";
import { SkillOptimizerSettings, type SkillOptimizerClient } from "./SkillOptimizerSettings";
import { CredentialsSettings } from "./CredentialsSettings";
import type { CredentialsClient } from "./credentialsTypes";
import { ServingSettings } from "./ServingSettings";
import type { ServingClient } from "./servingTypes";
import { FineTuningSettings } from "./FineTuningSettings";
import type { FineTuningClient } from "./fineTuningTypes";
import { McpRegistrySettings } from "./McpRegistrySettings";
import type { McpRegistryClient } from "./mcpTypes";
import { SecuritySettings, type AuditLogClient, type SecuritySettingsClient } from "./SecuritySettings";
import { createMockModelsClient } from "./mockModelsClient";
import { createMockSkillsClient } from "./mockSkillsClient";
import { createMockSkillOptimizerClient } from "./mockSkillOptimizerClient";
import { createMockCredentialsClient } from "./mockCredentialsClient";
import { createMockServingClient } from "./mockServingClient";
import { createMockFineTuningClient } from "./mockFineTuningClient";
import { createMockMcpRegistryClient } from "./mockMcpRegistryClient";

// v2.2.0 Phase 7: "data" hosts export/import; the retired User Profile page
// redirects here rather than rendering a placeholder that read nothing.
type SettingsTab =
  | "models"
  | "skills"
  | "optimizer"
  | "credentials"
  | "serving"
  | "tuning"
  | "mcp"
  | "security"
  | "data";

const SETTINGS_TABS: readonly SettingsTab[] = [
  "models",
  "skills",
  "optimizer",
  "credentials",
  "serving",
  "tuning",
  "mcp",
  "security",
  "data",
];

function parseSettingsTab(raw: string | null): SettingsTab | null {
  if (raw && (SETTINGS_TABS as readonly string[]).includes(raw)) {
    return raw as SettingsTab;
  }
  return null;
}

export interface SettingsPageProps {
  modelsClient?: ModelsClient;
  skillsClient?: SkillsSettingsClient;
  skillOptimizerClient?: SkillOptimizerClient;
  credentialsClient?: CredentialsClient;
  /** v1.16.0 Phase 1.5 -- Local API server (serving gateway) section. */
  servingClient?: ServingClient;
  /** v2.1.0 Phase 5 -- local Unsloth Core fine-tuning. */
  fineTuningClient?: FineTuningClient;
  /** v1.18.0 Phase 3 (OW-A5) -- per-tool MCP deny. */
  mcpClient?: McpRegistryClient;
  securityClient?: SecuritySettingsClient;
  auditClient?: AuditLogClient;
  initialTab?: SettingsTab;
  /** v1.16.0 Phase 5 (A4) -- host VRAM for the Models page tier-fit filter. */
  hostVramGB?: number | null;
}

export function SettingsPage({
  modelsClient,
  skillsClient,
  skillOptimizerClient,
  credentialsClient,
  servingClient,
  fineTuningClient,
  mcpClient,
  securityClient,
  auditClient,
  initialTab = "models",
  hostVramGB = null,
}: SettingsPageProps = {}): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = parseSettingsTab(searchParams.get("tab"));
  const [tab, setTabState] = useState<SettingsTab>(tabFromUrl ?? initialTab);

  useEffect(() => {
    const next = parseSettingsTab(searchParams.get("tab"));
    if (next) setTabState(next);
  }, [searchParams]);

  function setTab(next: SettingsTab): void {
    setTabState(next);
    setSearchParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set("tab", next);
        return copy;
      },
      { replace: true },
    );
  }
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
  const fineTuning = useMemo<FineTuningClient>(
    () => fineTuningClient ?? createMockFineTuningClient(),
    [fineTuningClient],
  );
  const mcp = useMemo<McpRegistryClient>(
    () => mcpClient ?? createMockMcpRegistryClient(),
    [mcpClient],
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
        <button
          type="button"
          data-testid="settings-tab-tuning"
          onClick={() => setTab("tuning")}
          style={tabButtonStyle(tab === "tuning")}
        >
          Fine-tuning
        </button>
        <button
          type="button"
          data-testid="settings-tab-mcp"
          onClick={() => setTab("mcp")}
          style={tabButtonStyle(tab === "mcp")}
        >
          MCP
        </button>
        <button
          type="button"
          data-testid="settings-tab-security"
          onClick={() => setTab("security")}
          style={tabButtonStyle(tab === "security")}
        >
          Security
        </button>
        <button
          type="button"
          data-testid="settings-tab-data"
          onClick={() => setTab("data")}
          style={tabButtonStyle(tab === "data")}
        >
          Data
        </button>
      </nav>
      {tab === "models" ? (
        <ModelsSettings client={models} hostVramGB={hostVramGB} />
      ) : tab === "skills" ? (
        <SkillsSettings client={skills} />
      ) : tab === "optimizer" ? (
        <SkillOptimizerSettings client={skillOptimizer} />
      ) : tab === "serving" ? (
        <ServingSettings client={serving} />
      ) : tab === "tuning" ? (
        <FineTuningSettings client={fineTuning} />
      ) : tab === "mcp" ? (
        <McpRegistrySettings client={mcp} />
      ) : tab === "security" ? (
        <SecuritySettings client={securityClient} auditClient={auditClient} />
      ) : tab === "data" ? (
        <DataSettings />
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
