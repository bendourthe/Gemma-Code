import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  isModelResident,
  loadPercent,
  useModelLoadWatch,
  type ModelLoadSnapshot,
} from "../src/shared/models/modelLoadWatch";

// v2.4.8 follow-up (2026-09-07): chat showed "Thinking" while Ollama was still
// loading the model. Residency plus the VRAM claimed since the watch began
// give an honest "Loading model NN%".
describe("modelLoadWatch", () => {
  it("matches Ollama tags exactly, bare, or by name prefix", () => {
    const resident = [{ name: "gemma4:12b", sizeBytes: 1, sizeVramBytes: 1 }];
    expect(isModelResident("gemma4:12b", resident)).toBe(true);
    expect(isModelResident("gemma4", resident)).toBe(true);
    expect(isModelResident("qwen3.5:4b", resident)).toBe(false);
  });

  it("estimates percent from VRAM claimed against the model footprint", () => {
    expect(loadPercent(14, 10, 8)).toBe(50);
    expect(loadPercent(14, 2, 8)).toBe(99);
    expect(loadPercent(14, 15, 8)).toBe(0);
    expect(loadPercent(null, 10, 8)).toBeNull();
    expect(loadPercent(14, 10, null)).toBeNull();
  });

  it("reports loading with a rising percent until the model is resident, then idles", async () => {
    const snapshots: ModelLoadSnapshot[] = [
      { resident: [], freeVramGB: 14 },
      { resident: [], freeVramGB: 10 },
      { resident: [{ name: "gemma4:12b", sizeBytes: 1, sizeVramBytes: 1 }], freeVramGB: 6 },
    ];
    let index = 0;
    const fetchSnapshot = vi.fn(async () => snapshots[Math.min(index++, snapshots.length - 1)]!);
    const { result } = renderHook(() =>
      useModelLoadWatch({
        active: true,
        modelId: "gemma4:12b",
        modelVramGB: 8,
        // Slow enough for waitFor (50 ms polls) to observe the middle sample.
        intervalMs: 150,
        fetchSnapshot,
      }),
    );
    await waitFor(() => expect(result.current).toEqual({ loading: true, pct: 50 }));
    await waitFor(() => expect(result.current).toEqual({ loading: false, pct: null }));
    // Resident: polling stopped.
    const calls = fetchSnapshot.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchSnapshot.mock.calls.length).toBe(calls);
  });

  it("stays idle while inactive and never polls", async () => {
    const fetchSnapshot = vi.fn(async () => ({ resident: [], freeVramGB: null }));
    const { result } = renderHook(() =>
      useModelLoadWatch({ active: false, modelId: "gemma4:12b", fetchSnapshot }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual({ loading: false, pct: null });
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });
});
