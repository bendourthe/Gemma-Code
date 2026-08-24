/**
 * v2.2.2 Phase 1 -- in-app ready gate.
 *
 * "Backend and models are loaded" means the sidecar is running and
 * `models.list` has returned (catalog known, including empty). It does not
 * pull weights into VRAM.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ipcCall } from "./ipc";
import {
  fetchSidecarStatus,
  isBackendDownMessage,
  restartSidecar,
  type SidecarStatus,
} from "./sidecarStatus";

export type ReadyPhase = "backend" | "catalog" | "ready" | "failed";

export interface UseReadyGate {
  phase: ReadyPhase;
  status: SidecarStatus | null;
  restarting: boolean;
  restartError: string | null;
  restart: () => Promise<void>;
}

export interface UseReadyGateOptions {
  timeoutMs?: number;
  pollMs?: number;
  fetchStatus?: () => Promise<SidecarStatus | null>;
  listCatalog?: () => Promise<boolean>;
  restartFn?: () => Promise<{ ok: true; status: SidecarStatus } | { ok: false; message: string }>;
}

/** Sidecar spawn is sub-second when healthy; catalog list is a JSON-RPC round-trip. */
export const READY_GATE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 250;

export async function defaultListCatalog(): Promise<boolean> {
  const reply = await ipcCall<{ models?: unknown[] }>("models.list", {});
  if (reply.ok) return true;
  if (!isBackendDownMessage(reply.message)) {
    // ipc-unavailable (dev / Vitest) is not a sidecar failure.
    return reply.message === "ipc-unavailable";
  }
  return false;
}

export function useReadyGate(options: UseReadyGateOptions = {}): UseReadyGate {
  const {
    timeoutMs = READY_GATE_TIMEOUT_MS,
    pollMs = DEFAULT_POLL_MS,
    fetchStatus = fetchSidecarStatus,
    listCatalog = defaultListCatalog,
    restartFn = restartSidecar,
  } = options;

  const [phase, setPhase] = useState<ReadyPhase>("backend");
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);

  const fetchStatusRef = useRef(fetchStatus);
  fetchStatusRef.current = fetchStatus;
  const listCatalogRef = useRef(listCatalog);
  listCatalogRef.current = listCatalog;
  const restartFnRef = useRef(restartFn);
  restartFnRef.current = restartFn;

  const runGate = useCallback(
    async (gen: number): Promise<void> => {
      const started = Date.now();
      let sawCatalogCopy = false;

      while (mounted.current && gen === generation.current) {
        const next = await fetchStatusRef.current();
        if (!mounted.current || gen !== generation.current) return;
        setStatus(next);

        if (next === null) {
          // Outside Tauri (dev server, Vitest): not a sidecar failure.
          setPhase("ready");
          return;
        }

        if (!next.running) {
          if (next.failure || Date.now() - started >= timeoutMs) {
            setPhase("failed");
            return;
          }
          setPhase("backend");
          await sleep(pollMs);
          continue;
        }

        if (!sawCatalogCopy) {
          sawCatalogCopy = true;
          setPhase("catalog");
        }
        const listed = await listCatalogRef.current();
        if (!mounted.current || gen !== generation.current) return;
        if (listed) {
          setPhase("ready");
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          setPhase("failed");
          return;
        }
        await sleep(pollMs);
      }
    },
    [pollMs, timeoutMs],
  );

  useEffect(() => {
    mounted.current = true;
    const gen = ++generation.current;
    void runGate(gen);
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [runGate]);

  const restart = useCallback(async () => {
    if (!mounted.current) return;
    setRestarting(true);
    setRestartError(null);
    setPhase("backend");
    try {
      const result = await restartFnRef.current();
      if (!mounted.current) return;
      if (!result.ok) {
        setRestartError(result.message);
        setPhase("failed");
        return;
      }
      setStatus(result.status);
      const gen = ++generation.current;
      await runGate(gen);
    } finally {
      if (mounted.current) setRestarting(false);
    }
  }, [runGate]);

  return { phase, status, restarting, restartError, restart };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
