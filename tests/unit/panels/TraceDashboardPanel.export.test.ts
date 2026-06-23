import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as vscode from "vscode";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";
import { TraceDashboardPanel } from "../../../src/panels/TraceDashboardPanel.js";

/**
 * v1.6.0 (AS004.P2.B) -- the in-dashboard "Export trace" action. These tests
 * cover the new panel wiring only (the `serializeTraceToHtml` serializer itself
 * is exhaustively covered by tests/unit/observability/TraceHtmlExport.test.ts);
 * here we prove the panel reads the selected trace from its in-process store,
 * serializes it, and writes it through the save dialog -- and that the cancel
 * and missing-trace paths are handled. The `vscode` module is the global mock
 * from tests/setup.ts.
 */

/** Minimal helper to expose the private export handler without `any` noise. */
interface ExportablePanel {
  _handleExportTrace(traceId: string): Promise<void>;
}

function seedTrace(store: TraceStore): string {
  const trace = store.startTrace("session-export");
  const span = store.startSpan(trace.traceId, "tool1", "tool_call", trace.rootSpanId);
  store.endSpan(span.spanId, "ok");
  store.endSpan(trace.rootSpanId, "ok");
  return trace.traceId;
}

describe("TraceDashboardPanel -- export trace (AS004.P2.B)", () => {
  let store: TraceStore;
  let panel: TraceDashboardPanel;

  beforeEach(() => {
    store = new TraceStore(":memory:");
    panel = new TraceDashboardPanel(vscode.Uri.file("/ext"), store, null);
    vi.mocked(vscode.window.showSaveDialog).mockReset();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.workspace.fs.writeFile).mockReset();
    vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    store.close();
    vi.restoreAllMocks();
  });

  describe("serializeTrace", () => {
    it("returns the self-contained HTML for an existing trace", () => {
      const traceId = seedTrace(store);
      const html = panel.serializeTrace(traceId);
      expect(html).not.toBeNull();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain(traceId);
      // No remote asset references -- the serializer embeds everything inline.
      expect(html).not.toMatch(/src=["']https?:/i);
    });

    it("returns null for a non-existent trace", () => {
      expect(panel.serializeTrace("does-not-exist")).toBeNull();
    });

    it("returns null when there is no trace store", () => {
      const noStorePanel = new TraceDashboardPanel(vscode.Uri.file("/ext"), null, null);
      expect(noStorePanel.serializeTrace("any")).toBeNull();
    });
  });

  describe("_handleExportTrace", () => {
    it("writes the serialized HTML to the chosen path and reports success", async () => {
      const traceId = seedTrace(store);
      const expected = panel.serializeTrace(traceId);
      const writeMock = vi.mocked(vscode.workspace.fs.writeFile);
      vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(
        vscode.Uri.file("/out/trace.html") as vscode.Uri,
      );

      await (panel as unknown as ExportablePanel)._handleExportTrace(traceId);

      expect(writeMock).toHaveBeenCalledTimes(1);
      const call = writeMock.mock.calls[0] as unknown as [vscode.Uri, Uint8Array];
      expect(call[0].fsPath).toBe("/out/trace.html");
      expect(Buffer.from(call[1]).toString("utf8")).toBe(expected);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it("defaults the save filename to nexus-trace-<shortId>.html", async () => {
      const traceId = seedTrace(store);
      vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

      await (panel as unknown as ExportablePanel)._handleExportTrace(traceId);

      const opts = vi.mocked(vscode.window.showSaveDialog).mock.calls[0][0];
      expect(opts?.defaultUri?.fsPath).toBe(`nexus-trace-${traceId.slice(0, 8)}.html`);
    });

    it("does nothing when the user cancels the save dialog", async () => {
      const traceId = seedTrace(store);
      const writeMock = vi.mocked(vscode.workspace.fs.writeFile);
      vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

      await (panel as unknown as ExportablePanel)._handleExportTrace(traceId);

      expect(writeMock).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it("reports an error and never opens a dialog for a missing trace", async () => {
      const writeMock = vi.mocked(vscode.workspace.fs.writeFile);

      await (panel as unknown as ExportablePanel)._handleExportTrace("does-not-exist");

      expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
      expect(writeMock).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    });

    it("surfaces a write failure through showErrorMessage", async () => {
      const traceId = seedTrace(store);
      vi.mocked(vscode.workspace.fs.writeFile).mockRejectedValue(new Error("disk full"));
      vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(
        vscode.Uri.file("/out/trace.html") as vscode.Uri,
      );

      await (panel as unknown as ExportablePanel)._handleExportTrace(traceId);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
      const message = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0];
      expect(message).toContain("disk full");
    });
  });
});
