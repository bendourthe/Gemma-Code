/**
 * Shared webview helpers (Phase 3, v0.6.0). Closes codebase-review #23
 * (escapeHtml / escapeAttr / formatDate were duplicated across three webview
 * panels). The exported strings are inlined into webview HTML via template
 * substitution so the JS that runs inside the webview iframe stays
 * self-contained -- the panel does not need to bundle JavaScript modules.
 *
 * Pair with the no-restricted-syntax ESLint rule against
 * `el.innerHTML = a + b` patterns: callers should prefer
 * `el.replaceChildren(...)` plus `document.createElement` + `textContent`,
 * but where map/join + escapeHtml is unavoidable, this module ensures every
 * panel uses the same escaping semantics.
 */

/**
 * JS-source helpers embedded into the webview as a single nonce-pinned
 * `<script>` block. Defines three browser-side functions:
 *   - `escapeHtml(s)` / `escapeAttr(s)` -- HTML / attribute escapers
 *   - `formatDate(ts)` -- relative-time formatter ("Just now", "5m ago", ...)
 *
 * The helpers attach to `window.__gemmaWebviewHelpers` so multiple `<script>`
 * blocks can share them without redeclaration.
 */
export const WEBVIEW_HELPERS_JS = `
  (function() {
    'use strict';
    if (window.__gemmaWebviewHelpers) return;

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function escapeAttr(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function formatDate(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
      return d.toLocaleDateString();
    }

    window.__gemmaWebviewHelpers = { escapeHtml: escapeHtml, escapeAttr: escapeAttr, formatDate: formatDate };
    window.escapeHtml = escapeHtml;
    window.escapeAttr = escapeAttr;
    window.formatDate = formatDate;
  })();
`.trim();

/**
 * Returns a `<script>` tag wrapping `WEBVIEW_HELPERS_JS`. The nonce is bound
 * at call time so it lines up with the panel's CSP.
 */
export function getWebviewHelpersScript(nonce: string): string {
  return `<script nonce="${nonce}">${WEBVIEW_HELPERS_JS}</script>`;
}
