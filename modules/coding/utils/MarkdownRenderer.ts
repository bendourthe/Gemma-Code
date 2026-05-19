import { Marked, Renderer } from "marked";
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

// Server-side Markdown renderer using `marked` (v12, CJS via the published
// `marked.cjs` entry), `highlight.js`, and DOMPurify. Runs in the extension
// (Node.js) context and produces sanitised HTML that is injected into the
// webview. DOMPurify is the primary defence; the webview CSP is a second
// layer. The token-object Renderer API landed in marked@15 and that line is
// ESM-only, so v0.7.0 stays on the v12 line (still positional Renderer).

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
    `<div class="code-header">${langLabel}<button class="copy-btn" aria-label="Copy code" data-code="${escapeHtml(code)}">Copy</button></div>` +
    `<pre><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ""}">${highlighted}</code></pre>` +
    `</div>`
  );
};

renderer.link = function (
  href: string,
  _title: string | null | undefined,
  text: string,
): string {
  return `<a href="${escapeHtml(href)}" class="ext-link" data-href="${escapeHtml(href)}">${text}</a>`;
};

renderer.image = function (): string {
  return `<span class="img-placeholder">[image]</span>`;
};

// v0.8.0 Phase 0.9 (closes v0.7.0 10.O.19): cache a single configured
// `Marked` instance instead of using the `marked.use({ renderer })` global
// + `marked.parse()` shorthand per call. The shorthand allocates a fresh
// internal Marked instance every invocation, which accounted for the
// renderer perf regression introduced when bumping from marked v4 to v12.
// One reusable instance restores throughput within a single-digit
// percentage of the v4 baseline.
const markdownInstance = new Marked({ async: false });
markdownInstance.use({ renderer });

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
    html = markdownInstance.parse(text) as string;
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
