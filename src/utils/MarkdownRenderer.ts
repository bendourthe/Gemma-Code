import { marked, Renderer } from "marked";
// Import main highlight.js entry (includes common languages) for full type support.
import hljs from "highlight.js";

/**
 * Server-side Markdown renderer using `marked` (v4, CJS) and `highlight.js`.
 *
 * Runs in the extension (Node.js) context and produces sanitised HTML that
 * is injected into the webview. All output is escaped — the webview CSP
 * provides a second layer of defence against XSS.
 */

// ---------------------------------------------------------------------------
// Configure marked with syntax-highlighted code blocks
// ---------------------------------------------------------------------------

const renderer = new Renderer();

/** Render fenced code blocks with highlight.js syntax colouring. */
renderer.code = function (code: string, lang: string | undefined): string {
  const language = lang && hljs.getLanguage(lang) ? lang : null;

  let highlighted: string;
  try {
    highlighted = language
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value;
  } catch {
    highlighted = escapeHtml(code);
  }

  const langLabel = lang
    ? `<span class="code-lang">${escapeHtml(lang)}</span>`
    : "";

  return (
    `<div class="code-block">` +
    `<div class="code-header">${langLabel}<button class="copy-btn" aria-label="Copy code" data-code="${escapeAttr(code)}">Copy</button></div>` +
    `<pre><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ""}">${highlighted}</code></pre>` +
    `</div>`
  );
};

/** Open links via an external handler in the webview. */
renderer.link = function (
  href: string,
  _title: string | null | undefined,
  text: string
): string {
  return `<a href="${escapeAttr(href)}" class="ext-link" data-href="${escapeAttr(href)}">${text}</a>`;
};

/** Replace images with a placeholder to avoid loading external resources. */
renderer.image = function (): string {
  return `<span class="img-placeholder">[image]</span>`;
};

marked.use({ renderer });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders a Markdown string to sanitised HTML.
 * Safe to call from the extension host; the result is sent to the webview.
 */
export function renderMarkdown(text: string): string {
  try {
    return marked(text) as string;
  } catch {
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}
