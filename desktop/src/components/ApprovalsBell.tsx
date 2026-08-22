/**
 * v2.2.0 Phase 6 (6.3) -- approvals as a bell, not a nav tab.
 *
 * The Ask Inbox parks CONFIRM/DANGEROUS tool calls from headless and scheduled
 * runs, so it is load-bearing -- but it is empty most of the time, and a
 * permanent sidebar tab for an empty surface is what made the user ask what it
 * was even for. A bell with a badge keeps it one click away and visually quiet
 * when there is nothing to do.
 *
 * Approval semantics are unchanged: nothing is ever auto-approved, and an
 * approval that arrives after a sidecar restart still fails safe upstream.
 */

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";

import type { AskInboxClient, ParkedAskDto } from "../pages/inbox/askInboxTypes";

export interface ApprovalsBellProps {
  pendingCount: number;
  compact: boolean;
  client?: AskInboxClient;
  testId?: string;
}

export function ApprovalsBell({
  pendingCount,
  compact,
  client,
  testId = "approvals-bell",
}: ApprovalsBellProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly ParkedAskDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) {
      setItems([]);
      return;
    }
    try {
      setItems(await client.list("pending"));
      setError(null);
    } catch (err) {
      // A failed fetch must not render as "nothing pending" -- that is a
      // fake all-clear on a surface whose whole job is to not miss things.
      setItems(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const act = useCallback(
    async (id: string, action: "approve" | "deny") => {
      if (!client) return;
      setBusy(id);
      try {
        await (action === "approve" ? client.approve(id) : client.deny(id));
        // Re-read rather than mutating locally: an ask may have expired while
        // the popover was open, and acting on a stale row is exactly what the
        // refresh prevents.
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [client, refresh],
  );

  const hasPending = pendingCount > 0;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        data-testid={testId}
        aria-label={
          hasPending ? `Approvals: ${pendingCount} pending` : "Approvals: nothing pending"
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: compact ? "center" : "flex-start",
          gap: compact ? 0 : "var(--space-3)",
          padding: compact ? "var(--space-2)" : "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-md)",
          background: "transparent",
          border: "none",
          color: hasPending ? "var(--fg-0)" : "var(--fg-muted)",
          cursor: "pointer",
          fontSize: "var(--text-sm)",
          position: "relative",
        }}
      >
        <Bell size={18} aria-hidden />
        {!compact && <span>Approvals</span>}
        {hasPending ? (
          <span
            data-testid={`${testId}-badge`}
            style={{
              position: compact ? "absolute" : "static",
              top: compact ? 2 : undefined,
              right: compact ? 6 : undefined,
              marginLeft: compact ? undefined : "auto",
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: "var(--status-err)",
              color: "var(--fg-0)",
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            {pendingCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          data-testid={`${testId}-popover`}
          role="dialog"
          aria-label="Pending approvals"
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            zIndex: 40,
            width: "20rem",
            maxHeight: "18rem",
            overflowY: "auto",
            padding: "var(--space-3)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-elevated)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <strong style={{ fontSize: "var(--text-sm)" }}>Pending approvals</strong>
          {error !== null ? (
            <span data-testid={`${testId}-error`} style={{ color: "var(--status-err)" }}>
              Could not read approvals: {error}
            </span>
          ) : items === null ? (
            <span style={{ color: "var(--fg-muted)" }}>Loading...</span>
          ) : items.length === 0 ? (
            <span data-testid={`${testId}-empty`} style={{ color: "var(--fg-muted)" }}>
              Nothing waiting. Headless runs park approvals here.
            </span>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                data-testid={`${testId}-item-${item.id}`}
                style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
              >
                <span style={{ fontSize: "var(--text-sm)" }}>{item.toolName}</span>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button
                    type="button"
                    data-testid={`${testId}-approve-${item.id}`}
                    disabled={busy === item.id}
                    onClick={() => void act(item.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    data-testid={`${testId}-deny-${item.id}`}
                    disabled={busy === item.id}
                    onClick={() => void act(item.id, "deny")}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
