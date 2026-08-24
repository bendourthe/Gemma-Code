/**
 * v1.18.0 Phase 4 (OW-A1, OW-A2) -- ask-inbox panel.
 *
 * Lists parked headless/scheduled approvals, approve/deny, history, and the
 * morning-brief schedule toggle. Approval IPC replays through the gate.
 */

import { useCallback, useEffect, useState } from "react";

import type { AskInboxClient, ParkedAskDto, ScheduledRunDto } from "./askInboxTypes";

const TIER_LABEL = ["AUTO_APPROVE", "CONFIRM", "DANGEROUS"] as const;

export interface AskInboxPanelProps {
  client: AskInboxClient;
  now?: () => number;
}

function ageLabel(createdAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function AskInboxPanel({ client, now = Date.now }: AskInboxPanelProps): JSX.Element {
  const [asks, setAsks] = useState<readonly ParkedAskDto[]>([]);
  const [schedules, setSchedules] = useState<readonly ScheduledRunDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, sched] = await Promise.all([client.list(), client.listSchedules()]);
      setAsks(list);
      setSchedules(sched);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pending = asks.filter((a) => a.state === "pending");
  const history = asks.filter((a) => a.state !== "pending");

  const onApprove = async (id: string) => {
    setBusy(`approve:${id}`);
    try {
      const result = await client.approve(id);
      if (!result.ok) setError(result.reason);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onDeny = async (id: string) => {
    setBusy(`deny:${id}`);
    try {
      const result = await client.deny(id);
      if (!result.ok) setError(result.reason);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onToggleSchedule = async (id: string, enabled: boolean) => {
    setBusy(`sched:${id}`);
    try {
      await client.setScheduleEnabled(id, enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      data-testid="ask-inbox-panel"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Ask inbox</h1>
        <p style={{ color: "var(--fg-muted)", margin: "8px 0 0" }}>
          Headless and scheduled runs park CONFIRM and DANGEROUS tools here. Approve
          replays the permission gate; deny and expiry refuse cleanly. Interactive
          prompts are unchanged.
        </p>
        <p data-testid="ask-inbox-pending-count" style={{ margin: "8px 0 0" }}>
          {pending.length} pending
        </p>
      </header>

      {error ? (
        <p data-testid="ask-inbox-error" role="alert" style={{ color: "var(--accent-danger, #f55)" }}>
          {error}
        </p>
      ) : null}

      <section>
        <h2 style={{ fontSize: "var(--text-md)", margin: "0 0 8px" }}>Pending</h2>
        {pending.length === 0 ? (
          <p data-testid="ask-inbox-empty" style={{ color: "var(--fg-muted)" }}>
            No parked approvals.
          </p>
        ) : (
          <ul data-testid="ask-inbox-pending-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {pending.map((ask) => (
              <li
                key={ask.id}
                data-testid={`ask-inbox-item-${ask.id}`}
                style={{
                  border: "1px solid var(--border-1)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3)",
                  marginBottom: "var(--space-3)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{ask.toolName}</div>
                <div style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
                  {ask.summary}
                </div>
                <div data-testid={`ask-inbox-meta-${ask.id}`} style={{ fontSize: "var(--text-sm)", marginTop: 8 }}>
                  {TIER_LABEL[ask.parkedTier] ?? `tier ${ask.parkedTier}`} · {ask.risk} · {ask.runMode} ·{" "}
                  {ask.runId} · {ageLabel(ask.createdAt, now())}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    data-testid={`ask-inbox-approve-${ask.id}`}
                    disabled={busy !== null}
                    onClick={() => void onApprove(ask.id)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    data-testid={`ask-inbox-deny-${ask.id}`}
                    disabled={busy !== null}
                    onClick={() => void onDeny(ask.id)}
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-md)", margin: "0 0 8px" }}>History</h2>
        {history.length === 0 ? (
          <p data-testid="ask-inbox-history-empty" style={{ color: "var(--fg-muted)" }}>
            No resolved asks yet.
          </p>
        ) : (
          <ul data-testid="ask-inbox-history-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((ask) => (
              <li key={ask.id} data-testid={`ask-inbox-history-${ask.id}`}>
                {ask.toolName} · {ask.state}
                {ask.decisionReason ? ` · ${ask.decisionReason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-md)", margin: "0 0 8px" }}>Schedules</h2>
        <p style={{ color: "var(--fg-muted)", marginTop: 0, fontSize: "var(--text-sm)" }}>
          Morning brief content comes from the Hub agent-presets morning-briefing
          preset. Enabling a schedule never auto-approves tools.
        </p>
        {schedules.map((schedule) => (
          <label
            key={schedule.id}
            data-testid={`ask-scheduler-${schedule.id}`}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              type="checkbox"
              data-testid={`ask-scheduler-enabled-${schedule.id}`}
              checked={schedule.enabled}
              disabled={busy !== null}
              onChange={(e) => void onToggleSchedule(schedule.id, e.target.checked)}
            />
            {schedule.name}
            {schedule.promptSource ? ` (${schedule.promptSource})` : ""}
          </label>
        ))}
      </section>
    </section>
  );
}
