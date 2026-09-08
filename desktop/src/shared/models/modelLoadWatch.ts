/**
 * v2.4.8 follow-up (2026-09-07) -- is the chat model loaded yet, and how far?
 *
 * Ollama loads a model on its first request and offers no load-progress API,
 * so the desktop showed "Thinking" while nothing was being thought. Two
 * signals make the wait honest: `models.resident` (Ollama's `/api/ps`, which
 * lists a model once it is loaded) and `gpu.sample` (free VRAM, which drops
 * as the weights arrive). The hook polls both while `active` and reports
 * `loading` until the model is resident, with a percent estimated from the
 * VRAM claimed since the watch began against the model's known footprint.
 */

import { useEffect, useRef, useState } from "react";
import { ipcCall } from "../../lib/ipc";
import { foldModelId } from "../../../../core/registry/modelAliases";

export interface ResidentModelDto {
  readonly name: string;
  readonly sizeBytes: number;
  readonly sizeVramBytes: number;
}

export interface ModelLoadSnapshot {
  readonly resident: readonly ResidentModelDto[];
  readonly freeVramGB: number | null;
}

export interface ModelLoadState {
  /** True while the watched model is not resident. */
  readonly loading: boolean;
  /** 0-100 estimate from VRAM claimed so far, or null without a footprint. */
  readonly pct: number | null;
}

export const IDLE_LOAD_STATE: ModelLoadState = { loading: false, pct: null };

/** Null when residency cannot be read (sidecar down): unknown, not loading. */
export async function fetchModelLoadSnapshot(): Promise<ModelLoadSnapshot | null> {
  const [resident, gpu] = await Promise.all([
    ipcCall<{ models: ResidentModelDto[] }>("models.resident", {}),
    ipcCall<{ sample: { freeVramGB: number } | null }>("gpu.sample", {}),
  ]);
  if (!resident.ok) return null;
  return {
    resident: resident.value.models,
    freeVramGB: gpu.ok && gpu.value.sample ? gpu.value.sample.freeVramGB : null,
  };
}

/** Ollama keys `/api/ps` by tag; accept the folded id or a `<name>:` prefix. */
export function isModelResident(
  modelId: string,
  resident: readonly ResidentModelDto[],
): boolean {
  const folded = foldModelId(modelId).toLowerCase();
  const bare = folded.split(":")[0] ?? folded;
  return resident.some((entry) => {
    const name = entry.name.toLowerCase();
    return name === folded || name === bare || name.startsWith(`${bare}:`);
  });
}

/** Percent of `modelVramGB` claimed since `baselineFreeGB`, clamped 0-99. */
export function loadPercent(
  baselineFreeGB: number | null,
  freeGB: number | null,
  modelVramGB: number | null | undefined,
): number | null {
  if (baselineFreeGB === null || freeGB === null) return null;
  if (!modelVramGB || modelVramGB <= 0) return null;
  const claimed = Math.max(0, baselineFreeGB - freeGB);
  return Math.min(99, Math.round((claimed / modelVramGB) * 100));
}

export interface UseModelLoadWatchInput {
  readonly active: boolean;
  readonly modelId: string | null;
  readonly modelVramGB?: number | null;
  readonly intervalMs?: number;
  readonly fetchSnapshot?: () => Promise<ModelLoadSnapshot | null>;
}

export function useModelLoadWatch({
  active,
  modelId,
  modelVramGB = null,
  intervalMs = 1000,
  fetchSnapshot = fetchModelLoadSnapshot,
}: UseModelLoadWatchInput): ModelLoadState {
  const [state, setState] = useState<ModelLoadState>(IDLE_LOAD_STATE);
  const baselineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !modelId) {
      baselineRef.current = null;
      setState(IDLE_LOAD_STATE);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      let snapshot: ModelLoadSnapshot | null;
      try {
        snapshot = await fetchSnapshot();
      } catch {
        snapshot = null;
      }
      if (cancelled) return;
      if (snapshot === null || isModelResident(modelId, snapshot.resident)) {
        // Unknown or loaded: never claim "loading" on silence.
        setState(IDLE_LOAD_STATE);
        return; // Loaded: stop polling until the next activation.
      }
      if (baselineRef.current === null && snapshot.freeVramGB !== null) {
        baselineRef.current = snapshot.freeVramGB;
      }
      setState({
        loading: true,
        pct: loadPercent(baselineRef.current, snapshot.freeVramGB, modelVramGB),
      });
      timer = setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, modelId, modelVramGB, intervalMs, fetchSnapshot]);

  return state;
}

/** Load a model now (Ollama warm-up); resolves when Ollama has it resident. */
export async function warmModel(modelId: string): Promise<boolean> {
  const reply = await ipcCall<{ ok: boolean; status: number }>("models.warm", {
    modelId,
  });
  return reply.ok && reply.value.ok;
}
