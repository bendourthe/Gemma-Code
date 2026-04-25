// NOTE(v0.5): bump marked from v4 to v12 to pick up its built-in sanitizer
// and Trusted Types support. Deferred from v0.4.0 Phase 6.16 because the v12
// renderer API is a breaking change (synchronous-only renderer methods, the
// `Renderer` constructor signature changes, and `marked.setOptions` is gone).
// DOMPurify (below) currently provides the sanitization layer, so the upgrade
// is a maintenance/API-modernization win rather than a security fix.
import { marked, Renderer } from "marked";
// Import the core highlight.js entry and register only the languages we ship
// syntax highlighting for. The default `highlight.js` export registers the
// full language corpus (~600KB minified); explicit registration drops the
// bundle by >=100KB (finding #64). Unregistered languages fall back to plain
// text via highlightAuto / escapeHtml.
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import DOMPurify from "isomorphic-dompurify";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

/**
 * Server-side Markdown renderer using `marked` (v4, CJS), `highlight.js`, and
 * DOMPurify. Runs in the extension (Node.js) context and produces sanitised
 * HTML that is injected into the webview. DOMPurify is the primary defence;
 * the webview CSP is a second layer.
 */

// DOMPurify configuration: allow the tags/attrs our renderer produces, strip
// everything else. `data-href` / `data-code` are needed for the ext-link and
// copy-btn wiring in GemmaCodePanel's message bridge.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
    "button",
  ],
  ALLOWED_ATTR: ["class", "href", "data-href", "data-code", "aria-label"],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "link", "meta"],
  FORBID_ATTR: ["onload", "onerror", "onclick", "onmouseover", "onfocus", "style"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|\/)/i,
};

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
  let html: string;
  try {
    html = marked(text) as string;
  } catch {
    html = `<pre>${escapeHtml(text)}</pre>`;
  }
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
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
