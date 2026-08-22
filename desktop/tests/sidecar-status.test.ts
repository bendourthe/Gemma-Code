/**
 * v2.2.0 Phase 2 (2.2) -- truthful backend state.
 *
 * The classifier is the load-bearing piece: `ipc-unavailable` (running outside
 * Tauri, i.e. dev/test) must NOT be reported as a backend failure, while any
 * real backend error must be, so the studios stop rendering "No models
 * installed" for a dead sidecar.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  IPC_UNAVAILABLE,
  SIDECAR_NOT_RUNNING,
  describeSidecarFailure,
  isBackendDownMessage,
  isCatalogFailure,
  isSidecarFailureMessage,
  useSidecarStatus,
  type SidecarStatus,
} from "../src/lib/sidecarStatus";

function status(partial: Partial<SidecarStatus> = {}): SidecarStatus {
  return {
    running: true,
    nodePath: "C:/node/node.exe",
    nodeSource: "runtime-config",
    scriptPath: "C:/app/sidecar/dist/main.js",
    failure: null,
    stderrTail: [],
    candidatesRejected: [],
    ...partial,
  };
}

describe("isSidecarFailureMessage", () => {
  it("treats a real backend error as a failure", () => {
    expect(isSidecarFailureMessage(SIDECAR_NOT_RUNNING)).toBe(true);
    expect(isSidecarFailureMessage("sidecar response timeout")).toBe(true);
  });

  it("does NOT treat ipc-unavailable as a failure (dev / vitest)", () => {
    expect(isSidecarFailureMessage(IPC_UNAVAILABLE)).toBe(false);
  });

  it("ignores an empty message", () => {
    expect(isSidecarFailureMessage("")).toBe(false);
  });
});

describe("isCatalogFailure", () => {
  it("detects the catalog-load-failed status", () => {
    expect(isCatalogFailure("catalog-load-failed: ENOENT catalog.json")).toBe(true);
  });

  it("passes an ok status", () => {
    expect(isCatalogFailure("ok")).toBe(false);
    expect(isCatalogFailure(undefined)).toBe(false);
  });
});

describe("describeSidecarFailure", () => {
  it("summarizes failure, paths, stderr tail, and rejected candidates", () => {
    const text = describeSidecarFailure(
      status({
        running: false,
        failure: "script-not-found: C:/app/sidecar/dist/main.js",
        stderrTail: ["a", "b", "c", "d"],
        candidatesRejected: ["runtime.json nodePath not a file: X"],
      }),
    );
    expect(text).toContain("script-not-found");
    expect(text).toContain("node: C:/node/node.exe");
    // Only the last three stderr lines are carried.
    expect(text).toContain("b / c / d");
    expect(text).not.toContain("stderr: a");
    expect(text).toContain("tried:");
  });

  it("falls back to a plain sentence when nothing is known", () => {
    expect(describeSidecarFailure(null)).toMatch(/not reachable/);
  });
});

describe("useSidecarStatus", () => {
  it("reports a healthy backend as not down", async () => {
    const { result } = renderHook(() =>
      useSidecarStatus({ pollMs: 0, fetchFn: async () => status() }),
    );
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.isDown).toBe(false);
  });

  it("never reports down when the status is unknown (outside Tauri)", async () => {
    const { result } = renderHook(() =>
      useSidecarStatus({ pollMs: 0, debounceMs: 1, fetchFn: async () => null }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.isDown).toBe(false);
  });

  it("debounces a down state so a restart does not flicker the banner", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useSidecarStatus({
          pollMs: 0,
          debounceMs: 500,
          fetchFn: async () => status({ running: false, failure: "boom" }),
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      // Not yet: the debounce window has not elapsed.
      expect(result.current.isDown).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(result.current.isDown).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the down state after a successful restart", async () => {
    let running = false;
    const { result } = renderHook(() =>
      useSidecarStatus({
        pollMs: 0,
        debounceMs: 1,
        fetchFn: async () => status({ running }),
        restartFn: async () => {
          running = true;
          return { ok: true, status: status({ running: true }) };
        },
      }),
    );
    await waitFor(() => expect(result.current.isDown).toBe(true));
    await act(async () => {
      await result.current.restart();
    });
    expect(result.current.isDown).toBe(false);
    expect(result.current.restartError).toBeNull();
  });

  it("surfaces a restart failure reason", async () => {
    const { result } = renderHook(() =>
      useSidecarStatus({
        pollMs: 0,
        debounceMs: 1,
        fetchFn: async () => status({ running: false }),
        restartFn: async () => ({ ok: false, message: "restart-in-progress" }),
      }),
    );
    await waitFor(() => expect(result.current.isDown).toBe(true));
    await act(async () => {
      await result.current.restart();
    });
    expect(result.current.restartError).toBe("restart-in-progress");
  });
});

describe("isBackendDownMessage", () => {
  it("recognizes the shell's backend-down tokens", () => {
    for (const token of [
      "sidecar-not-running",
      "sidecar binary not found at C:/x/main.js",
      "sidecar spawn failed: ENOENT",
      "sidecar response timeout",
      "sidecar-exited: code 1",
      "stdin-closed",
    ]) {
      expect(isBackendDownMessage(token)).toBe(true);
    }
  });

  it("does NOT relabel an ordinary application error as a dead backend", () => {
    // Regression: an over-broad classifier replaced a page's real error text
    // ("offline", a rejected list) with the backend-down banner, hiding the
    // actual reason from the user.
    expect(isBackendDownMessage("offline")).toBe(false);
    expect(isBackendDownMessage("catalog-load-failed: bad json")).toBe(false);
    expect(isBackendDownMessage("Sync blocked by the injection scanner")).toBe(false);
    expect(isBackendDownMessage(null)).toBe(false);
    expect(isBackendDownMessage(undefined)).toBe(false);
    expect(isBackendDownMessage("")).toBe(false);
  });
});
