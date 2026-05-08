/**
 * CSS for the chat webview. Extracted as a separate string so the webview
 * scaffold composer in `index.ts` reads as structure rather than a wall of
 * styling. Update spacing, theme tokens, and animations here.
 */
export const STYLES = String.raw`
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
      flex-direction: column;
      gap: 0;
      flex-shrink: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    #header-top {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
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
    #session-title {
      font-size: 13px;
      font-weight: 600;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: default;
      border-radius: 3px;
      padding: 1px 4px;
    }
    #session-title:hover { background: rgba(128,128,128,0.15); cursor: text; }
    #session-title[contenteditable="true"] {
      outline: 1px solid var(--vscode-focusBorder);
      background: var(--vscode-input-background);
      cursor: text;
    }
    #model-label {
      font-size: 10px;
      opacity: 0.5;
      white-space: nowrap;
    }
    .icon-btn {
      font-size: 16px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.6;
      flex-shrink: 0;
      padding: 0;
    }
    .icon-btn:hover { opacity: 1; background: rgba(128,128,128,0.2); }

    /* ---- Token counter ---- */
    #token-counter {
      font-size: 10px;
      opacity: 0.5;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #token-counter.warn { color: var(--vscode-inputValidation-warningForeground, #c8a040); opacity: 1; }
    #token-counter.danger { color: var(--vscode-inputValidation-errorForeground, #f48771); opacity: 1; }

    /* ---- Edit mode selector ---- */
    #edit-mode-selector {
      display: flex;
      gap: 1px;
      background: var(--vscode-input-border, rgba(128,128,128,0.3));
      border-radius: 4px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .edit-mode-btn {
      font-size: 10px;
      padding: 3px 10px;
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      cursor: pointer;
      white-space: nowrap;
      border-radius: 0;
      opacity: 0.6;
    }
    .edit-mode-btn:hover { opacity: 1; background: rgba(128,128,128,0.15); }
    .edit-mode-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      opacity: 1;
    }

    /* ---- Message list ---- */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    #messages:empty::after {
      content: "Ask Gemma Code anything about your code.";
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
      opacity: 0.35;
      font-size: 13px;
    }

    .msg {
      max-width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      line-height: 1.55;
      word-break: break-word;
      font-size: 13px;
    }
    .msg.user {
      align-self: flex-end;
      max-width: 85%;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 12px 12px 4px 12px;
    }
    .msg.assistant {
      align-self: flex-start;
      background: transparent;
      color: var(--vscode-foreground);
      padding: 4px 0;
    }
    .msg.streaming {
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .msg.error {
      align-self: flex-start;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #f48771);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    }

    /* ---- Rendered Markdown inside assistant bubbles ---- */
    .msg.assistant p { margin: 4px 0; }
    .msg.assistant p:first-child { margin-top: 0; }
    .msg.assistant p:last-child { margin-bottom: 0; }
    .msg.assistant ul, .msg.assistant ol { padding-left: 18px; margin: 4px 0; }
    .msg.assistant h1, .msg.assistant h2, .msg.assistant h3 {
      margin: 6px 0 2px; font-weight: 600;
    }
    .msg.assistant h1 { font-size: 1.15em; }
    .msg.assistant h2 { font-size: 1.05em; }
    .msg.assistant h3 { font-size: 0.97em; }
    .msg.assistant code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      padding: 1px 4px;
      border-radius: 3px;
    }
    .msg.assistant a.ext-link {
      color: var(--vscode-textLink-foreground, #3794ff);
      text-decoration: underline;
      cursor: pointer;
    }
    .msg.assistant .img-placeholder {
      opacity: 0.5;
      font-style: italic;
    }

    /* ---- Code block with header and copy button ---- */
    .code-block {
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      border-radius: 4px;
      overflow: hidden;
      margin: 6px 0;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 8px;
      background: rgba(0,0,0,0.15);
      font-size: 11px;
    }
    .code-lang {
      font-family: var(--vscode-editor-font-family, monospace);
      opacity: 0.7;
    }
    .copy-btn {
      font-size: 10px;
      padding: 1px 7px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .code-block pre {
      padding: 8px 10px;
      overflow-x: auto;
      margin: 0;
    }
    .code-block pre code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      background: none;
      padding: 0;
    }

    /* ---- highlight.js token colours (VS Code-compatible) ---- */
    .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-tag {
      color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
    }
    .hljs-string, .hljs-attr, .hljs-attribute {
      color: var(--vscode-symbolIcon-stringForeground, #ce9178);
    }
    .hljs-comment, .hljs-quote { color: var(--vscode-editorLineNumber-foreground, #608b4e); font-style: italic; }
    .hljs-number, .hljs-literal { color: var(--vscode-charts-green, #b5cea8); }
    .hljs-title, .hljs-class .hljs-title, .hljs-type {
      color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
    }
    .hljs-function, .hljs-selector-id { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
    .hljs-variable, .hljs-name { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
    .hljs-meta, .hljs-meta-keyword { color: var(--vscode-symbolIcon-operatorForeground, #c586c0); }
    .hljs-operator { color: var(--vscode-foreground); }
    .hljs-deletion { background: rgba(255,0,0,0.1); }
    .hljs-addition { background: rgba(0,200,0,0.1); }

    /* ---- Compaction status banner ---- */
    #compaction-banner {
      display: none;
      padding: 4px 10px;
      font-size: 11px;
      background: var(--vscode-inputValidation-infoBackground, rgba(0,80,160,0.2));
      color: var(--vscode-inputValidation-infoForeground, var(--vscode-foreground));
      border-bottom: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
      flex-shrink: 0;
    }
    #compaction-banner.visible { display: block; }

    /* ---- Sub-agent status banner ---- */
    #sub-agent-banner {
      display: none;
      padding: 4px 10px;
      font-size: 11px;
      background: var(--vscode-inputValidation-warningBackground, rgba(200,160,0,0.15));
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
      border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
      flex-shrink: 0;
    }
    #sub-agent-banner.visible { display: block; }
    #sub-agent-banner.error {
      background: var(--vscode-inputValidation-errorBackground, rgba(200,0,0,0.15));
      border-color: var(--vscode-inputValidation-errorBorder, #cc0000);
    }

    /* ---- History panel ---- */
    #history-panel {
      display: none;
      flex-direction: column;
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      gap: 4px;
    }
    #history-panel.visible { display: flex; }
    #history-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    #history-panel-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    .session-item {
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      border: 1px solid transparent;
    }
    .session-item:hover { background: var(--vscode-list-hoverBackground); }
    .session-item .session-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item .session-date { font-size: 10px; opacity: 0.55; margin-top: 2px; }

    /* ---- Diff preview ---- */
    .diff-preview {
      align-self: flex-start;
      max-width: 92%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      font-size: 11px;
    }
    .diff-preview summary {
      padding: 5px 10px;
      cursor: pointer;
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-sideBarSectionHeader-background);
      user-select: none;
    }
    .diff-preview pre {
      margin: 0;
      padding: 6px 8px;
      overflow-x: auto;
      max-height: 300px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
    }
    .diff-line-add { background: rgba(0,200,0,0.12); color: var(--vscode-diffEditor-insertedLineBackground, inherit); }
    .diff-line-del { background: rgba(200,0,0,0.12); color: var(--vscode-diffEditor-removedLineBackground, inherit); }
    .diff-line-hunk { opacity: 0.5; }

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
      padding: 10px 12px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    #input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    #input {
      flex: 1;
      resize: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
      border-radius: 8px;
      padding: 8px 12px;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.4;
      min-height: 36px;
      max-height: 150px;
      overflow-y: auto;
    }
    #input:focus { outline: none; border-color: var(--vscode-focusBorder); }
    #input:disabled { opacity: 0.5; cursor: not-allowed; }

    #send-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    #footer-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-top: 4px;
      flex-wrap: wrap;
    }
    #mode-desc {
      font-size: 11px;
      opacity: 0.45;
      white-space: nowrap;
    }
    .footer-spacer { flex: 1; }
    .clear-btn {
      font-size: 11px;
      padding: 2px 8px;
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.25));
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.6;
      margin-left: auto;
    }
    .clear-btn:hover { opacity: 1; }

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
      gap: 4px;
    }

    /* ---- Thinking mode badge ---- */
    #thinking-mode-badge {
      display: none;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-progressBar-background, #0e70c0);
      color: #fff;
      flex-shrink: 0;
    }
    #thinking-mode-badge.active { display: inline-block; }

    /* ---- Memory status badge ---- */
    #memory-badge {
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
      opacity: 0.7;
    }
    #memory-badge.active { display: inline-block; opacity: 1; }
    #memory-badge.off    { display: inline-block; opacity: 0.4; }

    /* ---- MCP connection badge ---- */
    #mcp-badge {
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
    #mcp-badge.connected    { display: inline-block; opacity: 1; background: var(--vscode-testing-iconPassed, #73c991); color: #000; }
    #mcp-badge.disconnected { display: inline-block; opacity: 0.4; }

    /* ---- Sub-agent spinner ---- */
    @keyframes spin { to { transform: rotate(360deg); } }
    .sub-agent-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--vscode-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

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
    .plan-step-desc { flex: 1; line-height: 1.4; }
    .plan-step-status { font-size: 11px; flex-shrink: 0; }
    .plan-step-status.done { color: var(--vscode-testing-iconPassed, #73c991); }
    .plan-step-status.approved { color: var(--vscode-progressBar-background, #0e70c0); }
    .approve-btn { font-size: 11px; padding: 2px 8px; flex-shrink: 0; }

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
    .confirm-card p { margin-bottom: 6px; font-size: 12px; }
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
    .confirm-buttons { display: flex; gap: 6px; }
    .confirm-buttons button { font-size: 11px; padding: 4px 10px; }

    /* ---- v0.7.0 Phase 4.1 -- inline diff card ---- */
    .diff-card {
      align-self: flex-start;
      max-width: 96%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }
    .diff-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 5px 10px;
      background: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .diff-card-path {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .diff-card-badge {
      font-size: 10px;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .diff-card-scroll {
      max-height: 320px;
      overflow: auto;
    }
    .diff-line {
      display: block;
      padding: 1px 8px;
      max-width: 80ch;
      white-space: pre;
      overflow-x: auto;
    }
    .diff-line.added {
      background: var(--vscode-diffEditor-insertedTextBackground, rgba(0, 200, 0, 0.12));
    }
    .diff-line.removed {
      background: var(--vscode-diffEditor-removedTextBackground, rgba(200, 0, 0, 0.12));
    }
    .diff-line.context {
      opacity: 0.65;
    }

    /* ---- v0.7.0 Phase 4.2 -- action-type tag ---- */
    .action-tag {
      align-self: flex-start;
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      padding: 3px 6px;
      border-radius: 3px;
    }
    .action-tag.action-status-started { opacity: 0.65; }
    .action-tag.action-status-completed { color: var(--vscode-testing-iconPassed, #73c991); }
    .action-tag.action-status-failed { color: var(--vscode-testing-iconFailed, #f48771); }
    .action-tag .action-label {
      font-weight: 700;
      flex-shrink: 0;
    }
    .action-tag .action-target {
      opacity: 0.85;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 60ch;
    }
    .action-tag .action-badge {
      margin-left: auto;
      opacity: 0.65;
      font-size: 10px;
      flex-shrink: 0;
    }

    /* ---- v0.7.0 Phase 4.3 -- numbered permission prompt ---- */
    .permission-prompt {
      align-self: flex-start;
      max-width: 92%;
      border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--vscode-inputValidation-warningBackground, rgba(184, 149, 0, 0.1));
      outline: none;
    }
    .permission-prompt-header { font-weight: 600; margin-bottom: 4px; }
    .permission-prompt-tool {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .permission-prompt-description { font-size: 12px; margin-bottom: 6px; }
    .permission-prompt-command {
      background: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.2));
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 11px;
      overflow-x: auto;
      margin-bottom: 8px;
    }
    .permission-prompt-options {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .permission-prompt-option { padding: 0; }
    .permission-prompt-button {
      width: 100%;
      text-align: left;
      font-size: 12px;
      padding: 6px 10px;
    }
    .permission-prompt-freeform { margin-top: 8px; }
    .permission-prompt-freeform-input {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.3));
      border-radius: 4px;
      padding: 6px 8px;
      font-family: inherit;
      font-size: 12px;
      resize: vertical;
    }
    .permission-prompt-resolved { opacity: 0.55; pointer-events: none; }

    /* ---- v0.7.0 Phase 4.4 -- todo block ---- */
    .todo-block {
      align-self: flex-start;
      max-width: 92%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px 12px;
      background: var(--vscode-editor-background, transparent);
    }
    .todo-block-heading {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.65;
      margin-bottom: 6px;
    }
    .todo-block-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 3px; }
    .todo-item { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
    .todo-item .todo-glyph { font-family: var(--vscode-editor-font-family, monospace); flex-shrink: 0; }
    .todo-item .todo-text { flex: 1; line-height: 1.45; }
    .todo-item.todo-status-completed .todo-text { text-decoration: line-through; opacity: 0.6; }
    .todo-item.todo-status-completed .todo-glyph { color: var(--vscode-testing-iconPassed, #73c991); }
    .todo-item.todo-status-in_progress .todo-glyph { color: var(--vscode-progressBar-background, #0e70c0); }
    .todo-item.todo-glow {
      background: rgba(14, 112, 192, 0.08);
      border-radius: 3px;
      padding: 1px 4px;
      margin: 0 -4px;
    }

    /* ---- v0.7.0 Phase 4.5 -- thought-for-Xs meta-row ---- */
    .thought-meta-row {
      align-self: flex-start;
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 2px 6px;
      font-size: 11px;
      opacity: 0.55;
    }
    .thought-meta-row .thought-meta-bullet { font-family: var(--vscode-editor-font-family, monospace); }
    .thought-meta-row.thought-meta-thinking .thought-meta-bullet { animation: pulse 1.2s ease-in-out infinite; }

    /* ---- v0.7.0 Phase 4.6 -- queued-message field ---- */
    .queued-message-field {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      padding: 6px 8px;
      border: 1px dashed var(--vscode-input-border, rgba(128, 128, 128, 0.3));
      border-radius: 8px;
      background: var(--vscode-input-background);
    }
    .queued-message-field .queued-input {
      flex: 1;
      resize: none;
      background: transparent;
      color: var(--vscode-input-foreground);
      border: none;
      padding: 4px 0;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.4;
      min-height: 28px;
      max-height: 120px;
    }
    .queued-message-field .queued-input:focus { outline: none; }
    .queued-message-field .queued-attach-btn,
    .queued-message-field .queued-stop-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    /* ---- v0.7.0 Phase 4.7 -- completion report ---- */
    .completion-report {
      align-self: flex-start;
      max-width: 96%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px 12px;
      background: var(--vscode-editor-background, transparent);
    }
    .completion-report-heading {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.65;
      margin-bottom: 6px;
    }
    .completion-report-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    .completion-report-row td { padding: 2px 8px 2px 0; vertical-align: baseline; }
    .completion-report-field {
      font-weight: 600;
      opacity: 0.7;
      width: 28%;
      white-space: nowrap;
    }
    .completion-report-value {
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .completion-report-link {
      color: var(--vscode-textLink-foreground, #3794ff);
      text-decoration: underline;
    }
    .completion-report-empty { display: none; }
`;
