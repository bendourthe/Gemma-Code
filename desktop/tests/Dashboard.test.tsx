import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "../src/pages/Dashboard";
import { setInvokeOverride, clearInvokeOverride } from "../src/lib/ipc";
import { writeProfileSync } from "../src/lib/profile";
import type {
  LocalModelTelemetry,
  TelemetryStream,
  TelemetrySubscriber,
} from "../src/components/LocalModelStatus.types";

function manualStream(): TelemetryStream & { push(s: LocalModelTelemetry): void } {
  const subs = new Set<TelemetrySubscriber>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    push(s) {
      for (const fn of subs) fn(s);
    },
  };
}

function renderDashboard(stream: TelemetryStream | null = null) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Dashboard telemetryStream={stream} />} />
        <Route path="/coding" element={<div data-testid="coding-page">coding</div>} />
        <Route path="/settings" element={<div data-testid="settings-page">settings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    clearInvokeOverride();
    window.localStorage.clear();
  });

  it("renders four module cards plus the welcome line", () => {
    renderDashboard();
    expect(screen.getByTestId("dashboard-grid")).toBeInTheDocument();
    expect(screen.getByTestId("module-card-coding")).toBeInTheDocument();
    expect(screen.getByTestId("module-card-chatbot")).toBeInTheDocument();
    expect(screen.getByTestId("module-card-image")).toBeInTheDocument();
    expect(screen.getByTestId("module-card-video")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-greeting")).toHaveTextContent(/welcome, user/i);
  });

  it("uses the firstName from profile when present", () => {
    writeProfileSync({ firstName: "Alex" });
    renderDashboard();
    expect(screen.getByTestId("dashboard-greeting")).toHaveTextContent(/welcome, alex/i);
  });

  it("gear icon navigates to /settings", () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId("dashboard-gear"));
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it("CTA on the coding module card navigates to /coding", () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId("module-card-coding-cta"));
    expect(screen.getByTestId("coding-page")).toBeInTheDocument();
  });

  it("renders the LocalModelStatus widget driven by the given stream", () => {
    const stream = manualStream();
    renderDashboard(stream);
    expect(screen.getByTestId("local-model-status").dataset.state).toBe("loading");
  });

  it("ping button calls ipc.invoke and displays the result", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, pid: 42, version: "1.0.0-alpha.0" });
    setInvokeOverride(invoke);
    renderDashboard();
    fireEvent.click(screen.getByTestId("dashboard-ping"));
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-ping-result")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dashboard-ping-result").textContent).toMatch(/pong/);
    expect(invoke).toHaveBeenCalledWith("ipc_call", { method: "ping", params: {} });
  });

  it("ping button surfaces an error message when invoke rejects", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("boom"));
    setInvokeOverride(invoke);
    renderDashboard();
    fireEvent.click(screen.getByTestId("dashboard-ping"));
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-ping-result").textContent).toMatch(/ipc-error/);
    });
  });

  it("renders the notification bell with a red-dot badge", () => {
    renderDashboard();
    expect(screen.getByTestId("dashboard-bell")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-bell-badge")).toBeInTheDocument();
  });

  it("renders the recent projects list and the two FABs", () => {
    renderDashboard();
    expect(screen.getByTestId("dashboard-recent")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-fab-sparkle")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-fab-help")).toBeInTheDocument();
  });
});
