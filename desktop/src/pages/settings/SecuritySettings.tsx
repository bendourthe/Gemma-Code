/**
 * v1.19.1 Phase 2.5 -- Security posture settings tab.
 *
 * Plain-language copy for Strict / Standard / Unattended. Persistence is
 * injected so tests do not need localStorage; the default client writes
 * `nexus.coding.securityPosture` in localStorage (desktop) which mirrors the
 * VS Code setting key of the same name.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Select, Switch, TextField } from "../../components/ui";
import { ipcCall } from "../../lib/ipc";

export type DesktopSecurityPosture = "strict" | "standard" | "unattended";

export interface SecuritySettingsClient {
  getPosture(): Promise<DesktopSecurityPosture>;
  setPosture(id: DesktopSecurityPosture): Promise<void>;
}

export interface AuditLogClient {
  list(query?: {
    actor?: "app" | "planner" | "critic" | "worker";
    pillar?: string;
    since?: string;
    until?: string;
  }): Promise<
    readonly {
      id: number;
      ts: string;
      actor: string;
      pillar: string;
      kind: string;
      trusted: boolean;
    }[]
  >;
  status(): Promise<{ eventCount: number; droppedCount: number; vaultAvailable: boolean }>;
}

function emptyAuditClient(): AuditLogClient {
  return {
    async list() {
      return [];
    },
    async status() {
      return { eventCount: 0, droppedCount: 0, vaultAvailable: true };
    },
  };
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

export interface ParseDocumentSettingsClient {
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

function ipcParseDocumentClient(): ParseDocumentSettingsClient {
  return {
    async getEnabled() {
      const reply = await ipcCall<{ enabled: boolean }>("coding.parseDocument.status", {});
      if (!reply.ok) return false;
      return reply.value.enabled;
    },
    async setEnabled(enabled) {
      const reply = await ipcCall<{ enabled: boolean }>("coding.parseDocument.setEnabled", { enabled });
      if (!reply.ok) throw new Error(reply.message);
    },
  };
}

const DEFAULT_PARSE_DOCUMENT_CLIENT = ipcParseDocumentClient();

export interface SecuritySettingsProps {
  client?: SecuritySettingsClient;
  auditClient?: AuditLogClient;
  parseDocumentClient?: ParseDocumentSettingsClient;
}

export function SecuritySettings({
  client,
  auditClient,
  parseDocumentClient,
}: SecuritySettingsProps): JSX.Element {
  const [posture, setPosture] = useState<DesktopSecurityPosture>("standard");
  const [ready, setReady] = useState(false);
  const [actorFilter, setActorFilter] = useState<string>("");
  const [pillarFilter, setPillarFilter] = useState("");
  const [events, setEvents] = useState<
    readonly { id: number; ts: string; actor: string; pillar: string; kind: string; trusted: boolean }[]
  >([]);
  const [dropped, setDropped] = useState(0);
  const [vaultAvailable, setVaultAvailable] = useState(true);
  const [parseDocumentEnabled, setParseDocumentEnabled] = useState(false);
  const resolved = client ?? createLocalStorageSecurityClient();
  const audit = auditClient ?? emptyAuditClient();
  const parseDocument = parseDocumentClient ?? DEFAULT_PARSE_DOCUMENT_CLIENT;

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

  const refreshAudit = useCallback(() => {
    void Promise.all([
      audit.list({
        actor:
          actorFilter === "app" || actorFilter === "planner" || actorFilter === "critic" || actorFilter === "worker"
            ? actorFilter
            : undefined,
        pillar: pillarFilter.trim() || undefined,
      }),
      audit.status(),
    ]).then(([listed, status]) => {
      setEvents(listed);
      setDropped(status.droppedCount);
      setVaultAvailable(status.vaultAvailable);
    });
  }, [audit, actorFilter, pillarFilter]);

  useEffect(() => {
    let active = true;
    void parseDocument.getEnabled().then((enabled) => {
      if (active) setParseDocumentEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, [parseDocument]);

  useEffect(() => {
    refreshAudit();
  }, [refreshAudit]);

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
      <section data-testid="parse-document-settings" style={{ marginTop: 32 }}>
        <h2>Document parsing</h2>
        <p style={{ color: "var(--fg-muted)", maxWidth: 640 }}>
          Opt-in for the coding agent <code>parse_document</code> tool. Writes
          <code> nexus.coding.parseDocument.enabled</code> in local settings.
          Off by default.
        </p>
        <Switch
          testId="parse-document-toggle"
          checked={parseDocumentEnabled}
          onChange={(next) => {
            setParseDocumentEnabled(next);
            void parseDocument.setEnabled(next);
          }}
          label="Enable parse_document for coding sessions"
        />
      </section>
      <section data-testid="audit-log-viewer" style={{ marginTop: 32 }}>
        <h2>Local audit log</h2>
        <p style={{ color: "var(--fg-muted)", maxWidth: 640 }}>
          Append-only, signed on this machine. Untrusted rows failed signature
          verification (tamper or corruption). Dropped events are counted, never
          silent.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <label>
            Actor
            <Select
              data-testid="audit-filter-actor"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
            >
              <option value="">any</option>
              <option value="app">app</option>
              <option value="planner">planner</option>
              <option value="critic">critic</option>
              <option value="worker">worker</option>
            </Select>
          </label>
          <label>
            Pillar
            <TextField
              testId="audit-filter-pillar"
              value={pillarFilter}
              onChange={setPillarFilter}
              placeholder="coding"
            />
          </label>
          <Button type="button" testId="audit-refresh" onClick={refreshAudit}>
            Refresh
          </Button>
          <span data-testid="audit-dropped-count">Dropped: {dropped}</span>
        </div>
        {!vaultAvailable ? (
          <p data-testid="audit-vault-notice" style={{ color: "var(--fg-muted)", maxWidth: 640 }}>
            OS keychain unavailable. Signing keys stay in process memory and
            reset on restart; older rows may show as untrusted. No plaintext key
            files are written.
          </p>
        ) : null}
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Time</th>
              <th align="left">Actor</th>
              <th align="left">Pillar</th>
              <th align="left">Kind</th>
              <th align="left">Trusted</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} data-testid={`audit-row-${event.id}`}>
                <td>{event.ts}</td>
                <td>{event.actor}</td>
                <td>{event.pillar}</td>
                <td>{event.kind}</td>
                <td data-trusted={event.trusted ? "true" : "false"}>{event.trusted ? "yes" : "untrusted"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
