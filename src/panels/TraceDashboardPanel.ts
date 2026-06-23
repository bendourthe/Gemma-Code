import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { TraceStore } from "../../modules/coding/observability/TraceStore.js";
import type { MetricsCollector } from "../../modules/coding/observability/MetricsCollector.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { WebResponseCache } from "../tools/handlers/webCache.js";
import { getCompressionStats } from "../../modules/coding/utils/Compressor.js";
import { flattenSpanForest } from "../../modules/coding/observability/spanNesting.js";
import { serializeTraceToHtml } from "../../modules/coding/observability/TraceHtmlExport.js";
import { getTraceDashboardHtml } from "./webview/traceDashboard.js";

export const TRACE_DASHBOARD_VIEW_ID = "nexus.coding.traceDashboard";

interface TraceDashboardMessage {
  type:
    | "requestTraceList"
    | "requestTraceDetail"
    | "requestTraceMetrics"
    | "requestCacheStats"
    | "exportTrace"
    | "ready";
  traceId?: string;
}

/**
 * Phase 9 (v0.5.0) -- Cache observability hooks. The dashboard reads these
 * snapshots periodically to render the new panels (compression savings,
 * cache-hit rate, top cached files). Either may be null when the underlying
 * subsystem is disabled (no workspace, init failure, etc.).
 */
export interface CacheStatsProviders {
  readonly toolOutputCache: ToolOutputCache | null;
  readonly webResponseCache: WebResponseCache | null;
}

/** Refresh cadence for the cache panels. Matches the trace-buffer flush. */
const CACHE_REFRESH_INTERVAL_MS = 5_000;

export class TraceDashboardPanel implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _traceStore: TraceStore | null,
    private readonly _metricsCollector: MetricsCollector | null,
    private readonly _cacheProviders: CacheStatsProviders = {
      toolOutputCache: null,
      webResponseCache: null,
    },
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

    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = webviewView.webview.cspSource;

    webviewView.webview.html = getTraceDashboardHtml(nonce, cspSource);

    webviewView.webview.onDidReceiveMessage((msg: TraceDashboardMessage) => {
      if (msg.type === "ready" || msg.type === "requestTraceList") {
        this._sendTraceList();
        this._sendCacheStats();
      } else if (msg.type === "requestTraceDetail" && msg.traceId) {
        this._sendTraceDetail(msg.traceId);
      } else if (msg.type === "requestTraceMetrics" && msg.traceId) {
        this._sendTraceMetrics(msg.traceId);
      } else if (msg.type === "requestCacheStats") {
        this._sendCacheStats();
      } else if (msg.type === "exportTrace" && msg.traceId) {
        void this._handleExportTrace(msg.traceId);
      }
    });

    // Phase 9: schedule periodic cache-stats refresh while the view is live.
    if (this._refreshTimer === null) {
      this._refreshTimer = setInterval(() => {
        this._sendCacheStats();
      }, CACHE_REFRESH_INTERVAL_MS);
      if (typeof this._refreshTimer.unref === "function") {
        this._refreshTimer.unref();
      }
    }

    webviewView.onDidDispose(() => {
      if (this._refreshTimer !== null) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
      }
    });
  }

  /** Refresh the trace list (can be called externally after new traces are recorded). */
  refresh(): void {
    this._sendTraceList();
    this._sendCacheStats();
  }

  /**
   * Phase 9: build the cache-stats payload from the configured providers and
   * the module-level Compressor telemetry. Exposed for unit tests so the
   * panel logic can be exercised without a live webview.
   */
  buildCacheStatsPayload(): {
    type: "cacheStats";
    compressionSavedBytes: number;
    compressionOriginalBytes: number;
    compressionCompressedBytes: number;
    toolOutputCache: {
      entries: number;
      hits: number;
      misses: number;
      bytes: number;
      topByHits: Array<{ absolutePath: string; hits: number }>;
    };
    webResponseCache: {
      entries: number;
      hits: number;
      misses: number;
      expired: number;
    } | null;
  } {
    const compression = getCompressionStats();
    const tool = this._cacheProviders.toolOutputCache;
    const web = this._cacheProviders.webResponseCache;

    const toolStats = tool
      ? (() => {
          const lru = tool.lruStats();
          const stats = tool.stats();
          return {
            entries: stats.entries,
            hits: lru.hits,
            misses: lru.misses,
            bytes: lru.bytes,
            topByHits: stats.topByHits.map((row) => ({
              absolutePath: row.absolutePath,
              hits: row.hits,
            })),
          };
        })()
      : { entries: 0, hits: 0, misses: 0, bytes: 0, topByHits: [] };

    const webStats = web
      ? (() => {
          const s = web.stats();
          return {
            entries: s.entries,
            hits: s.hits,
            misses: s.misses,
            expired: s.expired,
          };
        })()
      : null;

    return {
      type: "cacheStats",
      compressionSavedBytes:
        compression.originalBytes - compression.compressedBytes,
      compressionOriginalBytes: compression.originalBytes,
      compressionCompressedBytes: compression.compressedBytes,
      toolOutputCache: toolStats,
      webResponseCache: webStats,
    };
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

    // v1.6.0 Phase 4 (A2): order spans as a run tree and annotate each with its
    // nesting depth so the waterfall can indent planner -> worker -> critic.
    // For traces without run-nesting metadata this is the flat start-time order
    // with depth 0 throughout, i.e. the legacy waterfall unchanged.
    const spans = flattenSpanForest(trace.spans).map(({ span, depth }) => ({
      ...span,
      depth,
    }));

    void this._view.webview.postMessage({
      type: "traceDetail",
      traceId,
      spans,
    });
  }

  /**
   * v1.6.0 (AS004.P2.B) -- serialize the selected trace to the same
   * self-contained, offline HTML viewer string that the `nexus trace export`
   * CLI produces, reusing the shared `serializeTraceToHtml` serializer. Returns
   * null when there is no trace store or no trace with that id. Pure (no vscode
   * dialog, no disk write), so it is unit-testable directly; `_handleExportTrace`
   * wraps it with the save dialog and the file write.
   */
  serializeTrace(traceId: string): string | null {
    if (!this._traceStore) return null;
    const trace = this._traceStore.getTrace(traceId);
    if (!trace) return null;
    return serializeTraceToHtml(trace);
  }

  /**
   * v1.6.0 (AS004.P2.B) -- one-click "Export trace" action. Prompts for a save
   * location, serializes the selected trace, and writes the self-contained HTML
   * viewer locally. Local-only: it reads the in-process trace store and writes a
   * single file; no network, no telemetry. Mirrors the `nexus trace export` CLI
   * surface for users who live in the Trace Dashboard.
   */
  private async _handleExportTrace(traceId: string): Promise<void> {
    const html = this.serializeTrace(traceId);
    if (html === null) {
      void vscode.window.showErrorMessage(
        "Nexus: could not export trace (the trace store is unavailable or the trace no longer exists).",
      );
      return;
    }

    const shortId = traceId.slice(0, 8);
    let target: vscode.Uri | undefined;
    try {
      target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`nexus-trace-${shortId}.html`),
        saveLabel: "Export Trace",
        filters: { "HTML viewer": ["html"] },
      });
    } catch {
      target = undefined;
    }
    if (!target) return; // user cancelled the save dialog

    try {
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, "utf8"));
      void vscode.window.showInformationMessage(
        `Nexus: exported trace to ${target.fsPath}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Nexus: failed to write trace export: ${message}`,
      );
    }
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

  private _sendCacheStats(): void {
    if (!this._view) return;
    void this._view.webview.postMessage(this.buildCacheStatsPayload());
  }
}
