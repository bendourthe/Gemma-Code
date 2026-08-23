/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T017) -- credential-management
 * settings surface.
 *
 * Adopts the credential half of report item 25 (`re-partial`, Hermes Desktop
 * S5): manage integration secrets from the UI instead of editing config.
 *
 * CRITICAL (comparison Section 9.1): the credential half is a VIEW over the
 * Phase 1 `CredentialVault` (OS keychain) ONLY. Every mutation routes through
 * the injected {@link CredentialsClient} to the sidecar `credentials.*` IPC
 * methods, which write to the keychain. This surface NEVER writes a credential
 * to a config file or creates a second store. Stored values are never read back
 * into the UI -- only key names are listed.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, TextField } from "../../components/ui";
import type { CredentialsClient } from "./credentialsTypes";

export interface CredentialsSettingsProps {
  client: CredentialsClient;
}

export function CredentialsSettings({
  client,
}: CredentialsSettingsProps): JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [integration, setIntegration] = useState("");
  const [loadedIntegration, setLoadedIntegration] = useState<string | null>(null);
  const [keys, setKeys] = useState<readonly string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void client.status().then((s) => {
      if (active) setAvailable(s.available);
    });
    return () => {
      active = false;
    };
  }, [client]);

  const refreshKeys = useCallback(
    async (target: string) => {
      try {
        const list = await client.listKeys(target);
        setKeys(list);
        setLoadedIntegration(target);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  const handleLoad = useCallback(() => {
    const trimmed = integration.trim();
    if (!trimmed) return;
    void refreshKeys(trimmed);
  }, [integration, refreshKeys]);

  const handleSave = useCallback(async () => {
    const target = (loadedIntegration ?? integration).trim();
    const key = newKey.trim();
    if (!target || !key || !newValue) return;
    try {
      await client.setSecret(target, key, newValue);
      setNewKey("");
      setNewValue("");
      setStatus(`Saved "${key}" to the keychain.`);
      await refreshKeys(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, integration, loadedIntegration, newKey, newValue, refreshKeys]);

  const handleDelete = useCallback(
    async (key: string) => {
      const target = loadedIntegration;
      if (!target) return;
      try {
        await client.deleteSecret(target, key);
        setStatus(`Removed "${key}" from the keychain.`);
        await refreshKeys(target);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, loadedIntegration, refreshKeys],
  );

  return (
    <section data-testid="credentials-settings" style={sectionStyle}>
      <header>
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Credentials</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
          Integration secrets are stored only in your OS keychain -- never in a
          config file. Values are write-only here; only key names are shown.
        </p>
      </header>

      {available === false ? (
        <p data-testid="credentials-unavailable" role="alert" style={alertStyle}>
          The OS keychain is unavailable on this host, so credentials cannot be
          stored. Nexus does not fall back to plaintext; install your platform
          keychain tool or set the secret in the host environment.
        </p>
      ) : null}

      {error ? (
        <p data-testid="credentials-error" role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}
      {status ? (
        <p data-testid="credentials-status" role="status" aria-live="polite" style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
          {status}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Integration</span>
          <TextField
            testId="credentials-integration"
            value={integration}
            placeholder="e.g. github-mcp"
            onChange={setIntegration}
          />
        </label>
        <Button
          type="button"
          testId="credentials-load"
          onClick={handleLoad}
          disabled={available === false || integration.trim().length === 0}
        >
          Load keys
        </Button>
      </div>

      {loadedIntegration ? (
        <div data-testid="credentials-keys">
          <h3 style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)", margin: "var(--space-3) 0 var(--space-1)" }}>
            Stored keys for &quot;{loadedIntegration}&quot;
          </h3>
          {keys.length === 0 ? (
            <p data-testid="credentials-keys-empty" style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
              No credentials stored for this integration yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {keys.map((key) => (
                <li
                  key={key}
                  data-testid={`credential-row-${key}`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", border: "1px solid var(--border-1)", borderRadius: "var(--radius-md)", padding: "var(--space-1) var(--space-2)" }}
                >
                  <code>{key}</code>
                  <Button
                    type="button"
                    testId={`credential-delete-${key}`}
                    variant="danger"
                    onClick={() => void handleDelete(key)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", marginTop: "var(--space-3)" }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Key</span>
              <TextField
                testId="credentials-new-key"
                value={newKey}
                placeholder="e.g. GITHUB_TOKEN"
                onChange={setNewKey}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Value</span>
              <TextField
                testId="credentials-new-value"
                type="password"
                value={newValue}
                onChange={setNewValue}
              />
            </label>
            <Button
              type="button"
              testId="credentials-save"
              onClick={() => void handleSave()}
              disabled={available === false || newKey.trim().length === 0 || newValue.length === 0}
            >
              Save to keychain
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
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

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--fg-muted)",
};
