import * as vscode from "vscode";
import type { TraceStore } from "../observability/TraceStore.js";
import type { MetricsCollector } from "../observability/MetricsCollector.js";
import { getTraceDashboardHtml } from "./webview/traceDashboard.js";

export const TRACE_DASHBOARD_VIEW_ID = "gemma-code.traceDashboard";

interface TraceDashboardMessage {
  type: "requestTraceList" | "requestTraceDetail" | "requestTraceMetrics" | "ready";
  traceId?: string;
}

export class TraceDashboardPanel implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _traceStore: TraceStore | null,
    private readonly _metricsCollector: MetricsCollector | null,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    const nonce = crypto.randomUUID().replace(/-/g, "");
    const cspSource = webviewView.webview.cspSource;

    webviewView.webview.html = getTraceDashboardHtml(nonce, cspSource);

    webviewView.webview.onDidReceiveMessage((msg: TraceDashboardMessage) => {
      if (msg.type === "ready" || msg.type === "requestTraceList") {
        this._sendTraceList();
      } else if (msg.type === "requestTraceDetail" && msg.traceId) {
        this._sendTraceDetail(msg.traceId);
      } else if (msg.type === "requestTraceMetrics" && msg.traceId) {
        this._sendTraceMetrics(msg.traceId);
      }
    });
  }

  /** Refresh the trace list (can be called externally after new traces are recorded). */
  refresh(): void {
    this._sendTraceList();
  }

  private _sendTraceList(): void {
    if (!this._view || !this._traceStore) return;

    const traces = this._traceStore.listTraces(50);
    void this._view.webview.postMessage({
      type: "traceList",
      traces: traces.map((t) => {
        const rootSpan = this._traceStore!.getSpan(t.rootSpanId);
        return {
          traceId: t.traceId,
          startTime: t.startTime,
          durationMs: rootSpan?.durationMs ?? 0,
          spanCount: t.spanCount,
          status: rootSpan?.status ?? "ok",
        };
      }),
    });
  }

  private _sendTraceDetail(traceId: string): void {
    if (!this._view || !this._traceStore) return;

    const trace = this._traceStore.getTrace(traceId);
    if (!trace) return;

    void this._view.webview.postMessage({
      type: "traceDetail",
      traceId,
      spans: trace.spans,
    });
  }

  private _sendTraceMetrics(traceId: string): void {
    if (!this._view || !this._metricsCollector) return;

    const metrics = this._metricsCollector.computeSessionMetrics(traceId);
    if (!metrics) return;

    void this._view.webview.postMessage({
      type: "traceMetrics",
      metrics,
    });
  }
}
