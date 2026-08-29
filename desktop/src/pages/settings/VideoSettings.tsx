/**
 * v2.3.0 Phase 5 -- Settings > Video.
 *
 * Detects a separately installed Video2X executable. Nexus does not download
 * or bundle Video2X; FFmpeg remains the media probe and mux dependency.
 */

import { useEffect, useState } from "react";

import { Button, TextField } from "../../components/ui";
import {
  VIDEO_ENHANCEMENT_SUPPORT,
} from "../../../../core/video/videoEnhancementSupport";
import { createIpcVideoSettingsClient } from "./ipcVideoSettingsClient";
import type { VideoSettingsClient } from "./videoSettingsTypes";

export interface VideoSettingsProps {
  client?: VideoSettingsClient;
}

export function VideoSettings({ client }: VideoSettingsProps): JSX.Element {
  const [resolvedClient] = useState<VideoSettingsClient>(
    () => client ?? createIpcVideoSettingsClient(),
  );
  const [draft, setDraft] = useState("");
  const [envOverride, setEnvOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void resolvedClient.getPath().then(
      (value) => {
        if (!active) return;
        setDraft(value.settingPath ?? "");
        setEnvOverride(value.configurationSource === "environment");
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [resolvedClient]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const next = await resolvedClient.setPath(draft);
      setDraft(next.settingPath ?? "");
      setEnvOverride(next.configurationSource === "environment");
      setStatus(
        next.settingPath
          ? "Saved the Video2X executable path."
          : "Cleared the saved Video2X executable path.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="settings-video"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-6, 24px)",
      }}
    >
      <header>
        <h1 style={{ margin: 0 }}>Video</h1>
        <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
          {VIDEO_ENHANCEMENT_SUPPORT.setupCopy}
        </p>
      </header>

      {error ? (
        <p data-testid="video-settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p data-testid="video-settings-status">{status}</p>
      ) : null}
      {envOverride ? (
        <p data-testid="video-settings-env-override">
          {VIDEO_ENHANCEMENT_SUPPORT.envWinsCopy}
        </p>
      ) : null}

      <TextField
        testId="video-settings-path"
        label={VIDEO_ENHANCEMENT_SUPPORT.settingsFieldLabel}
        value={draft}
        onChange={setDraft}
        placeholder="Absolute Video2X 6.4.0 executable path"
        autoComplete="off"
      />
      <Button
        testId="video-settings-save"
        busy={busy}
        onClick={() => void save()}
      >
        Save path
      </Button>
    </section>
  );
}
