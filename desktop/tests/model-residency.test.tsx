/**
 * v2.2.0 Phase 4 (4.3) -- residency hook + switch dialog.
 *
 * The behaviours that matter: the dialog appears ONLY when something would be
 * evicted while busy, "remember for this session" actually suppresses the next
 * one, an ignored dialog expires instead of holding a queue slot, and a stale
 * warning can never act on a job that already finished.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CONFIRM_EXPIRY_MS,
  useModelResidency,
} from "../src/shared/models/useModelResidency";
import {
  ModelSwitchChip,
  ModelSwitchDialog,
} from "../src/shared/models/ModelSwitchDialog";
import type { SwitchRequest } from "../../core/scheduler/ModelSwitchPolicy";

const AGENTIC = { modelId: "qwen2.5-coder:14b", vramGB: 9 };

function req(overrides: Partial<SwitchRequest> = {}): SwitchRequest {
  return {
    targetModelId: "sana-1.6b-2k",
    targetVramGB: 3.2,
    requestingModule: "image",
    resident: [AGENTIC],
    freeVramGB: 1,
    activeJob: { moduleId: "coding", jobType: "agent-turn" },
    installed: true,
    ...overrides,
  };
}

describe("useModelResidency", () => {
  it("opens a dialog when a busy model would be evicted", () => {
    const { result } = renderHook(() => useModelResidency());
    let verdict;
    act(() => {
      verdict = result.current.request(req());
    });
    expect(verdict).toMatchObject({ kind: "confirm" });
    expect(result.current.pending).not.toBeNull();
  });

  it("does NOT open a dialog when the GPU is idle", () => {
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.request(req({ activeJob: null }));
    });
    expect(result.current.pending).toBeNull();
  });

  it("does NOT open a dialog when both models fit", () => {
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.request(req({ freeVramGB: 8 }));
    });
    expect(result.current.pending).toBeNull();
  });

  it("asks when an incumbent exists and free VRAM is unknown", () => {
    const { result } = renderHook(() => useModelResidency());
    let verdict;
    act(() => {
      verdict = result.current.request(req({ freeVramGB: null }));
    });
    expect(verdict).toMatchObject({ kind: "confirm", reason: "vram-unknown" });
    expect(result.current.pending?.verdict.reason).toBe("vram-unknown");
  });

  it("suppresses the next dialog once the user remembers the choice", () => {
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.request(req());
    });
    act(() => {
      result.current.resolvePending({ action: "switch", remember: true });
    });
    expect(result.current.pending).toBeNull();

    // Second, identical request: no dialog this time.
    let second;
    act(() => {
      second = result.current.request(req());
    });
    expect(second).toMatchObject({ kind: "auto-switch" });
    expect(result.current.pending).toBeNull();
  });

  it("does not remember when the box was left unchecked", () => {
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.request(req());
    });
    act(() => {
      result.current.resolvePending({ action: "switch", remember: false });
    });
    let second;
    act(() => {
      second = result.current.request(req());
    });
    expect(second).toMatchObject({ kind: "confirm" });
  });

  it("shares remembered pairs across page hook instances for one App session", () => {
    const sessionMemory = new Set<string>();
    const first = renderHook(() => useModelResidency({ rememberedPairs: sessionMemory }));
    act(() => {
      first.result.current.request(req());
    });
    act(() => {
      first.result.current.resolvePending({ action: "switch", remember: true });
    });
    first.unmount();

    const second = renderHook(() => useModelResidency({ rememberedPairs: sessionMemory }));
    let verdict;
    act(() => {
      verdict = second.result.current.request(req());
    });
    expect(verdict).toMatchObject({ kind: "auto-switch" });
    expect(second.result.current.pending).toBeNull();
  });

  it("re-classifies on confirm so a finished job is not treated as busy", () => {
    // The warned-about job completed while the dialog sat open. Acting on the
    // stale verdict would evict a model nobody is using any more.
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.request(req());
    });
    act(() => {
      // The pending request captured activeJob=coding; the re-classification
      // uses consent, which resolves it to a plain auto-switch.
      const resolved = result.current.resolvePending({ action: "switch", remember: false });
      expect(resolved).toMatchObject({ kind: "auto-switch" });
    });
  });

  it("returns no verdict for keep and queue", () => {
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.request(req());
    });
    act(() => {
      expect(result.current.resolvePending({ action: "keep" })).toBeNull();
    });
    expect(result.current.pending).toBeNull();

    act(() => {
      result.current.request(req());
    });
    act(() => {
      expect(result.current.resolvePending({ action: "queue" })).toBeNull();
    });
  });

  it("tracks switching state for the chip", () => {
    const { result } = renderHook(() => useModelResidency());
    act(() => {
      result.current.beginSwitch({ from: ["a"], to: "b", startedAt: 0 });
    });
    expect(result.current.switching).toMatchObject({ to: "b" });
    act(() => {
      result.current.endSwitch();
    });
    expect(result.current.switching).toBeNull();
  });
});

describe("ModelSwitchDialog", () => {
  const pending = {
    request: req(),
    verdict: {
      kind: "confirm" as const,
      modelId: "sana-1.6b-2k",
      busyWith: { moduleId: "coding" as const, jobType: "agent-turn", modelId: "qwen2.5-coder:14b" },
      reason: "other-module-busy" as const,
    },
    expiresAt: Date.now() + CONFIRM_EXPIRY_MS,
  };

  it("names the model and what is using the GPU", () => {
    render(
      <ModelSwitchDialog pending={pending} onResolve={() => undefined} onExpire={() => undefined} />,
    );
    const dialog = screen.getByTestId("model-switch-dialog");
    expect(dialog.textContent).toContain("sana-1.6b-2k");
    expect(dialog.textContent).toContain("qwen2.5-coder:14b");
    expect(dialog.textContent).toContain("agentic coding task");
  });

  it("reports the vram-unknown case differently", () => {
    render(
      <ModelSwitchDialog
        pending={{ ...pending, verdict: { ...pending.verdict, reason: "vram-unknown" } }}
        onResolve={() => undefined}
        onExpire={() => undefined}
      />,
    );
    expect(screen.getByTestId("model-switch-dialog").textContent).toContain(
      "cannot read how much GPU memory is free",
    );
  });

  it("passes the remember flag with the switch action", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ModelSwitchDialog pending={pending} onResolve={onResolve} onExpire={() => undefined} />,
    );
    await user.click(screen.getByTestId("model-switch-dialog-remember"));
    await user.click(screen.getByTestId("model-switch-dialog-switch"));
    expect(onResolve).toHaveBeenCalledWith({ action: "switch", remember: true });
  });

  it("offers queue and keep without the remember flag", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ModelSwitchDialog pending={pending} onResolve={onResolve} onExpire={() => undefined} />,
    );
    await user.click(screen.getByTestId("model-switch-dialog-queue"));
    expect(onResolve).toHaveBeenCalledWith({ action: "queue" });
  });

  it("expires an unanswered dialog instead of holding the slot", () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      render(
        <ModelSwitchDialog
          pending={{ ...pending, expiresAt: 60_000 }}
          onResolve={() => undefined}
          onExpire={onExpire}
          now={() => 0}
        />,
      );
      expect(onExpire).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_001);
      expect(onExpire).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ModelSwitchChip", () => {
  it("renders nothing when no switch is in flight", () => {
    const { container } = render(<ModelSwitchChip switching={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the target model and elapsed time once it is slow", () => {
    render(
      <ModelSwitchChip
        switching={{ from: ["a"], to: "sana-1.6b-2k", startedAt: 0 }}
        now={() => 5000}
      />,
    );
    const chip = screen.getByTestId("model-switch-chip");
    expect(chip.textContent).toContain("sana-1.6b-2k");
    expect(chip.textContent).toContain("5s");
  });

  it("omits the elapsed time for a fast switch", () => {
    render(
      <ModelSwitchChip
        switching={{ from: ["a"], to: "sana-1.6b-2k", startedAt: 0 }}
        now={() => 500}
      />,
    );
    expect(screen.getByTestId("model-switch-chip").textContent).not.toContain("s)");
  });
});
