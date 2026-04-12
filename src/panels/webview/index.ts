/**
 * Generates the self-contained HTML for the Gemma Code chat webview panel.
 * No CDN dependencies — all CSS and JavaScript is inlined.
 *
 * Markdown rendering is performed server-side (extension host) using `marked` +
 * `highlight.js`. The webview receives pre-rendered HTML for completed messages
 * and displays raw token text during streaming, then swaps in the rendered HTML
 * when the stream completes.
 */
/**
 * Format a raw Ollama model name into a human-friendly display string.
 * "gemma4:e4b" -> "Gemma 4 E4B"
 * "gemma4" -> "Gemma 4"
 * "gemma4:26b" -> "Gemma 4 26B"
 */
export function formatModelName(raw: string): string {
  const parts = raw.split(":");
  const base = parts[0] ?? raw;
  const variant = parts[1];
  const formatted = base.replace(/(\d)/g, " $1").trim();
  const capitalized = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  if (variant) return `${capitalized} ${variant.toUpperCase()}`;
  return capitalized;
}

export function getWebviewHtml(
  nonce: string,
  cspSource: string,
  modelName: string
): string {
  const displayName = formatModelName(modelName);
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
  </style>
</head>
<body>
  <header id="header">
    <div id="header-top">
      <span id="status-dot" class="idle" aria-hidden="true"></span>
      <span id="session-title">New Session</span>
      <button id="history-btn" class="icon-btn" aria-label="Session history" title="Show session history"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8.5L10.5 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
      <button id="new-chat-btn" class="icon-btn" aria-label="New session" title="Start a new session">+</button>
    </div>
    <span id="plan-badge" hidden></span>
    <span id="thinking-mode-badge" hidden></span>
    <span id="memory-badge" hidden></span>
    <span id="mcp-badge" hidden></span>
  </header>

  <div id="compaction-banner" role="status" aria-live="polite"></div>
  <div id="sub-agent-banner" role="status" aria-live="polite"></div>

  <main id="messages" role="log" aria-live="polite" aria-label="Chat messages"></main>

  <div id="history-panel" role="region" aria-label="Chat history">
    <div id="history-panel-header">
      <span id="history-panel-title">Chat History</span>
      <button id="history-close-btn" class="secondary" style="font-size:11px;padding:2px 8px;" aria-label="Close history">✕ Close</button>
    </div>
    <div id="history-list"></div>
  </div>

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
        placeholder="Ask Gemma Code..."
        aria-label="Chat input"
      ></textarea>
      <button id="cancel-btn" class="secondary" hidden aria-label="Cancel stream">Cancel</button>
      <button id="send-btn" aria-label="Send message">&#9650;</button>
    </div>
    <div id="footer-bar">
      <div id="edit-mode-selector" role="group" aria-label="Edit mode">
        <button class="edit-mode-btn" data-mode="ask" title="Ask before applying edits">Ask</button>
        <button class="edit-mode-btn" data-mode="auto" title="Automatically accept all changes">Accept</button>
        <button class="edit-mode-btn" data-mode="plan" title="Produce a plan before acting">Plan</button>
      </div>
      <span id="mode-desc">Ask before edits</span>
      <span class="footer-spacer"></span>
      <span id="model-label" title="${modelName}">${displayName}</span>
      <span id="token-counter" aria-label="Context usage" title="Context window usage"></span>
      <button id="clear-btn" class="clear-btn" aria-label="Clear session">Clear</button>
    </div>
  </footer>

  <script nonce="${nonce}">
    (function () {
      'use strict';

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
            const labels = { verification: 'Verification', research: 'Research', planning: 'Planning' };
            const label = labels[msg.agentType] || msg.agentType;
            subAgentBanner.classList.remove('error');
            if (msg.state === 'running') {
              subAgentBanner.innerHTML =
                '<span class="sub-agent-spinner"></span>' +
                '<strong>' + label + '</strong> agent running\u2026';
              subAgentBanner.classList.add('visible');
            } else if (msg.state === 'complete') {
              subAgentBanner.innerHTML = '<strong>' + label + '</strong> agent complete.';
              subAgentBanner.classList.add('visible');
              setTimeout(() => {
                subAgentBanner.classList.remove('visible');
                subAgentBanner.innerHTML = '';
              }, 3000);
            } else if (msg.state === 'error') {
              subAgentBanner.innerHTML =
                '<strong>' + label + '</strong> agent error: ' + (msg.summary || 'unknown');
              subAgentBanner.classList.add('visible', 'error');
              setTimeout(() => {
                subAgentBanner.classList.remove('visible', 'error');
                subAgentBanner.innerHTML = '';
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
  </script>
</body>
</html>`;
}
