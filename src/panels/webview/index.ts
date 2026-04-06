/**
 * Generates the self-contained HTML for the Gemma Code chat webview panel.
 * No CDN dependencies — all CSS and JavaScript is inlined.
 * The script implements a minimal Markdown renderer for assistant messages.
 */
export function getWebviewHtml(
  nonce: string,
  cspSource: string,
  modelName: string
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gemma Code</title>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    /* ---- Header ---- */
    #header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      flex-shrink: 0;
      background: var(--vscode-sideBarSectionHeader-background);
    }
    #model-label {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--vscode-testing-iconPassed, #73c991);
      transition: background 0.2s;
    }
    #status-dot.thinking, #status-dot.streaming {
      background: var(--vscode-progressBar-background, #0e70c0);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }

    /* ---- Message list ---- */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #messages:empty::after {
      content: "Ask Gemma Code anything about your code.";
      display: block;
      text-align: center;
      padding: 40px 16px;
      opacity: 0.4;
      font-size: 12px;
    }

    .msg {
      max-width: 88%;
      padding: 7px 10px;
      border-radius: 8px;
      line-height: 1.5;
      word-break: break-word;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-bottom-right-radius: 2px;
    }
    .msg.assistant {
      align-self: flex-start;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-bottom-left-radius: 2px;
    }
    .msg.error {
      align-self: flex-start;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #f48771);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    }

    /* ---- Markdown inside assistant bubbles ---- */
    .msg.assistant code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      padding: 1px 4px;
      border-radius: 3px;
    }
    .msg.assistant pre {
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      padding: 8px 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 4px 0;
    }
    .msg.assistant pre code {
      background: none;
      padding: 0;
      font-size: 12px;
    }
    .msg.assistant p { margin: 4px 0; }
    .msg.assistant p:first-child { margin-top: 0; }
    .msg.assistant p:last-child { margin-bottom: 0; }
    .msg.assistant ul, .msg.assistant ol {
      padding-left: 18px;
      margin: 4px 0;
    }
    .msg.assistant h1, .msg.assistant h2, .msg.assistant h3 {
      margin: 6px 0 2px;
      font-weight: 600;
    }
    .msg.assistant h1 { font-size: 1.15em; }
    .msg.assistant h2 { font-size: 1.05em; }
    .msg.assistant h3 { font-size: 0.97em; }

    /* ---- Thinking indicator ---- */
    #thinking {
      align-self: flex-start;
      display: none;
      gap: 4px;
      padding: 8px 12px;
    }
    #thinking.visible { display: flex; }
    #thinking span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--vscode-foreground);
      opacity: 0.5;
      animation: bounce 1.2s ease-in-out infinite;
    }
    #thinking span:nth-child(2) { animation-delay: 0.2s; }
    #thinking span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-5px); }
    }

    /* ---- Footer ---- */
    #footer {
      padding: 8px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      gap: 5px;
      flex-shrink: 0;
    }
    #input-row {
      display: flex;
      gap: 5px;
      align-items: flex-end;
    }
    #input {
      flex: 1;
      resize: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 5px 8px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.4;
      min-height: 32px;
      max-height: 120px;
      overflow-y: auto;
    }
    #input:focus { outline: 1px solid var(--vscode-focusBorder); }
    #input:disabled { opacity: 0.5; cursor: not-allowed; }

    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    #controls-row {
      display: flex;
      justify-content: flex-end;
    }

    /* ---- Plan mode badge ---- */
    #plan-badge {
      display: none;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      flex-shrink: 0;
    }
    #plan-badge.active { display: inline-block; }

    /* ---- Command autocomplete dropdown ---- */
    #autocomplete {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: var(--vscode-editorWidget-background, var(--vscode-input-background));
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      max-height: 180px;
      overflow-y: auto;
      z-index: 10;
      display: none;
    }
    #autocomplete.visible { display: block; }
    .autocomplete-item {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .autocomplete-item:hover, .autocomplete-item.selected {
      background: var(--vscode-list-hoverBackground);
    }
    .autocomplete-item .cmd-name {
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 600;
      color: var(--vscode-symbolIcon-functionForeground, var(--vscode-foreground));
      flex-shrink: 0;
    }
    .autocomplete-item .cmd-hint {
      font-family: var(--vscode-editor-font-family, monospace);
      opacity: 0.55;
      font-size: 11px;
      flex-shrink: 0;
    }
    .autocomplete-item .cmd-desc {
      opacity: 0.7;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #footer { position: relative; }

    /* ---- Plan panel ---- */
    #plan-panel {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 8px 10px;
      display: none;
      flex-direction: column;
      gap: 6px;
      background: var(--vscode-sideBarSectionHeader-background);
      flex-shrink: 0;
    }
    #plan-panel.visible { display: flex; }
    #plan-panel-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    .plan-step {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
    }
    .plan-step-num {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      opacity: 0.55;
      flex-shrink: 0;
      min-width: 18px;
    }
    .plan-step-desc {
      flex: 1;
      line-height: 1.4;
    }
    .plan-step-status {
      font-size: 11px;
      flex-shrink: 0;
    }
    .plan-step-status.done { color: var(--vscode-testing-iconPassed, #73c991); }
    .plan-step-status.approved { color: var(--vscode-progressBar-background, #0e70c0); }
    .approve-btn {
      font-size: 11px;
      padding: 2px 8px;
      flex-shrink: 0;
    }

    /* ---- Tool use indicator ---- */
    .tool-use {
      align-self: flex-start;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 4px;
      padding: 3px 8px;
      opacity: 0.8;
    }

    /* ---- Tool result collapsible ---- */
    .tool-result {
      align-self: flex-start;
      font-size: 11px;
      max-width: 88%;
    }
    .tool-result summary {
      cursor: pointer;
      font-family: var(--vscode-editor-font-family, monospace);
      padding: 3px 6px;
      border-radius: 3px;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }
    .tool-result summary.success { color: var(--vscode-testing-iconPassed, #73c991); }
    .tool-result summary.failure { color: var(--vscode-testing-iconFailed, #f48771); }
    .tool-result pre {
      margin-top: 4px;
      padding: 6px 8px;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      border-radius: 3px;
      font-size: 11px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* ---- Confirmation card ---- */
    .confirm-card {
      align-self: flex-start;
      max-width: 92%;
      border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--vscode-inputValidation-warningBackground, rgba(184,149,0,0.1));
    }
    .confirm-card p {
      margin-bottom: 6px;
      font-size: 12px;
    }
    .confirm-card pre {
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      border-radius: 3px;
      padding: 6px 8px;
      font-size: 11px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin-bottom: 8px;
      max-height: 200px;
    }
    .confirm-buttons {
      display: flex;
      gap: 6px;
    }
    .confirm-buttons button { font-size: 11px; padding: 4px 10px; }
  </style>
</head>
<body>
  <header id="header">
    <span id="model-label" title="${modelName}">${modelName}</span>
    <span id="plan-badge" aria-label="Plan mode active">PLAN</span>
    <span id="status-dot" class="idle" aria-hidden="true"></span>
  </header>

  <main id="messages" role="log" aria-live="polite" aria-label="Chat messages"></main>

  <div id="thinking" aria-label="Gemma Code is thinking" role="status">
    <span></span><span></span><span></span>
  </div>

  <div id="plan-panel" role="region" aria-label="Plan steps">
    <div id="plan-panel-title">Plan steps</div>
    <div id="plan-steps"></div>
  </div>

  <footer id="footer">
    <div id="autocomplete" role="listbox" aria-label="Command suggestions"></div>
    <div id="input-row">
      <textarea
        id="input"
        rows="1"
        placeholder="Ask Gemma Code… (Enter to send, Shift+Enter for newline)"
        aria-label="Chat input"
      ></textarea>
      <button id="cancel-btn" class="secondary" hidden aria-label="Cancel stream">Cancel</button>
      <button id="send-btn" aria-label="Send message">Send</button>
    </div>
    <div id="controls-row">
      <button id="clear-btn" class="secondary" aria-label="Clear chat history">Clear chat</button>
    </div>
  </footer>

  <script nonce="${nonce}">
    (function () {
      'use strict';

      const vscode = acquireVsCodeApi();

      // -----------------------------------------------------------------------
      // DOM references
      // -----------------------------------------------------------------------
      const messagesEl    = /** @type {HTMLElement} */ (document.getElementById('messages'));
      const inputEl       = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
      const sendBtn       = /** @type {HTMLButtonElement} */ (document.getElementById('send-btn'));
      const cancelBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('cancel-btn'));
      const clearBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('clear-btn'));
      const thinkingEl    = /** @type {HTMLElement} */ (document.getElementById('thinking'));
      const statusDot     = /** @type {HTMLElement} */ (document.getElementById('status-dot'));
      const planBadge     = /** @type {HTMLElement} */ (document.getElementById('plan-badge'));
      const autocompleteEl= /** @type {HTMLElement} */ (document.getElementById('autocomplete'));
      const planPanel     = /** @type {HTMLElement} */ (document.getElementById('plan-panel'));
      const planStepsEl   = /** @type {HTMLElement} */ (document.getElementById('plan-steps'));

      // -----------------------------------------------------------------------
      // State
      // -----------------------------------------------------------------------
      let streaming = false;
      /** @type {HTMLElement | null} */
      let streamingBubble = null;
      let streamingContent = '';

      // Autocomplete state
      /** @type {Array<{name: string, description: string, argumentHint?: string}>} */
      let commandList = [];
      let autocompleteIndex = -1;

      // Plan mode state
      /** @type {string[]} */
      let planSteps = [];

      // -----------------------------------------------------------------------
      // Minimal Markdown → HTML renderer
      // -----------------------------------------------------------------------
      /**
       * @param {string} text
       * @returns {string}
       */
      function renderMarkdown(text) {
        // Escape HTML first (except inside code blocks — handled separately)
        /** @param {string} s */
        function escapeHtml(s) {
          return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }

        // Pull out fenced code blocks to prevent inner processing
        /** @type {string[]} */
        const codeBlocks = [];
        text = text.replace(/\`\`\`([\\w.-]*)\\n?([\\s\\S]*?)\`\`\`/g, (_m, lang, code) => {
          const idx = codeBlocks.length;
          const escaped = escapeHtml(code.trimEnd());
          const langAttr = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
          codeBlocks.push('<pre><code' + langAttr + '>' + escaped + '</code></pre>');
          return '\\x00CODE' + idx + '\\x00';
        });

        // Escape remaining HTML
        text = escapeHtml(text);

        // Inline code
        text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

        // Bold & italic
        text = text.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
        text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

        // Headers
        text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Unordered lists (group consecutive items)
        text = text.replace(/((?:^[\\-\\*] .+\\n?)+)/gm, (block) => {
          const items = block.trim().split('\\n').map((line) =>
            '<li>' + line.replace(/^[\\-\\*] /, '') + '</li>'
          ).join('');
          return '<ul>' + items + '</ul>';
        });

        // Paragraphs (double newline → paragraph break)
        text = text
          .split(/\\n{2,}/)
          .map((para) => {
            const trimmed = para.trim();
            if (!trimmed) return '';
            // Don't wrap block elements in <p>
            if (/^<(h[1-3]|ul|ol|pre|blockquote)/.test(trimmed)) return trimmed;
            return '<p>' + trimmed.replace(/\\n/g, '<br>') + '</p>';
          })
          .join('');

        // Restore code blocks
        text = text.replace(/\x00CODE(\\d+)\x00/g, (_m, idx) => codeBlocks[Number(idx)] ?? '');

        return text;
      }

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
            e.preventDefault(); // prevent input blur
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

      // -----------------------------------------------------------------------
      // Message handlers
      // -----------------------------------------------------------------------

      /** @param {readonly import('../../chat/types.js').Message[]} messages */
      function renderHistory(messages) {
        messagesEl.innerHTML = '';
        for (const msg of messages) {
          if (msg.role === 'user') {
            // Plain text for user messages
            const div = document.createElement('div');
            div.className = 'msg user';
            div.textContent = msg.content;
            messagesEl.appendChild(div);
          } else if (msg.role === 'assistant') {
            appendBubble('assistant', renderMarkdown(msg.content));
          }
        }
        scrollToBottom();
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'history':
            renderHistory(msg.messages);
            break;

          case 'status':
            applyStatus(msg.state);
            if (msg.state === 'streaming') {
              setStreaming(true);
              // Start a new streaming bubble
              streamingContent = '';
              streamingBubble = appendBubble('assistant', '');
            } else if (msg.state === 'thinking') {
              // On retry: discard the partial bubble
              if (streamingBubble) {
                streamingBubble.remove();
                streamingBubble = null;
                streamingContent = '';
              }
              setStreaming(true);
            } else {
              // idle
              setStreaming(false);
              streamingBubble = null;
              streamingContent = '';
            }
            break;

          case 'token':
            if (streamingBubble) {
              streamingContent += msg.value;
              streamingBubble.innerHTML = renderMarkdown(streamingContent);
              scrollToBottom();
            }
            break;

          case 'messageComplete':
            // Already fully rendered; just ensure idle state is awaited from status msg
            break;

          case 'error':
            applyStatus('idle');
            setStreaming(false);
            if (streamingBubble) {
              streamingBubble.remove();
              streamingBubble = null;
              streamingContent = '';
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
            // Replace the matching toolUse indicator with a collapsible result.
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
            // Re-trigger autocomplete if the user already typed '/'.
            if (inputEl.value.startsWith('/')) showAutocomplete();
            break;

          case 'planReady':
            renderPlanPanel(msg.steps);
            break;

          case 'planModeToggled':
            planBadge.classList.toggle('active', msg.active);
            if (!msg.active) hidePlanPanel();
            break;

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
            approveBtn.textContent = 'Approve';
            approveBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'confirmationResponse', id: msg.id, approved: true });
              card.remove();
            });

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'secondary';
            rejectBtn.textContent = 'Reject';
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

        // Render user bubble immediately
        const div = document.createElement('div');
        div.className = 'msg user';
        div.textContent = text;
        messagesEl.appendChild(div);
        scrollToBottom();

        inputEl.value = '';
        autoResize();

        vscode.postMessage({ type: 'sendMessage', text });
      }

      sendBtn.addEventListener('click', sendMessage);

      cancelBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelStream' });
      });

      clearBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearChat' });
      });

      inputEl.addEventListener('keydown', (e) => {
        // Autocomplete keyboard navigation.
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
          // Lazily request the command list on first slash.
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
  </script>
</body>
</html>`;
}
