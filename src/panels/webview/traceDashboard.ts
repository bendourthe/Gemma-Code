/**
 * Returns the complete HTML for the trace dashboard webview.
 * Self-contained: all CSS and JS are inlined.
 */
export function getTraceDashboardHtml(
  nonce: string,
  cspSource: string,
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Gemma Code Traces</title>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    #header {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    #header h2 {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
      flex: 1;
    }
    .btn {
      font-size: 11px;
      padding: 3px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }

    /* Metrics summary */
    #metrics-bar {
      padding: 6px 14px;
      display: flex;
      gap: 12px;
      font-size: 11px;
      opacity: 0.6;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .metric-item { display: flex; gap: 4px; }
    .metric-label { opacity: 0.7; }
    .metric-value { font-weight: 600; }

    /* Content area */
    #content {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }

    /* Trace list */
    .trace-item {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 1px solid rgba(128,128,128,0.1);
      transition: background 0.1s;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .trace-item:hover { background: var(--vscode-list-hoverBackground); }
    .trace-item.selected { background: var(--vscode-list-activeSelectionBackground); }
    .trace-date { font-size: 11px; opacity: 0.6; min-width: 75px; }
    .trace-duration { font-size: 11px; font-weight: 600; min-width: 55px; }
    .trace-spans { font-size: 11px; opacity: 0.5; min-width: 50px; }
    .trace-status { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; }
    .trace-status.ok { color: var(--vscode-testing-iconPassed, #4caf50); }
    .trace-status.error { color: var(--vscode-testing-iconFailed, #f44336); }

    /* Back button */
    #back-btn {
      display: none;
      padding: 8px 14px;
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-textLink-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    #back-btn:hover { text-decoration: underline; }

    /* Waterfall visualization */
    #waterfall {
      display: none;
      padding: 8px 14px;
    }
    .span-row {
      display: flex;
      align-items: center;
      height: 24px;
      gap: 6px;
      cursor: pointer;
    }
    .span-row:hover { background: var(--vscode-list-hoverBackground); }
    .span-label {
      font-size: 11px;
      min-width: 120px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .span-bar-container {
      flex: 1;
      position: relative;
      height: 14px;
    }
    .span-bar {
      position: absolute;
      height: 14px;
      border-radius: 2px;
      min-width: 2px;
    }
    .span-bar.agent_turn { background: #5b8def; }
    .span-bar.tool_call { background: #4caf50; }
    .span-bar.llm_call { background: #9c27b0; }
    .span-bar.compaction { background: #ff9800; }
    .span-bar.sub_agent { background: #009688; }
    .span-bar.reflexion { background: #f44336; }
    .span-bar.planning { background: #2196f3; }
    .span-bar.custom { background: #607d8b; }
    .span-duration {
      font-size: 10px;
      opacity: 0.5;
      min-width: 50px;
      text-align: right;
    }

    /* Span detail */
    #span-detail {
      display: none;
      padding: 10px 14px;
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      max-height: 200px;
      overflow-y: auto;
    }
    .detail-title {
      font-weight: 600;
      margin-bottom: 6px;
    }
    .detail-row {
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }
    .detail-key { opacity: 0.6; min-width: 100px; }
    .detail-val { word-break: break-all; }

    /* Empty state */
    #empty-state {
      padding: 40px 20px;
      text-align: center;
      opacity: 0.4;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="header">
    <h2>Traces</h2>
    <button class="btn" id="refresh-btn">Refresh</button>
  </div>
  <div id="metrics-bar" style="display:none;"></div>
  <div id="back-btn">&larr; Back to trace list</div>
  <div id="content">
    <div id="empty-state">No traces recorded yet.</div>
  </div>
  <div id="waterfall"></div>
  <div id="span-detail"></div>

  <script nonce="${nonce}">
    (function() {
      'use strict';
      const vscode = acquireVsCodeApi();
      const contentEl = document.getElementById('content');
      const waterfallEl = document.getElementById('waterfall');
      const spanDetailEl = document.getElementById('span-detail');
      const backBtn = document.getElementById('back-btn');
      const refreshBtn = document.getElementById('refresh-btn');
      const metricsBar = document.getElementById('metrics-bar');
      let currentView = 'list';

      refreshBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'requestTraceList' });
      });

      backBtn.addEventListener('click', () => {
        showListView();
      });

      function showListView() {
        currentView = 'list';
        contentEl.style.display = '';
        waterfallEl.style.display = 'none';
        spanDetailEl.style.display = 'none';
        backBtn.style.display = 'none';
        metricsBar.style.display = 'none';
        vscode.postMessage({ type: 'requestTraceList' });
      }

      function showDetailView() {
        currentView = 'detail';
        contentEl.style.display = 'none';
        waterfallEl.style.display = '';
        backBtn.style.display = '';
        spanDetailEl.style.display = 'none';
      }

      function formatDate(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return d.toLocaleDateString();
      }

      function formatDuration(ms) {
        if (ms == null || ms === 0) return '-';
        if (ms < 1000) return ms + 'ms';
        return (ms / 1000).toFixed(1) + 's';
      }

      function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      function renderTraceList(traces) {
        if (traces.length === 0) {
          contentEl.innerHTML = '<div id="empty-state">No traces recorded yet.</div>';
          return;
        }
        contentEl.innerHTML = traces.map(t =>
          '<div class="trace-item" data-id="' + t.traceId + '">' +
            '<span class="trace-date">' + formatDate(t.startTime) + '</span>' +
            '<span class="trace-duration">' + formatDuration(t.durationMs) + '</span>' +
            '<span class="trace-spans">' + t.spanCount + ' spans</span>' +
            '<span class="trace-status ' + t.status + '">' + t.status.toUpperCase() + '</span>' +
          '</div>'
        ).join('');

        contentEl.querySelectorAll('.trace-item').forEach(el => {
          el.addEventListener('click', () => {
            const traceId = el.dataset.id;
            vscode.postMessage({ type: 'requestTraceDetail', traceId: traceId });
            vscode.postMessage({ type: 'requestTraceMetrics', traceId: traceId });
          });
        });
      }

      function renderWaterfall(spans) {
        if (spans.length === 0) {
          waterfallEl.innerHTML = '<div id="empty-state">No spans in this trace.</div>';
          return;
        }

        const traceStart = Math.min(...spans.map(s => s.startTime));
        const traceEnd = Math.max(...spans.map(s => s.endTime || s.startTime));
        const totalDuration = Math.max(traceEnd - traceStart, 1);

        waterfallEl.innerHTML = spans.map(s => {
          const left = ((s.startTime - traceStart) / totalDuration * 100).toFixed(1);
          const width = Math.max(((s.durationMs || 1) / totalDuration * 100), 0.5).toFixed(1);
          return '<div class="span-row" data-span=\\'' + escapeHtml(JSON.stringify(s)) + '\\'>' +
            '<span class="span-label" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</span>' +
            '<div class="span-bar-container">' +
              '<div class="span-bar ' + s.kind + '" style="left:' + left + '%;width:' + width + '%" title="' + escapeHtml(s.kind) + '"></div>' +
            '</div>' +
            '<span class="span-duration">' + formatDuration(s.durationMs) + '</span>' +
          '</div>';
        }).join('');

        waterfallEl.querySelectorAll('.span-row').forEach(el => {
          el.addEventListener('click', () => {
            try {
              const span = JSON.parse(el.dataset.span);
              renderSpanDetail(span);
            } catch(e) { /* ignore parse errors */ }
          });
        });

        showDetailView();
      }

      function renderSpanDetail(span) {
        const attrs = span.attributes || {};
        const keys = Object.keys(attrs);
        let html = '<div class="detail-title">' + escapeHtml(span.name) + ' (' + span.kind + ')</div>';
        html += '<div class="detail-row"><span class="detail-key">Status</span><span class="detail-val">' + span.status + '</span></div>';
        html += '<div class="detail-row"><span class="detail-key">Duration</span><span class="detail-val">' + formatDuration(span.durationMs) + '</span></div>';
        html += '<div class="detail-row"><span class="detail-key">Span ID</span><span class="detail-val">' + span.spanId + '</span></div>';
        if (span.parentSpanId) {
          html += '<div class="detail-row"><span class="detail-key">Parent</span><span class="detail-val">' + span.parentSpanId + '</span></div>';
        }
        for (const key of keys) {
          html += '<div class="detail-row"><span class="detail-key">' + escapeHtml(key) + '</span><span class="detail-val">' + escapeHtml(String(attrs[key])) + '</span></div>';
        }
        if (span.events && span.events.length > 0) {
          html += '<div class="detail-title" style="margin-top:8px;">Events (' + span.events.length + ')</div>';
          for (const ev of span.events) {
            html += '<div class="detail-row"><span class="detail-key">' + escapeHtml(ev.name) + '</span><span class="detail-val">' + formatDate(ev.timestamp) + '</span></div>';
          }
        }
        spanDetailEl.innerHTML = html;
        spanDetailEl.style.display = '';
      }

      function renderMetrics(metrics) {
        metricsBar.innerHTML =
          '<div class="metric-item"><span class="metric-label">Tools:</span><span class="metric-value">' + metrics.toolStepCount + '</span></div>' +
          '<div class="metric-item"><span class="metric-label">LLM:</span><span class="metric-value">' + metrics.llmCallCount + '</span></div>' +
          '<div class="metric-item"><span class="metric-label">Success:</span><span class="metric-value">' + (metrics.successRate * 100).toFixed(0) + '%</span></div>' +
          '<div class="metric-item"><span class="metric-label">Retries:</span><span class="metric-value">' + metrics.retryCount + '</span></div>';
        metricsBar.style.display = '';
      }

      window.addEventListener('message', (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'traceList':
            renderTraceList(msg.traces);
            break;
          case 'traceDetail':
            renderWaterfall(msg.spans);
            break;
          case 'traceMetrics':
            renderMetrics(msg.metrics);
            break;
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}
