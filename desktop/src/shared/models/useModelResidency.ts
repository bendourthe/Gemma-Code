/**
 * v2.2.0 Phase 4 (4.3) -- residency + switch state for the UI.
 *
 * One hook owns the answers every surface needs: what is loaded, is a switch
 * in flight, what did the user already agree to this session. Keeping the
 * "remembered" set here (rather than per-page) is what makes "remember for
 * this session" actually work across surfaces: the user answers once in Image
 * Studio and Video Lab honors it too.
 *
 * The remembered set is deliberately session-scoped and in-memory. Persisting
 * it would mean a choice made once silently governs every future launch, which
 * is exactly the kind of invisible consent this phase is trying to avoid.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  classifySwitch,
  reclassifyOnConfirm,
  rememberKey,
  type GpuModuleId,
  type ModelResidency,
  type SwitchRequest,
  type SwitchVerdict,
} from "../../../../core/scheduler/ModelSwitchPolicy";

/** A pending confirm, surfaced as a dialog. */
export interface PendingSwitch {
  readonly request: SwitchRequest;
  readonly verdict: Extract<SwitchVerdict, { kind: "confirm" }>;
  readonly expiresAt: number;
}

export type SwitchResolution =
  | { action: "switch"; remember: boolean }
  | { action: "queue" }
  | { action: "keep" };

export interface SwitchingState {
  readonly from: readonly string[];
  readonly to: string;
  readonly startedAt: number;
}

/** Dialogs left unanswered expire rather than pinning a queue slot forever. */
export const CONFIRM_EXPIRY_MS = 60_000;

export interface UseModelResidency {
  readonly resident: readonly ModelResidency[];
  readonly switching: SwitchingState | null;
  readonly pending: PendingSwitch | null;
  /**
   * Classify a request. Returns the verdict; when it is `confirm`, the dialog
   * state is set and the caller should await `resolvePending`.
   */
  request(input: SwitchRequest): SwitchVerdict;
  /** Answer the open dialog. Re-classifies first, so a stale warning cannot act. */
  resolvePending(resolution: SwitchResolution): SwitchVerdict | null;
  /** Drop an unanswered dialog (expiry or dismissal). */
  dismissPending(): void;
  setResident(next: readonly ModelResidency[]): void;
  beginSwitch(state: SwitchingState): void;
  endSwitch(): void;
  /** True when the user has silenced this pair for the session. */
  isRemembered(module: GpuModuleId, busy: GpuModuleId | null, modelId: string): boolean;
}

export interface UseModelResidencyOptions {
  readonly initialResident?: readonly ModelResidency[];
  readonly now?: () => number;
}

export function useModelResidency(
  options: UseModelResidencyOptions = {},
): UseModelResidency {
  const now = options.now ?? (() => Date.now());
  const [resident, setResident] = useState<readonly ModelResidency[]>(
    options.initialResident ?? [],
  );
  const [switching, setSwitching] = useState<SwitchingState | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  // A ref, not state: consenting must take effect for the very next
  // classification, without waiting for a re-render.
  const remembered = useRef<Set<string>>(new Set());

  const request = useCallback(
    (input: SwitchRequest): SwitchVerdict => {
      const withMemory: SwitchRequest = {
        ...input,
        rememberedPairs: remembered.current,
      };
      const verdict = classifySwitch(withMemory);
      if (verdict.kind === "confirm") {
        setPending({
          request: withMemory,
          verdict,
          expiresAt: now() + CONFIRM_EXPIRY_MS,
        });
      }
      return verdict;
    },
    [now],
  );

  const resolvePending = useCallback(
    (resolution: SwitchResolution): SwitchVerdict | null => {
      const open = pending;
      setPending(null);
      if (!open) return null;
      if (resolution.action === "keep") return null;
      if (resolution.action === "queue") {
        // The caller enqueues behind the running job; residency is unchanged
        // now, so there is no verdict to act on immediately.
        return null;
      }
      if (resolution.remember) {
        remembered.current.add(
          rememberKey(
            open.request.requestingModule,
            open.verdict.busyWith?.moduleId ?? null,
            open.request.targetModelId,
          ),
        );
      }
      // Re-classify: the job that triggered the warning may have finished
      // while the dialog was open, in which case this is now a plain
      // auto-switch rather than an eviction the user was warned about.
      return reclassifyOnConfirm({
        ...open.request,
        rememberedPairs: remembered.current,
      });
    },
    [pending],
  );

  const dismissPending = useCallback(() => setPending(null), []);
  const beginSwitch = useCallback((state: SwitchingState) => setSwitching(state), []);
  const endSwitch = useCallback(() => setSwitching(null), []);
  const isRemembered = useCallback(
    (module: GpuModuleId, busy: GpuModuleId | null, modelId: string) =>
      remembered.current.has(rememberKey(module, busy, modelId)),
    [],
  );

  return useMemo(
    () => ({
      resident,
      switching,
      pending,
      request,
      resolvePending,
      dismissPending,
      setResident,
      beginSwitch,
      endSwitch,
      isRemembered,
    }),
    [
      resident,
      switching,
      pending,
      request,
      resolvePending,
      dismissPending,
      beginSwitch,
      endSwitch,
      isRemembered,
    ],
  );
}
