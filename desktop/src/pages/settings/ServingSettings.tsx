/**
 * v1.16.0 Phase 1.5 (adoption item A1) -- "Local API server" settings surface.
 *
 * One toggle plus the two things a user must copy into another tool (Claude Code,
 * Codex, Cursor): the base URL and the local token. Everything else is read-only
 * state so the section explains itself without documentation.
 *
 * The token is masked by default behind an explicit reveal, following the
 * `CredentialsSettings` precedent -- it is a credential, and a Settings pane is
 * often on screen while screen-sharing. It is copyable without being revealed.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Switch } from "../../components/ui";
import type { AcpStatusDto, ServingClient, ServingStatusDto } from "./servingTypes";

export interface ServingSettingsProps {
  client: ServingClient;
  /** Injected in tests; defaults to the browser clipboard. */
  writeClipboard?: (text: string) => Promise<void>;
}

const OPENAI_PATHS = ["GET /v1/models", "POST /v1/chat/completions"];
const ANTHROPIC_PATHS = ["POST /v1/messages"];

export function ServingSettings({ client, writeClipboard }: ServingSettingsProps): JSX.Element {
  const [status, setStatus] = useState<ServingStatusDto | null>(null);
  const [acp, setAcp] = useState<AcpStatusDto | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([client.status(), client.acpStatus()]).then(
      ([s, a]) => {
        if (active) {
          setStatus(s);
          setAcp(a);
        }
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        setStatus(await client.setEnabled(next));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const handleAcpToggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        setAcp(await client.setAcpEnabled(next));
        setStatus(await client.status());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const copy = useCallback(
    async (label: string, value: string) => {
      const write = writeClipboard ?? ((text: string) => navigator.clipboard.writeText(text));
      try {
        await write(value);
        setNotice(`${label} copied to the clipboard.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [writeClipboard],
  );

  return (
    <section data-testid="serving-settings" style={sectionStyle}>
      <header>
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Local API server</h2>
        <p
          style={{
            color: "var(--fg-muted)",
            fontSize: "var(--text-sm)",
            margin: "var(--space-1) 0 0",
          }}
        >
          Serves your installed local models to other tools on this machine only.
          The server binds a loopback address, requires the token below, and
          exposes model inference only -- never your files, terminal, or tools.
        </p>
      </header>

      {error ? (
        <p data-testid="serving-error" role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          data-testid="serving-notice"
          role="status"
          aria-live="polite"
          style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", margin: 0 }}
        >
          {notice}
        </p>
      ) : null}

      {status === null ? (
        <p data-testid="serving-loading" style={mutedStyle}>
          Checking the local API server...
        </p>
      ) : (
        <>
          <Switch
            testId="serving-toggle"
            checked={status.enabled}
            disabled={busy}
            onChange={(next) => void handleToggle(next)}
            label="Enable the local API server"
          />

          <p data-testid="serving-state" style={mutedStyle}>
            {status.running
              ? `Running on ${status.host}:${status.port}`
              : status.enabled || acp?.enabled
                ? "Enabled but not listening -- check the log for a bind error."
                : "Stopped. No port is bound while both the API server and ACP are off."}
          </p>

          <Switch
            testId="acp-toggle"
            checked={acp?.enabled ?? false}
            disabled={busy}
            onChange={(next) => void handleAcpToggle(next)}
            label="Enable the ACP agent (same loopback listener and token)"
          />

          {acp?.enabled ? (
            <div style={fieldRowStyle}>
              <span style={labelStyle}>ACP</span>
              <code data-testid="acp-endpoint" style={valueStyle}>
                {acp.endpoint}
              </code>
              <Button
                type="button"
                testId="acp-copy-endpoint"
                onClick={() => void copy("ACP endpoint", acp.endpoint)}
              >
                Copy
              </Button>
            </div>
          ) : null}

          {status.running || status.enabled || acp?.enabled ? (
            <>
              {status.enabled ? (
                <div style={fieldRowStyle}>
                  <span style={labelStyle}>Base URL</span>
                  <code data-testid="serving-base-url" style={valueStyle}>
                    {status.baseUrl}
                  </code>
                  <Button
                    type="button"
                    testId="serving-copy-url"
                    onClick={() => void copy("Base URL", status.baseUrl)}
                  >
                    Copy
                  </Button>
                </div>
              ) : null}

              <div style={fieldRowStyle}>
                <span style={labelStyle}>Token</span>
                <code data-testid="serving-token" style={valueStyle}>
                  {revealed ? status.token : maskToken(status.token)}
                </code>
                <Button
                  type="button"
                  testId="serving-reveal-token"
                  variant="ghost"
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? "Hide" : "Reveal"}
                </Button>
                <Button
                  type="button"
                  testId="serving-copy-token"
                  onClick={() => void copy("Token", status.token)}
                >
                  Copy
                </Button>
              </div>

              {status.enabled ? (
                <div data-testid="serving-endpoints">
                  <h3 style={subheadStyle}>Endpoints</h3>
                  <p style={mutedStyle}>
                    OpenAI-compatible: {OPENAI_PATHS.join(", ")}. Anthropic-compatible:{" "}
                    {ANTHROPIC_PATHS.join(", ")}. JSON CLI: POST /nexus/session/new, POST
                    /nexus/session/send, GET /nexus/session/list, GET /nexus/models, POST
                    /nexus/generate/queue. Send the token as{" "}
                    <code>Authorization: Bearer &lt;token&gt;</code> or <code>x-api-key</code>.
                  </p>
                </div>
              ) : (
                <p data-testid="acp-token-hint" style={mutedStyle}>
                  ACP uses the same token as{" "}
                  <code>Authorization: Bearer &lt;token&gt;</code>. The JSON CLI
                  (<code>nexus session</code> / <code>nexus models list</code> /{" "}
                  <code>nexus generate</code>) uses this token on the loopback
                  listener even when the local API server is off. OpenAI-compatible
                  <code> /v1</code> paths stay off until the local API server is
                  enabled.
                </p>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Show only the last 4 characters, so a revealed-by-accident token is useless. */
function maskToken(token: string): string {
  if (token.length <= 4) return "****";
  return `${"*".repeat(Math.min(24, token.length - 4))}${token.slice(-4)}`;
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-4) var(--space-6)",
  flex: 1,
  overflowY: "auto",
};

const alertStyle: React.CSSProperties = {
  color: "var(--accent-danger, #f87171)",
  fontSize: "var(--text-sm)",
  margin: 0,
};

const mutedStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--text-sm)",
  margin: 0,
};

const subheadStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--fg-muted)",
  margin: "0 0 var(--space-1)",
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--fg-muted)",
  minWidth: "72px",
};

const valueStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-2)",
  color: "var(--fg-0)",
  wordBreak: "break-all",
};
