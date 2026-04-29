/**
 * Returns the complete HTML for the trace dashboard webview.
 * Self-contained: all CSS and JS are inlined.
 */
import { getWebviewHelpersScript } from "./util.js";

export function getTraceDashboardHtml(
  nonce: string,
  cspSource: string,
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script';" />
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

    /* Phase 9: cache observability panels */
    #cache-panels {
      display: none;
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
    }
    .cache-panel { margin-bottom: 8px; }
    .cache-panel-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 4px;
    }
    .cache-row { display: flex; gap: 16px; align-items: baseline; }
    .cache-pair { display: flex; gap: 4px; }
    .cache-key { opacity: 0.6; }
    .cache-val { font-weight: 600; }
    .cache-top-list {
      list-style: none;
      padding-left: 0;
      margin: 4px 0 0 0;
    }
    .cache-top-list li {
      display: flex;
      gap: 6px;
      font-size: 10px;
      opacity: 0.8;
    }
    .cache-top-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div id="header">
    <h2>Traces</h2>
    <button class="btn" id="refresh-btn">Refresh</button>
  </div>
  <div id="metrics-bar" style="display:none;"></div>
  <div id="cache-panels"></div>
  <div id="back-btn">&larr; Back to trace list</div>
  <div id="content">
    <div id="empty-state">No traces recorded yet.</div>
  </div>
  <div id="waterfall"></div>
  <div id="span-detail"></div>

  ${getWebviewHelpersScript(nonce)}
  <script nonce="${nonce}">
    (function() {
      'use strict';
      const vscode = acquireVsCodeApi();
      const escapeHtml = window.__gemmaWebviewHelpers.escapeHtml;
      const escapeAttr = window.__gemmaWebviewHelpers.escapeAttr;
      const contentEl = document.getElementById('content');
      const waterfallEl = document.getElementById('waterfall');
      const spanDetailEl = document.getElementById('span-detail');
      const backBtn = document.getElementById('back-btn');
      const refreshBtn = document.getElementById('refresh-btn');
      const metricsBar = document.getElementById('metrics-bar');
      const cachePanelsEl = document.getElementById('cache-panels');
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

      const formatDate = window.__gemmaWebviewHelpers.formatDate;

      function formatDuration(ms) {
        if (ms == null || ms === 0) return '-';
        if (ms < 1000) return ms + 'ms';
        return (ms / 1000).toFixed(1) + 's';
      }

      function createMetricItem(label, value) {
        const item = document.createElement('div');
        item.className = 'metric-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'metric-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.className = 'metric-value';
        valueEl.textContent = value;
        item.appendChild(labelEl);
        item.appendChild(valueEl);
        return item;
      }

      function renderTraceList(traces) {
        if (traces.length === 0) {
          contentEl.innerHTML = '<div id="empty-state">No traces recorded yet.</div>';
          return;
        }
        contentEl.innerHTML = traces.map(t =>
          '<div class="trace-item" data-id="' + escapeAttr(t.traceId) + '">' +
            '<span class="trace-date">' + escapeHtml(formatDate(t.startTime)) + '</span>' +
            '<span class="trace-duration">' + escapeHtml(formatDuration(t.durationMs)) + '</span>' +
            '<span class="trace-spans">' + escapeHtml(String(t.spanCount)) + ' spans</span>' +
            '<span class="trace-status ' + escapeAttr(t.status) + '">' + escapeHtml(String(t.status).toUpperCase()) + '</span>' +
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
          return '<div class="span-row" data-span="' + escapeAttr(JSON.stringify(s)) + '">' +
            '<span class="span-label" title="' + escapeAttr(s.name) + '">' + escapeHtml(s.name) + '</span>' +
            '<div class="span-bar-container">' +
              '<div class="span-bar ' + escapeAttr(s.kind) + '" style="left:' + left + '%;width:' + width + '%" title="' + escapeAttr(s.kind) + '"></div>' +
            '</div>' +
            '<span class="span-duration">' + escapeHtml(formatDuration(s.durationMs)) + '</span>' +
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
        let html = '<div class="detail-title">' + escapeHtml(span.name) + ' (' + escapeHtml(span.kind) + ')</div>';
        html += '<div class="detail-row"><span class="detail-key">Status</span><span class="detail-val">' + escapeHtml(span.status) + '</span></div>';
        html += '<div class="detail-row"><span class="detail-key">Duration</span><span class="detail-val">' + escapeHtml(formatDuration(span.durationMs)) + '</span></div>';
        html += '<div class="detail-row"><span class="detail-key">Span ID</span><span class="detail-val">' + escapeHtml(span.spanId) + '</span></div>';
        if (span.parentSpanId) {
          html += '<div class="detail-row"><span class="detail-key">Parent</span><span class="detail-val">' + escapeHtml(span.parentSpanId) + '</span></div>';
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

      function formatBytes(n) {
        if (n == null || isNaN(n)) return '0 B';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
      }

      function renderCachePanels(payload) {
        if (!payload) {
          cachePanelsEl.style.display = 'none';
          cachePanelsEl.innerHTML = '';
          return;
        }
        const tool = payload.toolOutputCache || { entries: 0, hits: 0, misses: 0, bytes: 0, topByHits: [] };
        const web = payload.webResponseCache;
        const compTotal = tool.hits + tool.misses;
        const toolHitRate = compTotal === 0 ? 0 : tool.hits / compTotal;
        const webTotal = web ? web.hits + web.misses : 0;
        const webHitRate = webTotal === 0 ? 0 : web.hits / webTotal;

        let html = '';
        html += '<div class="cache-panel">';
        html += '<div class="cache-panel-title">Compression savings</div>';
        html += '<div class="cache-row">' +
          '<span class="cache-pair"><span class="cache-key">Saved:</span><span class="cache-val">' + escapeHtml(formatBytes(payload.compressionSavedBytes)) + '</span></span>' +
          '<span class="cache-pair"><span class="cache-key">Original:</span><span class="cache-val">' + escapeHtml(formatBytes(payload.compressionOriginalBytes)) + '</span></span>' +
          '<span class="cache-pair"><span class="cache-key">Compressed:</span><span class="cache-val">' + escapeHtml(formatBytes(payload.compressionCompressedBytes)) + '</span></span>' +
          '</div>';
        html += '</div>';

        html += '<div class="cache-panel">';
        html += '<div class="cache-panel-title">Cache hit rate</div>';
        html += '<div class="cache-row">' +
          '<span class="cache-pair"><span class="cache-key">tool-output:</span><span class="cache-val">' + (toolHitRate * 100).toFixed(0) + '%</span></span>' +
          '<span class="cache-pair"><span class="cache-key">hits/misses:</span><span class="cache-val">' + tool.hits + '/' + tool.misses + '</span></span>' +
          (web
            ? '<span class="cache-pair"><span class="cache-key">web:</span><span class="cache-val">' + (webHitRate * 100).toFixed(0) + '%</span></span>' +
              '<span class="cache-pair"><span class="cache-key">hits/misses:</span><span class="cache-val">' + web.hits + '/' + web.misses + '</span></span>'
            : '<span class="cache-pair"><span class="cache-key">web:</span><span class="cache-val">disabled</span></span>') +
          '</div>';
        html += '</div>';

        html += '<div class="cache-panel">';
        html += '<div class="cache-panel-title">Top cached files (' + tool.entries + ' total)</div>';
        if (tool.topByHits.length === 0) {
          html += '<div class="cache-pair" style="opacity:0.5;">No cached files yet.</div>';
        } else {
          html += '<ul class="cache-top-list">';
          for (let i = 0; i < tool.topByHits.length && i < 10; i++) {
            const row = tool.topByHits[i];
            html += '<li>' +
              '<span class="cache-top-path" title="' + escapeAttr(row.absolutePath) + '">' + escapeHtml(row.absolutePath) + '</span>' +
              '<span class="cache-val">' + row.hits + '</span>' +
            '</li>';
          }
          html += '</ul>';
        }
        html += '</div>';

        cachePanelsEl.innerHTML = html;
        cachePanelsEl.style.display = '';
      }

      function renderMetrics(metrics) {
        metricsBar.replaceChildren(
          createMetricItem('Tools:', String(metrics.toolStepCount)),
          createMetricItem('LLM:', String(metrics.llmCallCount)),
          createMetricItem('Success:', (metrics.successRate * 100).toFixed(0) + '%'),
          createMetricItem('Retries:', String(metrics.retryCount)),
        );
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
          case 'cacheStats':
            renderCachePanels(msg);
            break;
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}
