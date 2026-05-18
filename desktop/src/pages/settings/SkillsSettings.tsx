/**
 * v1.0.0 Phase 10.4 + 10.6 -- Settings > Skills page.
 *
 * Surfaces the DevAI-Hub sync surface and the per-skill enable/disable
 * controls. The page is provider-driven: callers inject a `SkillsClient`
 * so tests (and the eventual IPC wiring) can swap the real disk-backed
 * `SkillCatalog` + `DevAIHubSyncer` for an in-memory fake.
 *
 * Sections:
 *   - Header: active tag, upstream-latest tag, "Sync now" + "Auto-sync
 *     weekly" toggle.
 *   - Quarantined: skills the prompt-injection scanner flagged at `high`
 *     severity; rendered separately with a "Review and approve" action.
 *   - Per-namespace lists: `builtin`, `user`, `devai-hub`. Each row shows
 *     the namespaced id, the source tag (when devai-hub), and a small
 *     `diverged` badge for names that exist in more than one namespace
 *     (Phase 10.6).
 */

import { useEffect, useMemo, useState } from "react";

import type { SkillRecord, SkillNamespace } from "../../../../core/skills/SkillCatalog";
import type { ScanResult } from "../../../../core/skills/PromptInjectionScanner";

export type SkillRowDto = SkillRecord & {
  /** When the scanner blocked this skill, the latest scan result. */
  quarantine?: ScanResult;
};

export interface SkillsSettingsClient {
  list(): Promise<readonly SkillRowDto[]>;
  /** Returns the currently-active DevAI-Hub tag (null when nothing synced). */
  activeTag(): Promise<string | null>;
  /** Returns the latest tag available upstream (null when offline). */
  upstreamLatestTag(): Promise<string | null>;
  /** Auto-sync schedule: true when weekly idle-time sync is enabled. */
  autoSyncEnabled(): Promise<boolean>;
  setAutoSyncEnabled(enabled: boolean): Promise<void>;
  /** Trigger a full sync (matches `nexus skills sync --apply`). */
  syncNow(): Promise<{ tag: string; applied: boolean; summary: string }>;
  /** Re-run the scanner against a quarantined skill with manual override. */
  approveQuarantined(id: string): Promise<void>;
  /** Toggle a skill's active state. */
  setActive(id: string, active: boolean): Promise<void>;
  /** Pick which side of a divergence is the default (Phase 10.6). */
  setDivergedPreference?(displayName: string, preference: "user" | "devai-hub"): Promise<void>;
}

export interface SkillsSettingsProps {
  client: SkillsSettingsClient;
}

export function SkillsSettings({ client }: SkillsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly SkillRowDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [upstreamTag, setUpstreamTag] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      client.list(),
      client.activeTag(),
      client.upstreamLatestTag(),
      client.autoSyncEnabled(),
    ])
      .then(([rows, active, upstream, auto]) => {
        if (cancelled) return;
        setItems(rows);
        setActiveTag(active);
        setUpstreamTag(upstream);
        setAutoSync(auto);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageFor(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function refresh(): Promise<void> {
    const [rows, active] = await Promise.all([client.list(), client.activeTag()]);
    setItems(rows);
    setActiveTag(active);
  }

  const grouped = useMemo(() => {
    const out: Record<SkillNamespace, SkillRowDto[]> = {
      builtin: [],
      user: [],
      "devai-hub": [],
    };
    const quarantined: SkillRowDto[] = [];
    for (const item of items) {
      if (item.quarantine && item.quarantine.decision === "block") {
        quarantined.push(item);
        continue;
      }
      out[item.provenance.source].push(item);
    }
    return { ...out, quarantined };
  }, [items]);

  async function handleSyncNow(): Promise<void> {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await client.syncNow();
      setSyncStatus(
        result.applied
          ? `Synced ${result.tag} (${result.summary})`
          : `Sync prepared ${result.tag} but did not apply: ${result.summary}`,
      );
      await refresh();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleAutoSyncToggle(next: boolean): Promise<void> {
    try {
      await client.setAutoSyncEnabled(next);
      setAutoSync(next);
    } catch (e) {
      setError(messageFor(e));
    }
  }

  async function handleApprove(id: string): Promise<void> {
    try {
      await client.approveQuarantined(id);
      await refresh();
    } catch (e) {
      setError(messageFor(e));
    }
  }

  async function handleToggleActive(item: SkillRowDto): Promise<void> {
    try {
      await client.setActive(item.id, !item.active);
      await refresh();
    } catch (e) {
      setError(messageFor(e));
    }
  }

  async function handleDivergedPreference(
    item: SkillRowDto,
    preference: "user" | "devai-hub",
  ): Promise<void> {
    if (!client.setDivergedPreference) return;
    try {
      await client.setDivergedPreference(item.displayName, preference);
      await refresh();
    } catch (e) {
      setError(messageFor(e));
    }
  }

  return (
    <section data-testid="settings-skills" style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0 }}>Skills</h1>
        <div data-testid="skills-tag-summary" style={{ color: "var(--fg-muted)" }}>
          Active: <strong data-testid="skills-active-tag">{activeTag ?? "none"}</strong>
          {upstreamTag && upstreamTag !== activeTag && (
            <>
              {" "}- Upstream latest:{" "}
              <strong data-testid="skills-upstream-tag">{upstreamTag}</strong>
            </>
          )}
        </div>
      </header>

      <div role="alert" aria-live="polite" style={{ minHeight: "1.5em", color: "var(--accent-warning, #d97706)" }}>
        {error ?? ""}
      </div>

      <div style={controlsRowStyle}>
        <button
          type="button"
          data-testid="skills-sync-now"
          onClick={handleSyncNow}
          disabled={syncing}
        >
          {syncing ? "Syncing..." : "Sync now"}
        </button>
        <label data-testid="skills-auto-sync-label" style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)" }}>
          <input
            type="checkbox"
            data-testid="skills-auto-sync"
            checked={autoSync}
            onChange={(e) => void handleAutoSyncToggle(e.target.checked)}
          />
          Auto-sync weekly (idle time)
        </label>
        {syncStatus && (
          <span data-testid="skills-sync-status" style={{ color: "var(--fg-muted)" }}>
            {syncStatus}
          </span>
        )}
      </div>

      {loading ? (
        <p data-testid="skills-loading">Loading skills...</p>
      ) : (
        <>
          {grouped.quarantined.length > 0 && (
            <Section
              title="Quarantined"
              testId="section-quarantined"
              accent="warning"
              items={grouped.quarantined}
              renderRow={(item) => (
                <QuarantineRow
                  item={item}
                  onApprove={() => void handleApprove(item.id)}
                />
              )}
            />
          )}
          <Section
            title="DevAI-Hub"
            testId="section-devai-hub"
            items={grouped["devai-hub"]}
            renderRow={(item) => (
              <StandardRow
                item={item}
                onToggleActive={() => void handleToggleActive(item)}
                onDivergedPreference={(p) => void handleDivergedPreference(item, p)}
              />
            )}
          />
          <Section
            title="User"
            testId="section-user"
            items={grouped.user}
            renderRow={(item) => (
              <StandardRow
                item={item}
                onToggleActive={() => void handleToggleActive(item)}
                onDivergedPreference={(p) => void handleDivergedPreference(item, p)}
              />
            )}
          />
          <Section
            title="Built-in"
            testId="section-builtin"
            items={grouped.builtin}
            renderRow={(item) => (
              <StandardRow
                item={item}
                onToggleActive={() => void handleToggleActive(item)}
                onDivergedPreference={(p) => void handleDivergedPreference(item, p)}
              />
            )}
          />
        </>
      )}
    </section>
  );
}

interface SectionProps {
  title: string;
  testId: string;
  items: readonly SkillRowDto[];
  renderRow: (item: SkillRowDto) => JSX.Element;
  accent?: "warning";
}

function Section({ title, testId, items, renderRow, accent }: SectionProps): JSX.Element {
  return (
    <section data-testid={testId} style={sectionStyle}>
      <h2 style={{ margin: "0 0 var(--space-2, 8px)", color: accent === "warning" ? "var(--accent-warning, #d97706)" : undefined }}>
        {title} <span data-testid={`${testId}-count`} style={{ color: "var(--fg-muted)" }}>({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p style={{ color: "var(--fg-muted)" }}>No skills in this section.</p>
      ) : (
        <ul style={listStyle}>
          {items.map((m) => (
            <li key={m.id} data-testid={`skills-row-${m.id}`} style={rowStyle}>
              {renderRow(m)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface StandardRowProps {
  item: SkillRowDto;
  onToggleActive: () => void;
  onDivergedPreference: (preference: "user" | "devai-hub") => void;
}

function StandardRow({ item, onToggleActive, onDivergedPreference }: StandardRowProps): JSX.Element {
  return (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {item.displayName}
          {item.diverged && (
            <span
              data-testid={`skills-diverged-${item.id}`}
              title="A skill with this display name exists in another source"
              style={badgeStyle}
            >
              diverged
            </span>
          )}
        </div>
        <div style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
          {item.id}
          {item.provenance.tag ? ` - ${item.provenance.tag}` : ""}
          {item.provenance.source === "devai-hub" ? " - upstream" : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-2, 8px)", alignItems: "center" }}>
        {item.diverged && item.provenance.source !== "builtin" && (
          <button
            type="button"
            data-testid={`skills-set-default-${item.id}`}
            onClick={() =>
              onDivergedPreference(item.provenance.source === "devai-hub" ? "devai-hub" : "user")
            }
          >
            Use as default
          </button>
        )}
        <button
          type="button"
          data-testid={`skills-toggle-${item.id}`}
          onClick={onToggleActive}
        >
          {item.active ? "Disable" : "Enable"}
        </button>
      </div>
    </>
  );
}

interface QuarantineRowProps {
  item: SkillRowDto;
  onApprove: () => void;
}

function QuarantineRow({ item, onApprove }: QuarantineRowProps): JSX.Element {
  const findings = item.quarantine?.findings ?? [];
  return (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{item.displayName}</div>
        <div style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
          {item.id} - {findings.length} finding(s)
        </div>
        {findings.slice(0, 3).map((f, idx) => (
          <div
            key={`${f.ruleId}-${idx}`}
            data-testid={`skills-quarantine-finding-${item.id}-${idx}`}
            style={{ fontSize: "0.8em", color: "var(--accent-warning, #d97706)" }}
          >
            [{f.severity}] {f.ruleId}: {f.message}
          </div>
        ))}
      </div>
      <button
        type="button"
        data-testid={`skills-approve-${item.id}`}
        onClick={onApprove}
      >
        Review and approve
      </button>
    </>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4, 16px)",
  padding: "var(--space-6, 24px)",
  color: "var(--fg-0)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--space-4, 16px)",
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-3, 12px)",
  alignItems: "center",
  flexWrap: "wrap",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3, 12px)",
  padding: "var(--space-2, 8px) var(--space-3, 12px)",
  border: "1px solid var(--border-1, #2a2a2a)",
  borderRadius: "var(--radius-2, 6px)",
  background: "var(--bg-1, transparent)",
};

const badgeStyle: React.CSSProperties = {
  marginLeft: "var(--space-2, 8px)",
  padding: "2px 6px",
  borderRadius: "999px",
  fontSize: "0.7em",
  fontWeight: 600,
  background: "var(--accent-warning, #d97706)",
  color: "#fff",
};
