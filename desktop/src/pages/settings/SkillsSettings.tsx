/**
 * v1.0.0 Phase 10.4 + 10.6 -- Settings > Skills page.
 *
 * Surfaces the Nexus-Hub sync surface and the per-skill enable/disable
 * controls. The page is provider-driven: callers inject a `SkillsClient`
 * so tests (and the eventual IPC wiring) can swap the real disk-backed
 * `SkillCatalog` + `NexusHubSyncer` for an in-memory fake.
 *
 * Sections:
 *   - Header: active tag, upstream-latest tag, "Sync now" + "Auto-sync
 *     weekly" toggle.
 *   - Quarantined: skills the prompt-injection scanner flagged at `high`
 *     severity; rendered separately with a "Review and approve" action.
 *
 * v2.2.9 Phase 6 (T012): Hub tags are normalized (`hubTags.ts`) before every
 * compare and display, so Active `3.21.0` never implies an update to upstream
 * `v3.21.0`. The Sync now + auto-update row is the first control under the
 * Active/Upstream lines. While syncing, a small Phase 2 `AgentStateOrb` plus
 * staged status copy replace the frozen label; the stages are derived only
 * from observables (the load-time upstream tag and the single sync RPC
 * result), never from fabricated progress.
 *   - Per-namespace lists: `builtin`, `user`, `nexus-hub`. Each row shows
 *     the namespaced id, the source tag (when nexus-hub), and a small
 *     `diverged` badge for names that exist in more than one namespace
 *     (Phase 10.6).
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Switch } from "../../components/ui";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { AgentStateOrb } from "../../components/agentState/AgentStateOrb";
import { isBackendDownMessage, useSidecarStatus } from "../../lib/sidecarStatus";
import { displayHubTag, hubTagsEqual } from "../../lib/hubTags";

import type { SkillRecord, SkillNamespace } from "../../../../core/skills/SkillCatalog";
import type { ScanResult } from "../../../../core/skills/PromptInjectionScanner";

export type SkillRowDto = SkillRecord & {
  /** When the scanner blocked this skill, the latest scan result. */
  quarantine?: ScanResult;
};

export interface SkillsSettingsClient {
  list(): Promise<readonly SkillRowDto[]>;
  /** Returns the currently-active Nexus-Hub tag (null when nothing synced). */
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
  setDivergedPreference?(displayName: string, preference: "user" | "nexus-hub"): Promise<void>;
}

export interface SkillsSettingsProps {
  client: SkillsSettingsClient;
}

/**
 * Delay before the staged sync status flips from "New version found" to
 * "Installing version X now". Both statements are already true when the
 * apply-RPC is dispatched (the upstream tag was observed at load time and the
 * RPC installs); the beat only makes the first stage readable. Exported for
 * fake-timer tests.
 */
export const SYNC_STAGE_INSTALLING_DELAY_MS = 700;

export function SkillsSettings({ client }: SkillsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly SkillRowDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [upstreamTag, setUpstreamTag] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  // v2.2.0 Phase 2 (2.2): "not yet synced" used to render whenever the IPC
  // call failed, telling the user to press a Sync button that the same dead
  // backend would have to service. Branch the backend-down case out.
  const sidecar = useSidecarStatus();
  const backendDown = sidecar.isDown || isBackendDownMessage(error);

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
      "nexus-hub": [],
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
    // Staged status, derived from observables only. The sidecar sync is one
    // RPC with no progress events, so the honest stages are: (a) the upstream
    // tag fetched at load time already proves a newer version exists ("New
    // version found", then "Installing ... now" while that apply-RPC runs),
    // or (b) nothing newer is known, so the RPC is "Checking for updates...".
    // The up-to-date claim is only made from the RPC result, never before.
    const newerKnown =
      activeTag !== null && upstreamTag !== null && !hubTagsEqual(activeTag, upstreamTag);
    let stageTimer: number | null = null;
    if (newerKnown) {
      const installTag = displayHubTag(upstreamTag) ?? upstreamTag;
      setSyncStatus("New version found");
      stageTimer = window.setTimeout(() => {
        setSyncStatus(`Installing version ${installTag} now`);
      }, SYNC_STAGE_INSTALLING_DELAY_MS);
    } else {
      setSyncStatus("Checking for updates...");
    }
    try {
      const result = await client.syncNow();
      if (stageTimer !== null) {
        window.clearTimeout(stageTimer);
        stageTimer = null;
      }
      const resultTag = displayHubTag(result.tag) ?? result.tag;
      // applied => the catalog swap finished; already-up-to-date returns
      // applied=false with the tag we are on. Anything else did not install.
      setSyncStatus(
        result.applied || hubTagsEqual(result.tag, activeTag)
          ? `Harness up-to-date with Nexus-Hub version ${resultTag} (${result.summary})`
          : `Sync blocked: ${result.summary}`,
      );
      await refresh();
    } catch (e) {
      const msg = messageFor(e);
      setSyncStatus("Sync blocked");
      setError(
        /sidecar response timeout/i.test(msg)
          ? "Hub fetch did not finish. Check the network and retry Update now. The sidecar is still running."
          : msg,
      );
    } finally {
      if (stageTimer !== null) window.clearTimeout(stageTimer);
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
    preference: "user" | "nexus-hub",
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
          Active: <strong data-testid="skills-active-tag">{displayHubTag(activeTag) ?? "none"}</strong>
          {/* Normalized compare: `3.21.0` and `v3.21.0` are the same release,
              so the header must not imply an update when they match. */}
          {upstreamTag && !hubTagsEqual(upstreamTag, activeTag) && (
            <>
              {" "}- Upstream latest:{" "}
              <strong data-testid="skills-upstream-tag">{displayHubTag(upstreamTag)}</strong>
            </>
          )}
        </div>
      </header>

      {/* v2.2.9 T012: Sync now + auto-update is the FIRST control on the page,
          directly under the Active / Upstream lines. */}
      <div data-testid="skills-controls-row" style={controlsRowStyle}>
        <Button
          type="button"
          testId="skills-sync-now"
          onClick={handleSyncNow}
          disabled={syncing}
          busy={syncing}
        >
          {syncing ? "Syncing..." : "Sync now"}
        </Button>
        <Switch
          testId="skills-auto-sync"
          checked={autoSync}
          onChange={(next) => void handleAutoSyncToggle(next)}
          label="Auto-update to latest Nexus-Hub release"
        />
        {syncing && (
          <AgentStateOrb
            activity="model-loading"
            size="inline"
            accessibleName="Syncing Nexus-Hub"
            data-testid="skills-sync-orb"
          />
        )}
        {syncStatus && (
          <span data-testid="skills-sync-status" style={{ color: "var(--fg-muted)" }}>
            {syncStatus}
          </span>
        )}
      </div>

      {backendDown && (
        <SidecarDownBanner
          status={sidecar.status}
          restarting={sidecar.restarting}
          restartError={sidecar.restartError}
          onRestart={() => void sidecar.restart()}
          context="The Nexus-Hub catalog cannot be read or synced."
          testId="skills-sidecar-down"
        />
      )}
      {!loading && !backendDown && activeTag === null && (
        <div data-testid="skills-not-synced" style={bannerStyle}>
          The Nexus-Hub catalog is not yet synced.{" "}
          <Button
            type="button"
            testId="skills-sync-empty"
            onClick={handleSyncNow}
            disabled={syncing}
            busy={syncing}
          >
            {syncing ? "Syncing..." : "Sync now"}
          </Button>
        </div>
      )}
      {!loading && activeTag !== null && upstreamTag !== null && !hubTagsEqual(upstreamTag, activeTag) && (
        <div data-testid="skills-update-available" style={bannerStyle}>
          Update available: {displayHubTag(activeTag)} to {displayHubTag(upstreamTag)}.{" "}
          <Button
            type="button"
            testId="skills-update-now"
            onClick={handleSyncNow}
            disabled={syncing}
            busy={syncing}
          >
            {syncing ? "Updating..." : "Update now"}
          </Button>
        </div>
      )}

      <div role="alert" aria-live="polite" style={{ minHeight: "1.5em", color: "var(--accent-warning, #d97706)" }}>
        {error ?? ""}
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
              description={
                "A quarantined skill is not enabled: the prompt-injection scanner " +
                "found a high-severity pattern in its files, so the sync blocked it " +
                "instead of activating it. Review and approve is an explicit trust " +
                "decision to enable the skill despite the finding below."
              }
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
            title="Nexus-Hub"
            testId="section-nexus-hub"
            items={grouped["nexus-hub"]}
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
  /** Explanatory copy under the heading (v2.2.9 6.2: quarantine rationale). */
  description?: string;
}

function Section({ title, testId, items, renderRow, accent, description }: SectionProps): JSX.Element {
  return (
    <section data-testid={testId} style={sectionStyle}>
      <h2 style={{ margin: "0 0 var(--space-2, 8px)", color: accent === "warning" ? "var(--accent-warning, #d97706)" : undefined }}>
        {title} <span data-testid={`${testId}-count`} style={{ color: "var(--fg-muted)" }}>({items.length})</span>
      </h2>
      {description && (
        <p data-testid={`${testId}-description`} style={{ margin: 0, color: "var(--fg-muted)", fontSize: "0.9em" }}>
          {description}
        </p>
      )}
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
  onDivergedPreference: (preference: "user" | "nexus-hub") => void;
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
          {item.provenance.source === "nexus-hub" ? " - upstream" : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-2, 8px)", alignItems: "center" }}>
        {item.diverged && item.provenance.source !== "builtin" && (
          <Button
            type="button"
            testId={`skills-set-default-${item.id}`}
            onClick={() =>
              onDivergedPreference(item.provenance.source === "nexus-hub" ? "nexus-hub" : "user")
            }
          >
            Use as default
          </Button>
        )}
        <Button
          type="button"
          testId={`skills-toggle-${item.id}`}
          onClick={onToggleActive}
        >
          {item.active ? "Disable" : "Enable"}
        </Button>
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
      <Button
        type="button"
        testId={`skills-approve-${item.id}`}
        onClick={onApprove}
      >
        Review and approve
      </Button>
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

const bannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2, 8px)",
  padding: "var(--space-2, 8px) var(--space-3, 12px)",
  borderRadius: "var(--radius-2, 6px)",
  border: "1px solid var(--accent-primary, #6366f1)",
  background: "var(--bg-1, transparent)",
  color: "var(--fg-0)",
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
