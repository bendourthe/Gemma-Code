import { DIFF_CARD_FN_SOURCE } from "./render/diffCard.js";
import { ACTION_TAG_FN_SOURCE } from "./render/actionTag.js";
import { PERMISSION_PROMPT_FN_SOURCE } from "./render/permissionPrompt.js";
import { TODO_BLOCK_FN_SOURCE } from "./render/todoBlock.js";
import { THOUGHT_META_ROW_FN_SOURCE } from "./render/thoughtMetaRow.js";
import { QUEUED_MESSAGE_FIELD_FN_SOURCE } from "./render/queuedMessageField.js";
import { COMPLETION_REPORT_FN_SOURCE } from "./render/completionReport.js";

/**
 * The IIFE that runs in the webview context. Loaded inline into the HTML
 * scaffold under a `script` tag with a per-render nonce; the CSP enforces
 * that no other scripts may execute. Update DOM helpers, message handlers,
 * and the autocomplete UI here.
 *
 * Kept as a single string because the script forms one closure (the IIFE
 * captures every helper, references run forward and back, and DOM lookups
 * happen at IIFE start). Splitting it into typed TS modules requires an
 * esbuild bundle step; that is deferred to v0.7.0 (Phase 6 source-level
 * split only).
 *
 * v0.7.0 Phase 4: each render primitive lives in `./render/*.ts` and is
 * inlined here as a pre-stringified function source, so the same code is
 * used in tests (jsdom + new Function) and at runtime (template inline).
 */
export const RUNTIME_SCRIPT = String.raw`
    (function () {
      'use strict';

      // ---------------------------------------------------------------------
      // v0.7.0 Phase 4 -- render primitives (single source of truth in
      // src/panels/webview/render/*.ts; inlined here at build time).
      // ---------------------------------------------------------------------
` +
  DIFF_CARD_FN_SOURCE +
  ACTION_TAG_FN_SOURCE +
  PERMISSION_PROMPT_FN_SOURCE +
  TODO_BLOCK_FN_SOURCE +
  THOUGHT_META_ROW_FN_SOURCE +
  QUEUED_MESSAGE_FIELD_FN_SOURCE +
  COMPLETION_REPORT_FN_SOURCE +
  String.raw`

      const vscode = acquireVsCodeApi();

      // -----------------------------------------------------------------------
      // DOM references
      // -----------------------------------------------------------------------
      const messagesEl      = /** @type {HTMLElement} */ (document.getElementById('messages'));
      const historyPanel    = /** @type {HTMLElement} */ (document.getElementById('history-panel'));
      const historyListEl   = /** @type {HTMLElement} */ (document.getElementById('history-list'));
      const historyCloseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('history-close-btn'));
      const inputEl         = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
      const sendBtn         = /** @type {HTMLButtonElement} */ (document.getElementById('send-btn'));
      const cancelBtn       = /** @type {HTMLButtonElement} */ (document.getElementById('cancel-btn'));
      const clearBtn        = /** @type {HTMLButtonElement} */ (document.getElementById('clear-btn'));
      const newChatBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('new-chat-btn'));
      const historyBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('history-btn'));
      const thinkingEl      = /** @type {HTMLElement} */ (document.getElementById('thinking'));
      const statusDot       = /** @type {HTMLElement} */ (document.getElementById('status-dot'));
      const sessionTitleEl  = /** @type {HTMLElement} */ (document.getElementById('session-title'));
      const planBadge       = /** @type {HTMLElement} */ (document.getElementById('plan-badge'));
      const thinkingBadge   = /** @type {HTMLElement} */ (document.getElementById('thinking-mode-badge'));
      const memoryBadge     = /** @type {HTMLElement} */ (document.getElementById('memory-badge'));
      const mcpBadge        = /** @type {HTMLElement} */ (document.getElementById('mcp-badge'));
      const tokenCounter    = /** @type {HTMLElement} */ (document.getElementById('token-counter'));
      const compactionBanner= /** @type {HTMLElement} */ (document.getElementById('compaction-banner'));
      const subAgentBanner  = /** @type {HTMLElement} */ (document.getElementById('sub-agent-banner'));
      const editModeSelector= /** @type {HTMLElement} */ (document.getElementById('edit-mode-selector'));
      const autocompleteEl  = /** @type {HTMLElement} */ (document.getElementById('autocomplete'));
      const planPanel       = /** @type {HTMLElement} */ (document.getElementById('plan-panel'));
      const planStepsEl     = /** @type {HTMLElement} */ (document.getElementById('plan-steps'));

      // -----------------------------------------------------------------------
      // State
      // -----------------------------------------------------------------------
      let streaming = false;
      /** @type {HTMLElement | null} */
      let streamingBubble = null;
      let streamingContent = '';
      /** @type {string | null} — message id of the bubble currently streaming */
      let streamingMessageId = null;

      /** @type {Array<{name: string, description: string, argumentHint?: string}>} */
      let commandList = [];
      let autocompleteIndex = -1;

      /** @type {string[]} */
      let planSteps = [];

      /** @type {string} — current edit mode */
      let currentEditMode = 'ask';

      // -----------------------------------------------------------------------
      // Autocomplete
      // -----------------------------------------------------------------------

      function showAutocomplete() {
        const val = inputEl.value;
        if (!val.startsWith('/')) { hideAutocomplete(); return; }
        const query = val.slice(1).toLowerCase();
        const matches = commandList.filter(
          (c) => c.name.startsWith(query) || c.description.toLowerCase().includes(query)
        );
        if (matches.length === 0) { hideAutocomplete(); return; }

        autocompleteEl.innerHTML = '';
        autocompleteIndex = -1;

        matches.forEach((cmd, i) => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          item.setAttribute('role', 'option');
          item.dataset.index = String(i);

          const nameSpan = document.createElement('span');
          nameSpan.className = 'cmd-name';
          nameSpan.textContent = '/' + cmd.name;

          const hintSpan = document.createElement('span');
          hintSpan.className = 'cmd-hint';
          hintSpan.textContent = cmd.argumentHint ?? '';

          const descSpan = document.createElement('span');
          descSpan.className = 'cmd-desc';
          descSpan.textContent = cmd.description;

          item.appendChild(nameSpan);
          if (cmd.argumentHint) item.appendChild(hintSpan);
          item.appendChild(descSpan);

          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectAutocompleteItem(cmd.name);
          });

          autocompleteEl.appendChild(item);
        });

        autocompleteEl.classList.add('visible');
      }

      function hideAutocomplete() {
        autocompleteEl.classList.remove('visible');
        autocompleteEl.innerHTML = '';
        autocompleteIndex = -1;
      }

      /** @param {string} name */
      function selectAutocompleteItem(name) {
        inputEl.value = '/' + name + ' ';
        hideAutocomplete();
        inputEl.focus();
      }

      function autocompleteNavigate(direction) {
        const items = autocompleteEl.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return false;
        items[autocompleteIndex]?.classList.remove('selected');
        autocompleteIndex = (autocompleteIndex + direction + items.length) % items.length;
        const selected = items[autocompleteIndex];
        selected?.classList.add('selected');
        selected?.scrollIntoView({ block: 'nearest' });
        return true;
      }

      // -----------------------------------------------------------------------
      // Edit mode selector
      // -----------------------------------------------------------------------

      editModeSelector.querySelectorAll('.edit-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = /** @type {HTMLElement} */ (btn).dataset.mode;
          if (mode && mode !== currentEditMode) {
            vscode.postMessage({ type: 'setEditMode', mode });
          }
        });
      });

      /** @param {string} mode */
      const modeDescEl = /** @type {HTMLElement} */ (document.getElementById('mode-desc'));
      const modeDescriptions = {
        ask: 'Ask before edits',
        auto: 'Auto-accept changes',
        plan: 'Plan before acting',
      };

      function applyEditMode(mode) {
        currentEditMode = mode;
        editModeSelector.querySelectorAll('.edit-mode-btn').forEach((btn) => {
          btn.classList.toggle('active', /** @type {HTMLElement} */ (btn).dataset.mode === mode);
        });
        modeDescEl.textContent = modeDescriptions[mode] || '';
      }

      // -----------------------------------------------------------------------
      // History panel
      // -----------------------------------------------------------------------

      historyCloseBtn.addEventListener('click', () => {
        historyPanel.classList.remove('visible');
        messagesEl.style.display = '';
        thinkingEl.style.display = '';
      });

      /**
       * @param {Array<{id: string, title: string, updatedAt: number}>} sessions
       */
      function renderHistoryPanel(sessions) {
        historyListEl.innerHTML = '';

        if (sessions.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'text-align:center;padding:20px;opacity:0.5;font-size:12px;';
          empty.textContent = 'No saved sessions yet.';
          historyListEl.appendChild(empty);
        } else {
          for (const session of sessions) {
            const item = document.createElement('div');
            item.className = 'session-item';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', 'Load session: ' + session.title);

            const titleEl = document.createElement('div');
            titleEl.className = 'session-title';
            titleEl.textContent = session.title;

            const dateEl = document.createElement('div');
            dateEl.className = 'session-date';
            dateEl.textContent = new Date(session.updatedAt).toLocaleString();

            item.appendChild(titleEl);
            item.appendChild(dateEl);

            item.addEventListener('click', () => {
              vscode.postMessage({ type: 'loadSession', sessionId: session.id });
              historyPanel.classList.remove('visible');
              messagesEl.style.display = '';
              thinkingEl.style.display = '';
            });

            item.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.click();
              }
            });

            historyListEl.appendChild(item);
          }
        }

        // Show history panel, hide chat messages.
        messagesEl.style.display = 'none';
        thinkingEl.style.display = 'none';
        historyPanel.classList.add('visible');
      }

      // -----------------------------------------------------------------------
      // Plan mode
      // -----------------------------------------------------------------------

      /** @param {string[]} steps */
      function renderPlanPanel(steps) {
        planSteps = steps;
        planStepsEl.innerHTML = '';

        steps.forEach((desc, i) => {
          const row = document.createElement('div');
          row.className = 'plan-step';
          row.dataset.step = String(i);

          const numEl = document.createElement('span');
          numEl.className = 'plan-step-num';
          numEl.textContent = String(i + 1) + '.';

          const descEl = document.createElement('span');
          descEl.className = 'plan-step-desc';
          descEl.textContent = desc;

          const statusEl = document.createElement('span');
          statusEl.className = 'plan-step-status';
          statusEl.dataset.forStep = String(i);

          const approveBtn = document.createElement('button');
          approveBtn.className = 'approve-btn';
          approveBtn.textContent = 'Approve';
          approveBtn.dataset.forStep = String(i);
          approveBtn.addEventListener('click', () => {
            approveBtn.disabled = true;
            approveBtn.textContent = '…';
            statusEl.className = 'plan-step-status approved';
            statusEl.textContent = '●';
            vscode.postMessage({ type: 'approveStep', step: i });
          });

          row.appendChild(numEl);
          row.appendChild(descEl);
          row.appendChild(statusEl);
          row.appendChild(approveBtn);
          planStepsEl.appendChild(row);
        });

        planPanel.classList.add('visible');
      }

      function hidePlanPanel() {
        planPanel.classList.remove('visible');
        planStepsEl.innerHTML = '';
        planSteps = [];
      }

      // -----------------------------------------------------------------------
      // Diff renderer
      // -----------------------------------------------------------------------

      /**
       * Render a unified diff string as coloured lines.
       * @param {string} diff
       * @returns {string} HTML
       */
      function renderDiff(diff) {
        const lines = diff.split('\\n');
        const parts = lines.map((line) => {
          const esc = escapeTextToHtml(line);
          if (line.startsWith('+') && !line.startsWith('+++')) {
            return '<span class="diff-line-add">' + esc + '</span>';
          }
          if (line.startsWith('-') && !line.startsWith('---')) {
            return '<span class="diff-line-del">' + esc + '</span>';
          }
          if (line.startsWith('@@')) {
            return '<span class="diff-line-hunk">' + esc + '</span>';
          }
          return esc;
        });
        return parts.join('\\n');
      }

      // -----------------------------------------------------------------------
      // UI helpers
      // -----------------------------------------------------------------------

      /** @param {'user' | 'assistant' | 'error'} role @param {string} html */
      function appendBubble(role, html) {
        const div = document.createElement('div');
        div.className = 'msg ' + role;
        div.innerHTML = html;
        messagesEl.appendChild(div);
        scrollToBottom();
        return div;
      }

      function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function setStreaming(on) {
        streaming = on;
        inputEl.disabled = on;
        sendBtn.hidden = on;
        cancelBtn.hidden = !on;
        sendBtn.disabled = on;
      }

      /** @param {'idle' | 'thinking' | 'streaming'} state */
      function applyStatus(state) {
        statusDot.className = state;
        thinkingEl.classList.toggle('visible', state === 'thinking');
      }

      /** @param {number} count @param {number} limit */
      function fmtNum(n) {
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }

      function updateTokenCounter(count, limit) {
        if (limit <= 0) {
          tokenCounter.textContent = count > 0 ? 'Context: ' + fmtNum(count) : '';
          tokenCounter.className = '';
          return;
        }
        const pct = Math.round((count / limit) * 100);
        tokenCounter.textContent = 'Context: ' + fmtNum(count) + ' / ' + fmtNum(limit) + ' (' + pct + '%)';
        tokenCounter.className =
          pct >= 80 ? 'danger' : pct >= 60 ? 'warn' : '';
      }

      // -----------------------------------------------------------------------
      // Wire copy buttons (event delegation for dynamically added elements)
      // -----------------------------------------------------------------------

      messagesEl.addEventListener('click', (e) => {
        const btn = /** @type {HTMLElement} */ (e.target);
        if (!btn.classList.contains('copy-btn')) return;
        const code = btn.dataset.code ?? '';
        navigator.clipboard.writeText(code).then(() => {
          const prev = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = prev; }, 1500);
        }).catch(() => {});
      });

      // Open external links in the system browser.
      messagesEl.addEventListener('click', (e) => {
        const a = /** @type {HTMLElement} */ (e.target);
        if (!a.classList.contains('ext-link')) return;
        e.preventDefault();
        const href = a.dataset.href ?? a.getAttribute('href') ?? '';
        if (href) vscode.postMessage({ type: 'sendMessage', text: '' }); // no-op; handled by ext
        // vscode.env.openExternal is not available in webview JS;
        // opening links is handled by the extension side via a postMessage if needed.
        window.open(href, '_blank');
      });

      // -----------------------------------------------------------------------
      // History rendering
      // -----------------------------------------------------------------------

      /**
       * @param {readonly {id: string, role: string, content: string}[]} messages
       * @param {Record<string, string>} renderedHtmlMap
       */
      function renderHistory(messages, renderedHtmlMap) {
        messagesEl.innerHTML = '';
        for (const msg of messages) {
          if (msg.role === 'user') {
            const div = document.createElement('div');
            div.className = 'msg user';
            div.textContent = msg.content;
            messagesEl.appendChild(div);
          } else if (msg.role === 'assistant') {
            const html = renderedHtmlMap[msg.id] ?? escapeTextToHtml(msg.content);
            appendBubble('assistant', html);
          }
        }
        scrollToBottom();
      }

      // -----------------------------------------------------------------------
      // Message handlers
      // -----------------------------------------------------------------------

      window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'history':
            renderHistory(msg.messages, msg.renderedHtmlMap ?? {});
            break;

          case 'status':
            applyStatus(msg.state);
            if (msg.state === 'streaming') {
              setStreaming(true);
              streamingContent = '';
              const bubble = document.createElement('div');
              bubble.className = 'msg assistant streaming';
              messagesEl.appendChild(bubble);
              streamingBubble = bubble;
              scrollToBottom();
            } else if (msg.state === 'thinking') {
              if (streamingBubble) {
                streamingBubble.remove();
                streamingBubble = null;
                streamingContent = '';
                streamingMessageId = null;
              }
              setStreaming(true);
            } else {
              // idle
              setStreaming(false);
            }
            break;

          case 'token':
            if (streamingBubble) {
              streamingContent += msg.value;
              // Show raw text during streaming for performance.
              streamingBubble.textContent = streamingContent;
              scrollToBottom();
            }
            break;

          case 'messageComplete':
            // Swap in pre-rendered HTML now that the stream is complete.
            if (streamingBubble) {
              if (msg.renderedHtml) {
                streamingBubble.className = 'msg assistant';
                streamingBubble.innerHTML = msg.renderedHtml;
              }
              streamingBubble = null;
              streamingContent = '';
              streamingMessageId = null;
            }
            break;

          case 'error':
            applyStatus('idle');
            setStreaming(false);
            if (streamingBubble) {
              streamingBubble.remove();
              streamingBubble = null;
              streamingContent = '';
              streamingMessageId = null;
            }
            appendBubble('error', escapeTextToHtml(msg.text));
            break;

          case 'toolUse': {
            const indicator = document.createElement('div');
            indicator.className = 'tool-use';
            indicator.dataset.callId = msg.callId;
            indicator.textContent = 'Using tool: ' + msg.toolName + '…';
            messagesEl.appendChild(indicator);
            scrollToBottom();
            break;
          }

          case 'toolResult': {
            const indicator = messagesEl.querySelector('[data-call-id="' + msg.callId + '"]');
            if (indicator) indicator.remove();

            const details = document.createElement('details');
            details.className = 'tool-result';
            const summary = document.createElement('summary');
            summary.className = msg.success ? 'success' : 'failure';
            summary.textContent = (msg.success ? '✓' : '✗') + ' Tool result';
            const pre = document.createElement('pre');
            pre.textContent = msg.summary;
            details.appendChild(summary);
            details.appendChild(pre);
            messagesEl.appendChild(details);
            scrollToBottom();
            break;
          }

          case 'commandList':
            commandList = msg.commands;
            if (inputEl.value.startsWith('/')) showAutocomplete();
            break;

          case 'planReady':
            renderPlanPanel(msg.steps);
            break;

          case 'planModeToggled':
            planBadge.classList.toggle('active', msg.active);
            if (!msg.active) hidePlanPanel();
            break;

          case 'tokenCount':
            updateTokenCounter(msg.count, msg.limit);
            break;

          case 'compactionStatus':
            if (msg.text) {
              compactionBanner.textContent = msg.text;
              compactionBanner.classList.add('visible');
            } else {
              compactionBanner.classList.remove('visible');
              compactionBanner.textContent = '';
            }
            break;

          case 'subAgentStatus': {
            const labels = {
              verification: 'Verification',
              research: 'Research',
              planning: 'Planning',
              'audit-worker': 'Audit',
              'testgaps-worker': 'Test Gaps',
            };
            const label = labels[msg.agentType] || msg.agentType;
            subAgentBanner.classList.remove('error');
            const labelEl = document.createElement('strong');
            labelEl.textContent = label;
            if (msg.state === 'running') {
              const spinner = document.createElement('span');
              spinner.className = 'sub-agent-spinner';
              const suffix = document.createTextNode(' agent running\u2026');
              subAgentBanner.replaceChildren(spinner, labelEl, suffix);
              subAgentBanner.classList.add('visible');
            } else if (msg.state === 'complete') {
              subAgentBanner.replaceChildren(labelEl, document.createTextNode(' agent complete.'));
              subAgentBanner.classList.add('visible');
              setTimeout(() => {
                subAgentBanner.classList.remove('visible');
                subAgentBanner.replaceChildren();
              }, 3000);
            } else if (msg.state === 'error') {
              const summary = msg.summary || 'unknown';
              subAgentBanner.replaceChildren(
                labelEl,
                document.createTextNode(' agent error: ' + summary),
              );
              subAgentBanner.classList.add('visible', 'error');
              setTimeout(() => {
                subAgentBanner.classList.remove('visible', 'error');
                subAgentBanner.replaceChildren();
              }, 5000);
            }
            break;
          }

          case 'memoryStatus': {
            if (msg.enabled) {
              memoryBadge.className = 'active';
              memoryBadge.title = 'Memory: ' + msg.entryCount + ' entries';
            } else {
              memoryBadge.className = 'off';
              memoryBadge.title = 'Memory: disabled';
            }
            break;
          }

          case 'mcpStatus': {
            if (!msg.enabled) {
              mcpBadge.className = '';
              mcpBadge.title = 'MCP: disabled';
            } else if (msg.connectedServerCount > 0) {
              mcpBadge.className = 'connected';
              mcpBadge.title = 'MCP: ' + msg.connectedServerCount + ' server(s), ' + msg.totalToolCount + ' tools';
            } else {
              mcpBadge.className = 'disconnected';
              mcpBadge.title = 'MCP: no servers connected';
            }
            break;
          }

          case 'thinkingModeStatus': {
            thinkingBadge.classList.toggle('active', msg.active);
            break;
          }

          case 'editModeChanged':
            applyEditMode(msg.mode);
            break;

          case 'sessionList':
            renderHistoryPanel(msg.sessions);
            break;

          case 'diffPreview': {
            const details = document.createElement('details');
            details.className = 'diff-preview';
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = (msg.requiresConfirmation ? '📝 ' : '👁 ') + msg.filePath;
            const pre = document.createElement('pre');
            pre.innerHTML = renderDiff(msg.diff);
            details.appendChild(summary);
            details.appendChild(pre);
            messagesEl.appendChild(details);
            scrollToBottom();
            break;
          }

          // ---- v0.7.0 Phase 4 render protocol -----------------------------

          case 'renderToolCallStarted': {
            const tag = renderActionTag(msg.toolName, msg.params || {}, 'started');
            tag.dataset.callId = msg.callId;
            messagesEl.appendChild(tag);
            scrollToBottom();
            break;
          }

          case 'renderToolCallCompleted': {
            const existing = messagesEl.querySelector('[data-call-id="' + msg.callId + '"]');
            if (existing) existing.remove();
            const tag = renderActionTag(msg.toolName, {}, 'completed', msg.badge);
            tag.dataset.callId = msg.callId;
            messagesEl.appendChild(tag);
            if (msg.diff) {
              const card = renderDiffCard(msg.diff.before, msg.diff.after, msg.diff.filePath);
              card.dataset.callId = msg.callId;
              messagesEl.appendChild(card);
            }
            scrollToBottom();
            break;
          }

          case 'renderToolCallFailed': {
            const existing = messagesEl.querySelector('[data-call-id="' + msg.callId + '"]');
            if (existing) existing.remove();
            const tag = renderActionTag(msg.toolName, {}, 'failed', msg.error);
            tag.dataset.callId = msg.callId;
            messagesEl.appendChild(tag);
            scrollToBottom();
            break;
          }

          case 'renderTodoUpdate': {
            // Replace any prior todo block; the agent submits the FULL list every time.
            const prior = messagesEl.querySelector('.todo-block');
            if (prior) prior.remove();
            const block = renderTodoBlock(msg.todos);
            messagesEl.appendChild(block);
            scrollToBottom();
            break;
          }

          case 'renderCompactionEvent': {
            if (msg.text) {
              compactionBanner.textContent = msg.text;
              compactionBanner.classList.add('visible');
            } else {
              compactionBanner.classList.remove('visible');
              compactionBanner.textContent = '';
            }
            break;
          }

          case 'renderCompletionReport': {
            const card = renderCompletionReport(msg.items || []);
            if (!card.classList.contains('completion-report-empty')) {
              messagesEl.appendChild(card);
              scrollToBottom();
            }
            break;
          }

          case 'renderThoughtMetaRow': {
            // Replace any prior meta-row so the row finalises to "Thought for Ns".
            const prior = messagesEl.querySelector('.thought-meta-row');
            if (prior) prior.remove();
            if (msg.status === 'thinking' || (msg.status === 'complete' && msg.durationMs && msg.durationMs > 250)) {
              const row = renderThoughtMetaRow(msg.status, msg.durationMs);
              messagesEl.appendChild(row);
              scrollToBottom();
            }
            break;
          }

          case 'renderPermissionPrompt': {
            const card = renderPermissionPrompt(msg, function (resolution) {
              vscode.postMessage({
                type: 'permissionPromptResponse',
                id: msg.id,
                value: resolution.value,
                freeformText: resolution.freeformText
              });
            });
            messagesEl.appendChild(card);
            scrollToBottom();
            break;
          }

          // ---- legacy confirmation card (kept for backwards compatibility) ----

          case 'confirmationRequest': {
            const card = document.createElement('div');
            card.className = 'confirm-card';
            card.dataset.confirmId = msg.id;

            const desc = document.createElement('p');
            desc.textContent = msg.description;
            card.appendChild(desc);

            if (msg.detail) {
              const pre = document.createElement('pre');
              pre.textContent = msg.detail;
              card.appendChild(pre);
            }

            const btnRow = document.createElement('div');
            btnRow.className = 'confirm-buttons';

            const approveBtn = document.createElement('button');
            approveBtn.textContent = '✓ Apply';
            approveBtn.setAttribute('aria-label', 'Apply change');
            approveBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'confirmationResponse', id: msg.id, approved: true });
              card.remove();
            });

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'secondary';
            rejectBtn.textContent = '✗ Skip';
            rejectBtn.setAttribute('aria-label', 'Skip change');
            rejectBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'confirmationResponse', id: msg.id, approved: false });
              card.remove();
            });

            btnRow.appendChild(approveBtn);
            btnRow.appendChild(rejectBtn);
            card.appendChild(btnRow);
            messagesEl.appendChild(card);
            scrollToBottom();
            break;
          }
        }
      });

      /** @param {string} s */
      function escapeTextToHtml(s) {
        return s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      // -----------------------------------------------------------------------
      // User interactions
      // -----------------------------------------------------------------------

      function sendMessage() {
        const text = inputEl.value.trim();
        if (!text || streaming) return;

        const div = document.createElement('div');
        div.className = 'msg user';
        div.textContent = text;
        messagesEl.appendChild(div);
        scrollToBottom();

        inputEl.value = '';
        autoResize();
        inputEl.focus();

        vscode.postMessage({ type: 'sendMessage', text });

        // Auto-title the session from the first user message.
        if (sessionTitleEl.textContent === 'New Session' && !text.startsWith('/')) {
          const title = text.length > 50 ? text.slice(0, 47) + '...' : text;
          sessionTitleEl.textContent = title;
        }
      }

      sendBtn.addEventListener('click', sendMessage);

      cancelBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelStream' });
      });

      clearBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearChat' });
      });

      newChatBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearChat' });
        sessionTitleEl.textContent = 'New Session';
      });

      // Double-click session title to rename it.
      sessionTitleEl.addEventListener('dblclick', () => {
        sessionTitleEl.contentEditable = 'true';
        sessionTitleEl.focus();
        // Select all text.
        const range = document.createRange();
        range.selectNodeContents(sessionTitleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      sessionTitleEl.addEventListener('blur', () => {
        sessionTitleEl.contentEditable = 'false';
        const title = sessionTitleEl.textContent.trim();
        if (!title) sessionTitleEl.textContent = 'New Session';
      });
      sessionTitleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sessionTitleEl.blur();
        } else if (e.key === 'Escape') {
          sessionTitleEl.blur();
        }
      });

      historyBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'sendMessage', text: '/history' });
      });

      inputEl.addEventListener('keydown', (e) => {
        if (autocompleteEl.classList.contains('visible')) {
          if (e.key === 'ArrowDown') { e.preventDefault(); autocompleteNavigate(1); return; }
          if (e.key === 'ArrowUp')   { e.preventDefault(); autocompleteNavigate(-1); return; }
          if (e.key === 'Tab' || e.key === 'Enter') {
            const selected = autocompleteEl.querySelector('.autocomplete-item.selected');
            if (selected) {
              e.preventDefault();
              const nameEl = selected.querySelector('.cmd-name');
              if (nameEl) selectAutocompleteItem(nameEl.textContent?.slice(1) ?? '');
              return;
            }
          }
          if (e.key === 'Escape') { hideAutocomplete(); return; }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      function autoResize() {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
      }

      inputEl.addEventListener('input', () => {
        autoResize();
        const val = inputEl.value;
        if (val.startsWith('/')) {
          if (commandList.length === 0) {
            vscode.postMessage({ type: 'requestCommandList' });
          } else {
            showAutocomplete();
          }
        } else {
          hideAutocomplete();
        }
      });

      // -----------------------------------------------------------------------
      // Bootstrap
      // -----------------------------------------------------------------------
      vscode.postMessage({ type: 'ready' });
    })();
`;
