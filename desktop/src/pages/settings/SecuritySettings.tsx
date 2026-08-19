/**
 * v1.19.1 Phase 2.5 -- Security posture settings tab.
 *
 * Plain-language copy for Strict / Standard / Unattended. Persistence is
 * injected so tests do not need localStorage; the default client writes
 * `nexus.coding.securityPosture` in localStorage (desktop) which mirrors the
 * VS Code setting key of the same name.
 */

import { useCallback, useEffect, useState } from "react";

export type DesktopSecurityPosture = "strict" | "standard" | "unattended";

export interface SecuritySettingsClient {
  getPosture(): Promise<DesktopSecurityPosture>;
  setPosture(id: DesktopSecurityPosture): Promise<void>;
}

const STORAGE_KEY = "nexus.coding.securityPosture";

export function createLocalStorageSecurityClient(): SecuritySettingsClient {
  return {
    async getPosture() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === "strict" || raw === "standard" || raw === "unattended") return raw;
      } catch {
        // localStorage can throw in a locked-down webview.
      }
      return "standard";
    },
    async setPosture(id) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore quota / privacy mode
      }
    },
  };
}

const OPTIONS: readonly {
  id: DesktopSecurityPosture;
  label: string;
  summary: string;
}[] = [
  {
    id: "strict",
    label: "Strict",
    summary:
      "Confirm every file edit and terminal command. Screen all tool output for prompt injection. Verification stays on. Hard-denied commands never run.",
  },
  {
    id: "standard",
    label: "Standard",
    summary:
      "Confirm edits and dangerous tools. Screen web, MCP, and browser results. Hard-denied commands never run.",
  },
  {
    id: "unattended",
    label: "Unattended",
    summary:
      "Fewer confirmation prompts on reversible edits so long-running jobs can proceed. Dangerous tools (terminal, web fetch) still require confirmation. Hard-denied commands never run. This is not a no-floor mode.",
  },
];

export interface SecuritySettingsProps {
  client?: SecuritySettingsClient;
}

export function SecuritySettings({ client }: SecuritySettingsProps): JSX.Element {
  const [posture, setPosture] = useState<DesktopSecurityPosture>("standard");
  const [ready, setReady] = useState(false);
  const resolved = client ?? createLocalStorageSecurityClient();

  useEffect(() => {
    let active = true;
    void resolved.getPosture().then((value) => {
      if (active) {
        setPosture(value);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [resolved]);

  const onSelect = useCallback(
    (id: DesktopSecurityPosture) => {
      setPosture(id);
      void resolved.setPosture(id);
    },
    [resolved],
  );

  return (
    <div data-testid="settings-security" style={{ padding: "var(--space-6, 24px)" }}>
      <h2 style={{ marginTop: 0 }}>Security posture</h2>
      <p style={{ color: "var(--fg-muted)", maxWidth: 640 }}>
        One named dial over the existing permission tiers. Switching postures
        changes confirmation frequency and screening strictness. It never
        lowers the floor: dangerous tools still confirm, and hard-denied
        commands are blocked in every posture.
      </p>
      <fieldset
        data-testid="security-posture-fieldset"
        disabled={!ready}
        style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}
      >
        <legend className="sr-only">Security posture</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.id}
            data-testid={`security-posture-${option.id}`}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: 12,
              border:
                posture === option.id
                  ? "1px solid var(--accent-primary, #6366f1)"
                  : "1px solid var(--border-1, #2a2a2a)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="security-posture"
              value={option.id}
              checked={posture === option.id}
              onChange={() => onSelect(option.id)}
            />
            <span>
              <strong>{option.label}</strong>
              <span style={{ display: "block", color: "var(--fg-muted)", marginTop: 4 }}>
                {option.summary}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
