import type { Span, SpanEvent, Trace } from "./TraceStore.js";

/**
 * v1.6.0 Phase 2 (A4) -- serialize a session trace into a single, self-contained
 * HTML file that opens offline with zero outbound network requests. This is the
 * local-only analogue of aisuite's served trace viewer: instead of a local HTTP
 * server painting a pre-built React bundle, the whole trace is frozen into one
 * shareable file.
 *
 * Design principles (the Phase 2 Stability Gate):
 *   1. **Offline / zero egress.** All CSS + JS are inline; the favicon is an
 *      inline data: URI; there is no `<script src>`, no `<link rel=stylesheet>`,
 *      no remote font, no `<img src>`. The output passes the same DOM-aware
 *      offline-integrity check that guards the Phase 1 interactive guide.
 *   2. **Inline trace data.** Every span is embedded inline as JSON inside a
 *      non-executable `<script type="application/json">` block (no live fetch),
 *      so the file round-trips back to the original events.
 *   3. **Sanitisation rules, reused.** This mirrors the trust boundary of
 *      `desktop/src/components/InteractiveArtifact.tsx`: strip every `<script>`
 *      EXCEPT the bundled inert renderer, no `on*` handler attributes, no
 *      `javascript:` URLs, no remote asset URLs. Untrusted trace content (span
 *      names, attribute keys/values, event names) is never interpolated as
 *      live markup -- it is HTML-escaped into text positions and JSON-escaped
 *      into the data block -- so a span named `<img src=x onerror=alert(1)>`
 *      renders as inert text, never as an element.
 *   4. **Shared design tokens.** The `:root` palette + body background are
 *      lifted verbatim from the Phase 1 guide
 *      (`guides/interactive-guide/nexus-ai-guide.html`) so the viewer matches
 *      the Nexus-AI brand. The animated constellation canvas is intentionally
 *      omitted: a shareable export should stay inert (no animation loop, no
 *      reduced-motion obligation); the layered gradient background carries the
 *      brand statically.
 *
 * The timeline is pre-rendered as static HTML (it is fully legible with
 * JavaScript disabled). The bundled inert boot script is progressive
 * enhancement only: it wires kind-filter chips and per-event expand/collapse
 * over the already-rendered DOM, reading the inline JSON without any fetch.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A trace with its full span list, as returned by `TraceStore.getTrace`. */
export type ExportableTrace = Trace & { readonly spans: readonly Span[] };

export interface TraceExportOptions {
  /** Title override; defaults to `Nexus Trace <short-id>`. */
  readonly title?: string;
  /**
   * Optional "exported at" label rendered in the header. The serializer never
   * reads the wall clock itself (so output is deterministic for a given trace);
   * the caller passes a formatted label when it wants one shown.
   */
  readonly exportedAtLabel?: string;
}

/** The id of the inline JSON data block, exported so tests can target it. */
export const TRACE_DATA_ELEMENT_ID = "nexus-trace-data";

// ---------------------------------------------------------------------------
// Escaping / safe embedding
// ---------------------------------------------------------------------------

/** HTML-escape text destined for a text node or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize a value to JSON that is safe to embed inside an HTML
 * `<script type="application/json">` block. Escaping `<`, `>`, and `&` prevents
 * a `</script>` (or comment) sequence inside any string from breaking out of
 * the element; escaping U+2028 / U+2029 keeps the payload valid when a consumer
 * copies it into a `<script>` (JS) context.
 *
 * The character class uses \uXXXX regex escapes so this source file stays
 * ASCII-clean (no raw separator bytes); the replacer rewrites each match to its
 * JS unicode escape.
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/** Reduce an arbitrary token to a CSS-class / data-attr-safe slug. */
function slug(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^-|-$/g, "") || "unknown";
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "--";
  // Deterministic: derived solely from the input epoch, no wall-clock read.
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "--";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatOffset(spanStart: number, traceStart: number): string {
  const delta = spanStart - traceStart;
  if (!Number.isFinite(delta) || delta < 0) return "+0 ms";
  return delta < 1000 ? `+${Math.round(delta)} ms` : `+${(delta / 1000).toFixed(2)} s`;
}

// ---------------------------------------------------------------------------
// Static timeline rendering
// ---------------------------------------------------------------------------

function renderAttributes(attributes: Record<string, string | number | boolean>): string {
  const keys = Object.keys(attributes).sort();
  if (keys.length === 0) return "";
  const rows = keys
    .map((key) => {
      const raw = attributes[key];
      const value = typeof raw === "string" ? raw : String(raw);
      return `        <div class="attr"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    })
    .join("\n");
  return `      <dl class="attrs">\n${rows}\n      </dl>`;
}

function renderEvents(events: readonly SpanEvent[], traceStart: number): string {
  if (events.length === 0) return "";
  const items = events
    .map((ev) => {
      const when = escapeHtml(formatOffset(ev.timestamp, traceStart));
      const name = escapeHtml(ev.name);
      const attrs = ev.attributes ? renderAttributes(ev.attributes) : "";
      return `        <li class="event-point"><span class="when">${when}</span><span class="ev-name">${name}</span>${attrs ? `\n${attrs}` : ""}</li>`;
    })
    .join("\n");
  return `      <ul class="event-points">\n${items}\n      </ul>`;
}

function renderSpan(span: Span, traceStart: number): string {
  const kindSlug = slug(span.kind);
  const statusSlug = slug(span.status);
  const parts: string[] = [];
  parts.push(
    `    <li class="span kind-${kindSlug} status-${statusSlug}" data-kind="${escapeHtml(kindSlug)}" data-status="${escapeHtml(statusSlug)}">`,
  );
  parts.push(`      <button type="button" class="span-head" aria-expanded="false">`);
  parts.push(`        <span class="badge badge-${kindSlug}">${escapeHtml(span.kind)}</span>`);
  parts.push(`        <span class="span-name">${escapeHtml(span.name)}</span>`);
  parts.push(`        <span class="span-offset">${escapeHtml(formatOffset(span.startTime, traceStart))}</span>`);
  parts.push(`        <span class="span-dur">${escapeHtml(formatDuration(span.durationMs))}</span>`);
  parts.push(`        <span class="span-status status-${statusSlug}">${escapeHtml(span.status)}</span>`);
  parts.push(`      </button>`);
  const attrs = renderAttributes(span.attributes);
  const events = renderEvents(span.events, traceStart);
  if (attrs || events) {
    parts.push(`      <div class="span-detail">`);
    if (attrs) parts.push(attrs);
    if (events) parts.push(events);
    parts.push(`      </div>`);
  }
  parts.push(`    </li>`);
  return parts.join("\n");
}

function renderTimeline(trace: ExportableTrace): string {
  if (trace.spans.length === 0) {
    return `  <p class="empty" data-testid="empty-timeline">This trace recorded no spans.</p>`;
  }
  const rows = trace.spans.map((s) => renderSpan(s, trace.startTime)).join("\n");
  return `  <ol class="timeline" data-testid="timeline">\n${rows}\n  </ol>`;
}

function statusCounts(spans: readonly Span[]): { ok: number; error: number; cancelled: number } {
  const counts = { ok: 0, error: 0, cancelled: 0 };
  for (const s of spans) {
    if (s.status === "error") counts.error += 1;
    else if (s.status === "cancelled") counts.cancelled += 1;
    else counts.ok += 1;
  }
  return counts;
}

function uniqueKinds(spans: readonly Span[]): string[] {
  const seen = new Set<string>();
  for (const s of spans) seen.add(s.kind);
  return Array.from(seen).sort();
}

// ---------------------------------------------------------------------------
// Design system (lifted from the Phase 1 guide :root tokens)
// ---------------------------------------------------------------------------

const STYLES = `
:root {
  --bg-deep: #02090c;
  --bg-0: #04141a;
  --bg-1: #072530;
  --bg-2: #0a3a47;
  --ink: #eaf6f8;
  --ink-dim: #a7c1c8;
  --ink-faint: #6f8990;
  --cyan: #22d3ee;
  --cyan-soft: #67e8f9;
  --teal: #38bdf8;
  --teal-soft: #7dd3fc;
  --blue: #3b82f6;
  --node-blue: #2f9ee6;
  --glow: #d7fbff;
  --green: #4ade80;
  --amber: #fbbf24;
  --red: #f87171;
  --violet: #a78bfa;
  --surface: rgba(255,255,255,.035);
  --surface-2: rgba(255,255,255,.06);
  --surface-3: rgba(255,255,255,.09);
  --border: rgba(96,165,250,.16);
  --border-bright: rgba(56,189,248,.36);
  --grad: linear-gradient(100deg, #3b82f6 0%, #38bdf8 50%, #22d3ee 100%);
  --grad-soft: linear-gradient(100deg, rgba(59,130,246,.16), rgba(56,189,248,.16));
  --sans: "Segoe UI", -apple-system, BlinkMacSystemFont, "Inter", system-ui, Roboto, Helvetica, Arial, sans-serif;
  --mono: "Cascadia Code", "JetBrains Mono", "SF Mono", "Consolas", "Liberation Mono", Menlo, monospace;
  --maxw: 1120px;
  --radius: 16px;
  --radius-sm: 10px;
  --shadow: 0 24px 60px -28px rgba(0,0,0,.8);
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--sans);
  color: var(--ink);
  background:
    radial-gradient(1200px 700px at 80% -10%, rgba(59,130,246,.12), transparent 60%),
    radial-gradient(1100px 800px at -10% 0%, rgba(56,189,248,.12), transparent 55%),
    linear-gradient(180deg, var(--bg-0) 0%, var(--bg-deep) 65%, #010608 100%);
  background-attachment: fixed;
  min-height: 100vh;
  line-height: 1.6;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--cyan-soft); text-decoration: none; }
code, .mono { font-family: var(--mono); }
.container { width: 100%; max-width: var(--maxw); margin: 0 auto; padding: 28px 24px 64px; }
header.trace-header {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 22px 24px;
  box-shadow: var(--shadow);
}
header.trace-header h1 { margin: 0 0 4px; font-size: 21px; letter-spacing: -.2px; }
header.trace-header h1 .accent {
  background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.meta-grid { display: flex; flex-wrap: wrap; gap: 8px 26px; margin-top: 14px; color: var(--ink-dim); font-size: 13.5px; }
.meta-grid .k { color: var(--ink-faint); margin-right: 6px; }
.meta-grid .v { color: var(--ink); font-family: var(--mono); font-size: 12.5px; }
.summary { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.pill { border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; font-size: 12.5px; color: var(--ink-dim); }
.pill.ok { border-color: rgba(74,222,128,.4); color: var(--green); }
.pill.error { border-color: rgba(248,113,113,.45); color: var(--red); }
.pill.cancelled { border-color: rgba(167,139,250,.45); color: var(--violet); }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin: 24px 0 12px; }
.chip {
  font: inherit; font-size: 12.5px; cursor: pointer;
  border: 1px solid var(--border); border-radius: 999px; padding: 5px 14px;
  background: var(--surface); color: var(--ink-dim);
}
.chip[aria-pressed="true"] { background: var(--grad-soft); color: var(--ink); border-color: var(--border-bright); }
ol.timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
li.span {
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); overflow: hidden;
}
li.span[hidden] { display: none; }
.span-head {
  display: flex; align-items: center; gap: 12px; width: 100%;
  font: inherit; text-align: left; cursor: pointer;
  background: transparent; border: 0; color: var(--ink);
  padding: 12px 16px;
}
.span-head:hover { background: var(--surface-2); }
.badge {
  font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: .4px;
  border: 1px solid var(--border-bright); border-radius: 6px; padding: 2px 7px; color: var(--teal-soft);
  flex: none;
}
.span-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.span-offset, .span-dur { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); flex: none; }
.span-status { font-size: 11.5px; flex: none; text-transform: uppercase; letter-spacing: .3px; }
.span-status.status-ok { color: var(--green); }
.span-status.status-error { color: var(--red); }
.span-status.status-cancelled { color: var(--violet); }
.span-detail { padding: 0 16px 14px; border-top: 1px dashed var(--border); }
li.span:not(.open) .span-detail { display: none; }
dl.attrs { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 0; }
dl.attrs .attr { display: contents; }
dl.attrs dt { color: var(--ink-faint); font-family: var(--mono); font-size: 12px; }
dl.attrs dd { margin: 0; color: var(--ink-dim); font-family: var(--mono); font-size: 12px; word-break: break-word; }
ul.event-points { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.event-point { font-size: 12.5px; color: var(--ink-dim); }
.event-point .when { font-family: var(--mono); color: var(--ink-faint); margin-right: 10px; }
.empty { color: var(--ink-faint); font-style: italic; }
footer.note { margin-top: 40px; color: var(--ink-faint); font-size: 12px; }
`.trim();

// Favicon: the same inline data: URI mark used by the Phase 1 guide.
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cg stroke='%2338bdf8' stroke-width='11' stroke-linecap='round'%3E%3Cline x1='26' y1='26' x2='74' y2='74'/%3E%3Cline x1='74' y1='26' x2='26' y2='74'/%3E%3C/g%3E%3Cg fill='%2338bdf8'%3E%3Ccircle cx='26' cy='26' r='9'/%3E%3Ccircle cx='74' cy='26' r='9'/%3E%3Ccircle cx='74' cy='74' r='9'/%3E%3Ccircle cx='26' cy='74' r='9'/%3E%3C/g%3E%3Ccircle cx='50' cy='50' r='8.5' fill='%23eaf6ff'/%3E%3C/svg%3E";

// The bundled inert renderer. No fetch, no eval, no timers, no remote: it only
// attaches click listeners to its own pre-rendered elements and reads the
// inline JSON data block. Kept as a plain string so the serializer never has to
// transpile it; the IIFE is defensive (every lookup is null-guarded).
const BOOT_SCRIPT = `
(function () {
  "use strict";
  var dataEl = document.getElementById("${TRACE_DATA_ELEMENT_ID}");
  var trace = null;
  if (dataEl) {
    try { trace = JSON.parse(dataEl.textContent || "null"); } catch (e) { trace = null; }
  }
  // Expose the parsed trace for inspection; this is the inline round-trip, no fetch.
  window.__NEXUS_TRACE__ = trace;

  // Per-span expand/collapse.
  var heads = document.querySelectorAll(".span-head");
  for (var i = 0; i < heads.length; i++) {
    heads[i].addEventListener("click", function () {
      var li = this.closest(".span");
      if (!li) return;
      var open = li.classList.toggle("open");
      this.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Kind-filter chips: toggle visibility of spans by data-kind.
  var active = {};
  var chips = document.querySelectorAll(".chip[data-kind]");
  function apply() {
    var anyActive = false, key;
    for (key in active) { if (active[key]) { anyActive = true; break; } }
    var spans = document.querySelectorAll("li.span");
    for (var j = 0; j < spans.length; j++) {
      var k = spans[j].getAttribute("data-kind");
      spans[j].hidden = anyActive && !active[k];
    }
  }
  for (var c = 0; c < chips.length; c++) {
    chips[c].addEventListener("click", function () {
      var k = this.getAttribute("data-kind");
      active[k] = !active[k];
      this.setAttribute("aria-pressed", active[k] ? "true" : "false");
      apply();
    });
  }
})();
`.trim();

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an exportable trace into a single self-contained HTML document.
 * The returned string is the complete file contents.
 */
export function serializeTraceToHtml(trace: ExportableTrace, options: TraceExportOptions = {}): string {
  const shortId = trace.traceId.slice(0, 8);
  const title = options.title ?? `Nexus Trace ${shortId}`;
  const counts = statusCounts(trace.spans);
  const kinds = uniqueKinds(trace.spans);

  const filterChips = kinds
    .map((kind) => {
      const s = slug(kind);
      return `    <button type="button" class="chip" data-kind="${escapeHtml(s)}" aria-pressed="false">${escapeHtml(kind)}</button>`;
    })
    .join("\n");

  const exportedRow = options.exportedAtLabel
    ? `\n      <span><span class="k">Exported</span><span class="v">${escapeHtml(options.exportedAtLabel)}</span></span>`
    : "";

  // The inline trace payload -- the complete event data, round-trippable.
  const payload = embedJson({
    traceId: trace.traceId,
    sessionId: trace.sessionId,
    rootSpanId: trace.rootSpanId,
    startTime: trace.startTime,
    endTime: trace.endTime,
    spanCount: trace.spanCount,
    spans: trace.spans,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="Self-contained, offline Nexus session trace viewer. All trace data is embedded inline; the file makes no network requests." />
<link rel="icon" type="image/svg+xml" href="${FAVICON}" />
<style>
${STYLES}
</style>
</head>
<body>
<div class="container">
  <header class="trace-header">
    <h1><span class="accent">Nexus</span> Session Trace</h1>
    <div class="meta-grid">
      <span><span class="k">Trace</span><span class="v">${escapeHtml(trace.traceId)}</span></span>
      <span><span class="k">Session</span><span class="v">${escapeHtml(trace.sessionId ?? "(none)")}</span></span>
      <span><span class="k">Started</span><span class="v">${escapeHtml(formatTimestamp(trace.startTime))}</span></span>
      <span><span class="k">Ended</span><span class="v">${escapeHtml(formatTimestamp(trace.endTime))}</span></span>
      <span><span class="k">Spans</span><span class="v">${trace.spanCount}</span></span>${exportedRow}
    </div>
    <div class="summary">
      <span class="pill ok">${counts.ok} ok</span>
      <span class="pill error">${counts.error} error</span>
      <span class="pill cancelled">${counts.cancelled} cancelled</span>
    </div>
  </header>

  <div class="filters" role="group" aria-label="Filter spans by kind">
${filterChips || "    <span class=\"empty\">No spans to filter.</span>"}
  </div>

${renderTimeline(trace)}

  <footer class="note">
    Generated locally by Nexus. This file is fully self-contained and makes no network requests.
  </footer>
</div>

<script type="application/json" id="${TRACE_DATA_ELEMENT_ID}">${payload}</script>
<script>
${BOOT_SCRIPT}
</script>
</body>
</html>
`;
}
