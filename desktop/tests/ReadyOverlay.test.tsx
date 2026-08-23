/**
 * v2.2.2 Phase 1 -- in-app ready overlay (not a second OS window, not a CMD).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

import { ReadyOverlay } from "../src/components/ReadyOverlay";
import { useReadyGate } from "../src/lib/readyGate";
import type { SidecarStatus } from "../src/lib/sidecarStatus";

function status(partial: Partial<SidecarStatus> = {}): SidecarStatus {
  return {
    running: true,
    nodePath: "C:/Nexus/runtime/node/node.exe",
    nodeSource: "runtime-config",
    scriptPath: "C:/Nexus/sidecar/dist/main.js",
    failure: null,
    stderrTail: [],
    candidatesRejected: [],
    ...partial,
  };
}

describe("ReadyOverlay", () => {
  it("shows backend copy while the sidecar is starting", () => {
    render(
      <ReadyOverlay
        phase="backend"
        status={null}
        restarting={false}
        restartError={null}
        onRestart={() => undefined}
      />,
    );
    expect(screen.getByTestId("ready-overlay")).toHaveAttribute("data-ready-phase", "backend");
    expect(screen.getByTestId("ready-overlay-copy")).toHaveTextContent("Starting local backend...");
  });

  it("shows catalog copy after the sidecar is up", () => {
    render(
      <ReadyOverlay
        phase="catalog"
        status={status()}
        restarting={false}
        restartError={null}
        onRestart={() => undefined}
      />,
    );
    expect(screen.getByTestId("ready-overlay-copy")).toHaveTextContent(
      "Reading installed models...",
    );
  });

  it("renders nothing when ready", () => {
    const { container } = render(
      <ReadyOverlay
        phase="ready"
        status={status()}
        restarting={false}
        restartError={null}
        onRestart={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows SidecarDownBanner on failure, not an infinite splash", () => {
    render(
      <ReadyOverlay
        phase="failed"
        status={status({ running: false, failure: "sidecar-exited:-1073741510" })}
        restarting={false}
        restartError={null}
        onRestart={() => undefined}
      />,
    );
    expect(screen.getByTestId("ready-overlay")).toHaveAttribute("data-ready-phase", "failed");
    expect(screen.queryByTestId("ready-overlay-copy")).toBeNull();
    expect(screen.getByTestId("ready-sidecar-down")).toBeInTheDocument();
    expect(screen.getByTestId("ready-sidecar-down-restart")).toBeInTheDocument();
  });
});

describe("useReadyGate", () => {
  it("treats a null status (ipc-unavailable) as ready, not a hung splash", async () => {
    const { result } = renderHook(() =>
      useReadyGate({
        timeoutMs: 200,
        pollMs: 10,
        fetchStatus: async () => null,
        listCatalog: async () => false,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });

  it("fails immediately when the sidecar reports a failure", async () => {
    const { result } = renderHook(() =>
      useReadyGate({
        timeoutMs: 200,
        pollMs: 10,
        fetchStatus: async () =>
          status({ running: false, failure: "sidecar-exited:-1073741510" }),
        listCatalog: async () => false,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("failed"));
  });

  it("reaches ready after running plus models.list, including an empty catalog", async () => {
    const listCatalog = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useReadyGate({
        timeoutMs: 200,
        pollMs: 10,
        fetchStatus: async () => status({ running: true }),
        listCatalog,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(listCatalog).toHaveBeenCalled();
  });

  it("times out a sidecar that never starts", async () => {
    const { result } = renderHook(() =>
      useReadyGate({
        timeoutMs: 40,
        pollMs: 10,
        fetchStatus: async () => status({ running: false, failure: null }),
        listCatalog: async () => false,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("failed"), { timeout: 500 });
  });
});
