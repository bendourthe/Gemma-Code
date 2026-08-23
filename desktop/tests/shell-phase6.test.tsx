/**
 * v2.2.0 Phase 6 -- shell modernization.
 *
 * Pins the three user-visible complaints this phase addresses: the duplicated
 * brand in the sidebar, the GPU card floating over the buttons it obscured,
 * and a permanent nav tab for a surface that is empty most of the time.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Sidebar } from "../src/components/Sidebar";
import { GpuStatusFooter } from "../src/components/GpuStatusFooter";
import { ApprovalsBell } from "../src/components/ApprovalsBell";
import type { LocalModelTelemetry, TelemetryStream } from "../src/components/LocalModelStatus.types";

function streamOf(sample: LocalModelTelemetry | null): TelemetryStream {
  return {
    subscribe(fn) {
      if (sample) fn(sample);
      return () => undefined;
    },
  } as TelemetryStream;
}

function sample(partial: Partial<LocalModelTelemetry> = {}): LocalModelTelemetry {
  return {
    modelName: "qwen2.5-coder",
    paramSize: "14B",
    gpuPct: 41,
    vramFreeGB: 4.8,
    deviceName: "NVIDIA GeForce RTX 3080",
    lastUpdated: Date.now(),
    idle: false,
    ...partial,
  } as LocalModelTelemetry;
}

function renderSidebar(props: Parameters<typeof Sidebar>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Sidebar {...props} />
    </MemoryRouter>,
  );
}

describe("sidebar compact mode", () => {
  it("starts compact on a wide window", () => {
    localStorage.clear();
    renderSidebar({ initialWidth: 1600 });
    expect(screen.getByTestId("nav-chatbot").textContent).toBe("");
    expect(screen.getByTestId("nav-chatbot").getAttribute("aria-label")).toBe("Local Chatbot");
  });

  it("auto-compacts on a narrow window without a stored preference", () => {
    localStorage.clear();
    renderSidebar({ initialWidth: 900 });
    // Labels are hidden; the icon and its aria-label remain.
    expect(screen.getByTestId("nav-chatbot").textContent).toBe("");
    expect(screen.getByTestId("nav-chatbot").getAttribute("aria-label")).toBe("Local Chatbot");
  });

  it("lets an explicit preference beat the width heuristic", () => {
    // A user who expanded the rail on a narrow window keeps it expanded.
    localStorage.setItem("nexus.sidebar.compact", "false");
    renderSidebar({ initialWidth: 900 });
    expect(screen.getByTestId("nav-chatbot").textContent).toContain("Local Chatbot");
    localStorage.clear();
  });

  it("persists the toggle", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    renderSidebar({ initialWidth: 1600 });
    await user.click(screen.getByTestId("sidebar-collapse-toggle"));
    expect(localStorage.getItem("nexus.sidebar.compact")).toBe("false");
    expect(screen.getByTestId("nav-chatbot").textContent).toContain("Local Chatbot");
    localStorage.clear();
  });

  it("keeps every nav target reachable in both modes", () => {
    localStorage.clear();
    renderSidebar({ initialWidth: 900 });
    for (const id of ["nav-chatbot", "nav-coding", "nav-image", "nav-video"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId("nav-admin-settings")).toBeTruthy();
  });
});

describe("brand is not duplicated", () => {
  it("has no brand block in the sidebar", () => {
    localStorage.clear();
    const { container } = renderSidebar({ initialWidth: 1600 });
    expect(screen.queryByTestId("sidebar-brand")).toBeNull();
    expect(container.textContent).not.toContain("AI Studio");
    expect(screen.queryByTestId("nav-admin-profile")).toBeNull();
  });
});

describe("GPU status footer", () => {
  it("reports unavailable honestly when there is no telemetry", () => {
    render(<GpuStatusFooter compact={false} stream={null} />);
    const footer = screen.getByTestId("gpu-status-footer");
    expect(footer.getAttribute("data-state")).toBe("unavailable");
    expect(footer.textContent).toContain("unavailable");
  });

  it("renders utilization and free VRAM when a sample arrives", () => {
    render(<GpuStatusFooter compact={false} stream={streamOf(sample())} />);
    const footer = screen.getByTestId("gpu-status-footer");
    expect(footer.textContent).toContain("GPU 41%");
    expect(footer.textContent).toContain("4.8 GB free");
  });

  it("marks a stale sample rather than presenting it as current", () => {
    render(
      <GpuStatusFooter
        compact={false}
        stream={streamOf(sample({ lastUpdated: Date.now() - 60_000 }))}
      />,
    );
    expect(screen.getByTestId("gpu-status-footer-stale")).toBeTruthy();
  });

  it("collapses to a slim mark with the numbers in its tooltip", () => {
    render(<GpuStatusFooter compact stream={streamOf(sample())} />);
    const footer = screen.getByTestId("gpu-status-footer");
    expect(footer.getAttribute("title")).toContain("Free VRAM");
    expect(footer.textContent).not.toContain("GPU 41%");
  });

  it("is not fixed-positioned anywhere (the dock covered the buttons)", () => {
    const appSource = readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    expect(appSource).not.toContain("LocalModelStatusDock");
    expect(appSource).not.toContain("DockMount");
  });
});

describe("approvals bell", () => {
  const client = {
    list: vi.fn(async () => [
      { id: "a1", toolName: "run_terminal", state: "pending" },
    ]),
    approve: vi.fn(async () => ({ ok: true, reason: "" })),
    deny: vi.fn(async () => ({ ok: true, reason: "" })),
    pendingCount: vi.fn(async () => 1),
    listSchedules: vi.fn(async () => []),
    setScheduleEnabled: vi.fn(async () => ({ ok: true })),
  } as never;

  it("stays visually quiet with nothing pending", () => {
    render(<ApprovalsBell pendingCount={0} compact={false} />);
    expect(screen.queryByTestId("approvals-bell-badge")).toBeNull();
  });

  it("badges the pending count", () => {
    render(<ApprovalsBell pendingCount={3} compact={false} />);
    expect(screen.getByTestId("approvals-bell-badge").textContent).toBe("3");
  });

  it("lists pending approvals in a popover", async () => {
    const user = userEvent.setup();
    render(<ApprovalsBell pendingCount={1} compact={false} client={client} />);
    await user.click(screen.getByTestId("approvals-bell"));
    expect(await screen.findByTestId("approvals-bell-item-a1")).toBeTruthy();
  });

  it("re-reads after acting so a stale row cannot be approved twice", async () => {
    const user = userEvent.setup();
    render(<ApprovalsBell pendingCount={1} compact={false} client={client} />);
    await user.click(screen.getByTestId("approvals-bell"));
    await screen.findByTestId("approvals-bell-item-a1");
    const before = (client as unknown as { list: { mock: { calls: unknown[] } } }).list.mock.calls
      .length;
    await user.click(screen.getByTestId("approvals-bell-approve-a1"));
    await waitFor(() =>
      expect(
        (client as unknown as { list: { mock: { calls: unknown[] } } }).list.mock.calls.length,
      ).toBeGreaterThan(before),
    );
  });

  it("explains a failed read instead of showing a fake all-clear", async () => {
    const failing = {
      list: vi.fn(async () => {
        throw new Error("sidecar-not-running");
      }),
      approve: vi.fn(),
      deny: vi.fn(),
      pendingCount: vi.fn(async () => 0),
      listSchedules: vi.fn(async () => []),
      setScheduleEnabled: vi.fn(),
    } as never;
    const user = userEvent.setup();
    render(<ApprovalsBell pendingCount={0} compact={false} client={failing} />);
    await user.click(screen.getByTestId("approvals-bell"));
    expect(await screen.findByTestId("approvals-bell-error")).toBeTruthy();
    // Crucially NOT the "nothing waiting" message.
    expect(screen.queryByTestId("approvals-bell-empty")).toBeNull();
  });

  it("closes from the X control even when the sidecar is down", async () => {
    const failing = {
      list: vi.fn(async () => {
        throw new Error("The pipe is being closed. (os error 232)");
      }),
      approve: vi.fn(),
      deny: vi.fn(),
      pendingCount: vi.fn(async () => 0),
      listSchedules: vi.fn(async () => []),
      setScheduleEnabled: vi.fn(),
    } as never;
    const user = userEvent.setup();
    render(<ApprovalsBell pendingCount={0} compact={false} client={failing} />);
    await user.click(screen.getByTestId("approvals-bell"));
    expect(await screen.findByTestId("approvals-bell-error")).toBeTruthy();
    await user.click(screen.getByTestId("approvals-bell-close"));
    expect(screen.queryByTestId("approvals-bell-popover")).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ApprovalsBell pendingCount={0} compact={false} client={client} />);
    await user.click(screen.getByTestId("approvals-bell"));
    expect(await screen.findByTestId("approvals-bell-popover")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("approvals-bell-popover")).toBeNull();
  });

  it("closes on pointerdown outside the dialog and the bell", async () => {
    const user = userEvent.setup();
    render(<ApprovalsBell pendingCount={0} compact={false} client={client} />);
    await user.click(screen.getByTestId("approvals-bell"));
    expect(await screen.findByTestId("approvals-bell-popover")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("approvals-bell-popover")).toBeNull();
  });
});

describe("design tokens", () => {
  it("defines every token the app references", () => {
    const tokens = readFileSync(
      path.resolve(__dirname, "../src/styles/tokens.css"),
      "utf8",
    );
    // These were referenced in 71 places but never defined, so each usage fell
    // through to whatever inline literal the author happened to write.
    for (const name of ["--border-1", "--accent-primary", "--accent-danger", "--accent-warning"]) {
      expect(tokens).toContain(`${name}:`);
    }
  });
});
