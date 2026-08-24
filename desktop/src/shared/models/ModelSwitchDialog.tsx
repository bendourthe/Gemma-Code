/**
 * v2.2.0 Phase 4 (4.3) -- the one dialog that interrupts the user.
 *
 * Shown ONLY when a model must be evicted while another module is busy, or
 * when free VRAM cannot be read. Every other outcome (already resident, both
 * models fit, GPU idle) resolves silently with a status chip, because asking
 * about work the machine can simply do is how a policy becomes noise the user
 * clicks through without reading.
 *
 * Copy names the concrete models and what is using the GPU, so the choice is
 * informed rather than a generic "are you sure".
 */

import { useEffect, useState } from "react";

import type { PendingSwitch, SwitchResolution } from "./useModelResidency";

export interface ModelSwitchDialogProps {
  pending: PendingSwitch;
  onResolve: (resolution: SwitchResolution) => void;
  /** Called when the dialog expires unanswered. */
  onExpire: () => void;
  now?: () => number;
  testId?: string;
}

function moduleLabel(id: string): string {
  switch (id) {
    case "coding":
      return "an agentic coding task";
    case "chat":
      return "a chat session";
    case "image":
      return "an image generation";
    case "video":
      return "a video generation";
    case "tuning":
      return "a fine-tuning run";
    default:
      return id;
  }
}

export function ModelSwitchDialog({
  pending,
  onResolve,
  onExpire,
  now = () => Date.now(),
  testId = "model-switch-dialog",
}: ModelSwitchDialogProps): JSX.Element {
  const [remember, setRemember] = useState(false);

  // An ignored dialog must not hold a queue slot open forever.
  useEffect(() => {
    const remaining = Math.max(0, pending.expiresAt - now());
    const timer = setTimeout(onExpire, remaining);
    return () => clearTimeout(timer);
  }, [pending.expiresAt, onExpire, now]);

  const target = pending.request.targetModelId;
  const busy = pending.verdict.busyWith;
  const vramUnknown = pending.verdict.reason === "vram-unknown";

  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label="Model switch confirmation"
      style={{
        border: "1px solid var(--border-strong, #444)",
        borderRadius: "var(--radius-lg, 10px)",
        background: "var(--bg-elevated, #1b1b1b)",
        padding: "var(--space-5, 16px)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3, 8px)",
        maxWidth: "34rem",
      }}
    >
      <strong>Load a different model?</strong>
      <span style={{ color: "var(--fg-1, #ccc)" }}>
        {vramUnknown ? (
          <>
            This needs <code>{target}</code>, but Nexus cannot read how much GPU memory is
            free right now, so it cannot tell whether both models fit. Loading it may
            unload what is already running.
          </>
        ) : (
          <>
            This needs <code>{target}</code>, and there is not enough GPU memory to keep
            both loaded.{" "}
            {busy ? (
              <>
                <code>{busy.modelId ?? "The current model"}</code> is busy with{" "}
                {moduleLabel(busy.moduleId)} and would be unloaded.
              </>
            ) : (
              <>The currently loaded model would be unloaded.</>
            )}
          </>
        )}
      </span>

      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 6px)" }}>
        <input
          type="checkbox"
          data-testid={`${testId}-remember`}
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>Remember for this session</span>
      </label>

      <div style={{ display: "flex", gap: "var(--space-2, 6px)", flexWrap: "wrap" }}>
        <button
          type="button"
          data-testid={`${testId}-switch`}
          onClick={() => onResolve({ action: "switch", remember })}
        >
          Switch now
        </button>
        <button
          type="button"
          data-testid={`${testId}-queue`}
          onClick={() => onResolve({ action: "queue" })}
        >
          Queue after the current job
        </button>
        <button
          type="button"
          data-testid={`${testId}-keep`}
          onClick={() => onResolve({ action: "keep" })}
        >
          Keep the current model
        </button>
      </div>
    </div>
  );
}

export interface ModelSwitchChipProps {
  switching: { from: readonly string[]; to: string; startedAt: number } | null;
  now?: () => number;
  testId?: string;
}

/**
 * The non-interrupting counterpart: a single coalesced chip for auto-switches
 * and co-residency. Rapid successive switches update this one element rather
 * than stacking toasts.
 */
export function ModelSwitchChip({
  switching,
  now = () => Date.now(),
  testId = "model-switch-chip",
}: ModelSwitchChipProps): JSX.Element | null {
  if (!switching) return null;
  const elapsedS = Math.max(0, Math.round((now() - switching.startedAt) / 1000));
  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2, 6px)",
        padding: "var(--space-1, 4px) var(--space-3, 8px)",
        borderRadius: "var(--radius-pill, 999px)",
        background: "var(--bg-2, #222)",
        color: "var(--fg-muted, #999)",
        fontSize: "var(--text-xs, 12px)",
      }}
    >
      Loading {switching.to}
      {elapsedS >= 3 ? ` (${elapsedS}s)` : ""}
    </div>
  );
}
