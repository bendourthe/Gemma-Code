/**
 * v0.7.0 Phase 5 -- Memory panel webview HTML scaffold. Mirrors the
 * traceDashboard pattern: a single-file CSP-tight HTML document with all
 * styles and JS inlined under a per-render nonce.
 *
 * Five tabs:
 *   1. Instructions  -- raw Markdown view of Instructions.md
 *   2. Memory        -- raw Markdown view of Memory.md
 *   3. Context       -- raw Markdown view of Context.md
 *   4. SQL-backed    -- list of MemoryStore rows grouped by type, with a
 *                       "Promote" action that writes the row into Memory.md
 *                       and deletes it from the SQL store.
 *   5. Archive       -- list of dated archive snapshots with a "Restore"
 *                       action that copies the snapshot back over the live
 *                       three files.
 *
 * Every interactive button posts a typed message to the panel host; no
 * direct fs / sqlite imports run inside the webview iframe.
 */

import { getWebviewHelpersScript } from "./util.js";

export function getMemoryViewHtml(nonce: string, cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script';" />
  <title>Gemma Code Memory</title>
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
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
    }
    .btn-secondary:hover { background: var(--vscode-list-hoverBackground); }

    #tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      overflow-x: auto;
    }
    .tab {
      padding: 6px 12px;
      font-size: 11px;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      opacity: 0.6;
      border-bottom: 2px solid transparent;
      font-family: inherit;
      white-space: nowrap;
    }
    .tab:hover { opacity: 0.9; }
    .tab.active {
      opacity: 1;
      border-bottom-color: var(--vscode-focusBorder, #0078d4);
    }

    #content {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
    }

    .file-toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }
    .file-path {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      opacity: 0.6;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    pre.file-body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--vscode-editor-background, rgba(0,0,0,0.05));
      padding: 10px;
      border-radius: 3px;
      max-height: calc(100vh - 160px);
      overflow-y: auto;
    }

    .sql-group { margin-bottom: 12px; }
    .sql-group-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 4px;
    }
    .sql-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 6px 0;
      border-bottom: 1px solid rgba(128,128,128,0.1);
    }
    .sql-row-content {
      flex: 1;
      font-size: 12px;
      word-break: break-word;
    }
    .sql-row-meta {
      font-size: 10px;
      opacity: 0.5;
      margin-top: 2px;
    }
    .sql-row-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .archive-row {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid rgba(128,128,128,0.1);
    }
    .archive-date {
      flex: 1;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    #empty-state {
      padding: 30px 20px;
      text-align: center;
      opacity: 0.4;
      font-size: 12px;
    }

    #toast {
      position: fixed;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 12px;
      background: var(--vscode-notifications-background, rgba(0,0,0,0.8));
      color: var(--vscode-notifications-foreground, #fff);
      border-radius: 3px;
      font-size: 11px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
      max-width: 80%;
    }
    #toast.visible { opacity: 1; }
  </style>
</head>
<body>
  <div id="header">
    <h2>Memory</h2>
    <button class="btn" id="refresh-btn">Refresh</button>
  </div>
  <div id="tabs">
    <button class="tab active" data-tab="instructions">Instructions</button>
    <button class="tab" data-tab="memory">Memory</button>
    <button class="tab" data-tab="context">Context</button>
    <button class="tab" data-tab="sql">SQL-backed</button>
    <button class="tab" data-tab="archive">Archive</button>
  </div>
  <div id="content">
    <div id="empty-state">Loading memory...</div>
  </div>
  <div id="toast"></div>

  ${getWebviewHelpersScript(nonce)}
  <script nonce="${nonce}">
    (function() {
      'use strict';
      const vscode = acquireVsCodeApi();
      const escapeHtml = window.__gemmaWebviewHelpers.escapeHtml;
      const escapeAttr = window.__gemmaWebviewHelpers.escapeAttr;
      const formatDate = window.__gemmaWebviewHelpers.formatDate;
      const contentEl = document.getElementById('content');
      const tabsEl = document.getElementById('tabs');
      const toastEl = document.getElementById('toast');
      const refreshBtn = document.getElementById('refresh-btn');

      let currentTab = 'instructions';
      let snapshot = null;

      tabsEl.addEventListener('click', function(e) {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const tab = target.dataset.tab;
        if (!tab) return;
        currentTab = tab;
        tabsEl.querySelectorAll('.tab').forEach(function(el) {
          el.classList.toggle('active', el.dataset.tab === currentTab);
        });
        render();
      });

      refreshBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'requestMemorySnapshot' });
      });

      function showToast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('visible');
        setTimeout(function() { toastEl.classList.remove('visible'); }, 2200);
      }

      function buildFileTab(label, path, body) {
        const out = document.createDocumentFragment();
        const toolbar = document.createElement('div');
        toolbar.className = 'file-toolbar';
        const pathEl = document.createElement('span');
        pathEl.className = 'file-path';
        pathEl.title = path || '';
        pathEl.textContent = path || '';
        toolbar.appendChild(pathEl);
        const editBtn = document.createElement('button');
        editBtn.className = 'btn';
        editBtn.textContent = 'Open in editor';
        editBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'openMemoryFile', section: label });
        });
        toolbar.appendChild(editBtn);
        out.appendChild(toolbar);
        const pre = document.createElement('pre');
        pre.className = 'file-body';
        pre.textContent = body && body.length > 0 ? body : '(empty)';
        out.appendChild(pre);
        return out;
      }

      function buildSqlTab(rows) {
        const out = document.createDocumentFragment();
        if (!rows || rows.length === 0) {
          const empty = document.createElement('div');
          empty.id = 'empty-state';
          empty.textContent = 'No SQL-backed memories.';
          out.appendChild(empty);
          return out;
        }
        const groups = new Map();
        rows.forEach(function(row) {
          const list = groups.get(row.type) || [];
          list.push(row);
          groups.set(row.type, list);
        });
        const sortedTypes = Array.from(groups.keys()).sort();
        sortedTypes.forEach(function(type) {
          const group = document.createElement('div');
          group.className = 'sql-group';
          const title = document.createElement('div');
          title.className = 'sql-group-title';
          title.textContent = type + ' (' + groups.get(type).length + ')';
          group.appendChild(title);
          groups.get(type).forEach(function(row) {
            const rowEl = document.createElement('div');
            rowEl.className = 'sql-row';
            const left = document.createElement('div');
            left.className = 'sql-row-content';
            const text = document.createElement('div');
            text.textContent = row.content;
            left.appendChild(text);
            const meta = document.createElement('div');
            meta.className = 'sql-row-meta';
            meta.textContent = 'created ' + formatDate(row.createdAt) +
              (row.accessCount ? ' · ' + row.accessCount + ' accesses' : '');
            left.appendChild(meta);
            rowEl.appendChild(left);
            const actions = document.createElement('div');
            actions.className = 'sql-row-actions';
            const promoteBtn = document.createElement('button');
            promoteBtn.className = 'btn';
            promoteBtn.textContent = 'Promote';
            promoteBtn.title = 'Move into Memory.md and delete from SQL';
            promoteBtn.addEventListener('click', function() {
              vscode.postMessage({ type: 'promoteSqlMemory', id: row.id });
            });
            actions.appendChild(promoteBtn);
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-secondary';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', function() {
              vscode.postMessage({ type: 'deleteSqlMemory', id: row.id });
            });
            actions.appendChild(delBtn);
            rowEl.appendChild(actions);
            group.appendChild(rowEl);
          });
          out.appendChild(group);
        });
        return out;
      }

      function buildArchiveTab(archive) {
        const out = document.createDocumentFragment();
        const toolbar = document.createElement('div');
        toolbar.className = 'file-toolbar';
        const path = document.createElement('span');
        path.className = 'file-path';
        path.title = archive && archive.archiveDir ? archive.archiveDir : '';
        path.textContent = archive && archive.archiveDir ? archive.archiveDir : '';
        toolbar.appendChild(path);
        const archiveBtn = document.createElement('button');
        archiveBtn.className = 'btn';
        archiveBtn.textContent = 'Archive now';
        archiveBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'archiveMemoryNow' });
        });
        toolbar.appendChild(archiveBtn);
        out.appendChild(toolbar);

        const snapshots = (archive && archive.snapshots) || [];
        if (snapshots.length === 0) {
          const empty = document.createElement('div');
          empty.id = 'empty-state';
          empty.textContent = 'No archive snapshots yet. Run /memory archive or click "Archive now".';
          out.appendChild(empty);
          return out;
        }
        snapshots.forEach(function(snap) {
          const row = document.createElement('div');
          row.className = 'archive-row';
          const date = document.createElement('span');
          date.className = 'archive-date';
          date.textContent = snap.date;
          row.appendChild(date);
          const restoreBtn = document.createElement('button');
          restoreBtn.className = 'btn';
          restoreBtn.textContent = 'Restore';
          restoreBtn.title = 'Copy this snapshot over the live three files';
          restoreBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'restoreArchive', date: snap.date });
          });
          row.appendChild(restoreBtn);
          out.appendChild(row);
        });
        return out;
      }

      function render() {
        contentEl.replaceChildren();
        if (!snapshot) {
          const empty = document.createElement('div');
          empty.id = 'empty-state';
          empty.textContent = 'Loading memory...';
          contentEl.appendChild(empty);
          return;
        }
        if (snapshot.workspaceMissing) {
          const empty = document.createElement('div');
          empty.id = 'empty-state';
          empty.textContent = 'Open a workspace folder to view memory.';
          contentEl.appendChild(empty);
          return;
        }
        switch (currentTab) {
          case 'instructions':
            contentEl.appendChild(buildFileTab('instructions', snapshot.instructionsPath, snapshot.instructions));
            break;
          case 'memory':
            contentEl.appendChild(buildFileTab('memory', snapshot.memoryPath, snapshot.memory));
            break;
          case 'context':
            contentEl.appendChild(buildFileTab('context', snapshot.contextPath, snapshot.context));
            break;
          case 'sql':
            contentEl.appendChild(buildSqlTab(snapshot.sqlMemories || []));
            break;
          case 'archive':
            contentEl.appendChild(buildArchiveTab(snapshot.archive || { archiveDir: '', snapshots: [] }));
            break;
          default:
            break;
        }
      }

      window.addEventListener('message', function(e) {
        const msg = e.data;
        switch (msg.type) {
          case 'memorySnapshot':
            snapshot = msg;
            render();
            break;
          case 'memoryToast':
            showToast(msg.text);
            break;
          default:
            break;
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}
