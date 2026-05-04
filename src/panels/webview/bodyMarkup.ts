/**
 * Static body markup for the chat webview. The model label is the only
 * place where data flows into the markup; everything else is keyed off DOM
 * IDs that the runtime script binds at startup.
 *
 * The placement of `&#9650;` (the "send" arrow), the close-chat button text
 * (`✕`), and the edit-mode buttons are part of the visual spec; do not swap
 * to icons without updating the accessibility labels.
 */
export function getBodyMarkup(modelName: string, displayName: string): string {
  return /* html */ `<body>
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
  </footer>`;
}
