import { describe, it, expect } from "vitest";
import { parse, HTMLElement } from "node-html-parser";
import {
  serializeTraceToHtml,
  embedJson,
  escapeHtml,
  TRACE_DATA_ELEMENT_ID,
  type ExportableTrace,
} from "../../../modules/coding/observability/TraceHtmlExport.js";
import type { Span } from "../../../modules/coding/observability/TraceStore.js";
import { findRemoteAssetRefs } from "../../helpers/offlineIntegrity";

// v1.6.0 Phase 2 (AS004) -- the standalone shareable session/trace viewer (A4).
// These tests are the CI guard for the Phase 2 Stability Gate: the export opens
// offline with zero network, embeds every event inline as JSON, and routes all
// untrusted trace content through the same sanitisation rules as
// desktop/src/components/InteractiveArtifact.tsx (no <script> except the inert
// bundled renderer, no on* handlers, no javascript: URLs, no remote assets).
//
// Following the Phase 1 (AS003) precedent -- the project ships no browser-e2e
// harness, and adding one for a single static HTML artifact is disproportionate
// to the local-first / minimal-dependency ethos -- the "opens offline and
// renders the timeline" acceptance is verified structurally over the parsed DOM
// rather than by a live browser render.

const BASE = 1_700_000_000_000;

function span(overrides: Partial<Span> & Pick<Span, "spanId" | "name" | "kind">): Span {
  return {
    traceId: "11111111-2222-3333-4444-555555555555",
    parentSpanId: null,
    startTime: BASE,
    endTime: BASE + 100,
    durationMs: 100,
    status: "ok",
    attributes: {},
    events: [],
    groupId: null,
    parentRunId: null,
    ...overrides,
  };
}

function sampleTrace(spans: readonly Span[], extra: Partial<ExportableTrace> = {}): ExportableTrace {
  return {
    traceId: "11111111-2222-3333-4444-555555555555",
    sessionId: "session-abc",
    rootSpanId: "root-span-id",
    startTime: BASE,
    endTime: BASE + 5000,
    spanCount: spans.length,
    spans,
    ...extra,
  };
}

const DEFAULT_SPANS: Span[] = [
  span({ spanId: "s-root", name: "root", kind: "agent_turn", startTime: BASE, endTime: BASE + 5000, durationMs: 5000 }),
  span({
    spanId: "s-llm",
    name: "gemma4:e4b chat",
    kind: "llm_call",
    parentSpanId: "s-root",
    startTime: BASE + 100,
    endTime: BASE + 1300,
    durationMs: 1200,
    attributes: { model: "gemma4:e4b", tokens_estimated: 540 },
    events: [{ name: "first_token", timestamp: BASE + 250, attributes: { latency_ms: 150 } }],
  }),
  span({
    spanId: "s-tool",
    name: "run_terminal",
    kind: "tool_call",
    parentSpanId: "s-root",
    startTime: BASE + 1500,
    endTime: BASE + 1800,
    durationMs: 300,
    status: "error",
    attributes: { tool: "run_terminal", confirmation_required: true },
  }),
];

// ---------------------------------------------------------------------------
// escapeHtml / embedJson units
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" foo='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; foo=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("just text 123")).toBe("just text 123");
  });
});

describe("embedJson", () => {
  it("escapes <, >, and & so a string cannot close the script element", () => {
    const out = embedJson({ s: "</script><b>&amp;" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
    expect(out).toContain("\\u0026");
  });

  it("escapes U+2028 / U+2029 line/paragraph separators", () => {
    const out = embedJson({ s: "a b c" });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });

  it("round-trips through JSON.parse", () => {
    const value = { nested: { list: [1, 2, "</script>"] }, flag: true };
    expect(JSON.parse(embedJson(value))).toEqual(value);
  });
});

// ---------------------------------------------------------------------------
// serializeTraceToHtml -- document shape + offline integrity
// ---------------------------------------------------------------------------

describe("serializeTraceToHtml: document shape", () => {
  const html = serializeTraceToHtml(sampleTrace(DEFAULT_SPANS));

  it("emits a complete HTML document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("reuses the Phase 1 guide design tokens", () => {
    // A representative sample of the shared :root palette lifted from the guide.
    expect(html).toContain("--bg-deep: #02090c");
    expect(html).toContain("--teal: #38bdf8");
    expect(html).toContain("--grad: linear-gradient(100deg, #3b82f6 0%, #38bdf8 50%, #22d3ee 100%)");
  });

  it("uses an inline data: favicon (no remote icon)", () => {
    const link = parse(html).querySelector('link[rel="icon"]');
    expect(link).not.toBeNull();
    expect((link?.getAttribute("href") || "").startsWith("data:image/svg+xml,")).toBe(true);
  });

  it("contains no remote asset references (offline self-contained)", () => {
    expect(findRemoteAssetRefs(html)).toEqual([]);
  });

  it("embeds all CSS inline and has no remote <script src> / <link rel=stylesheet>", () => {
    const root = parse(html);
    const scripts = root.querySelectorAll("script") as HTMLElement[];
    expect(scripts.every((s) => !s.getAttribute("src"))).toBe(true);
    const stylesheets = (root.querySelectorAll("link") as HTMLElement[]).filter((l) =>
      (l.getAttribute("rel") || "").includes("stylesheet"),
    );
    expect(stylesheets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serializeTraceToHtml -- inline trace data + round-trip
// ---------------------------------------------------------------------------

describe("serializeTraceToHtml: inline event data", () => {
  const trace = sampleTrace(DEFAULT_SPANS);
  const html = serializeTraceToHtml(trace);

  it("embeds the trace as inline JSON in a non-executable script block", () => {
    const dataEl = parse(html).querySelector(`#${TRACE_DATA_ELEMENT_ID}`);
    expect(dataEl).not.toBeNull();
    expect(dataEl?.getAttribute("type")).toBe("application/json");
  });

  it("round-trips the embedded JSON back to the original events", () => {
    const dataEl = parse(html).querySelector(`#${TRACE_DATA_ELEMENT_ID}`);
    const parsed = JSON.parse(dataEl!.textContent);
    expect(parsed.traceId).toBe(trace.traceId);
    expect(parsed.spanCount).toBe(trace.spanCount);
    expect(parsed.spans).toEqual(DEFAULT_SPANS);
  });

  it("does not perform any live fetch (no fetch/XHR in the bundled renderer)", () => {
    expect(html).not.toMatch(/fetch\s*\(/);
    expect(html).not.toContain("XMLHttpRequest");
  });
});

// ---------------------------------------------------------------------------
// serializeTraceToHtml -- static timeline render (offline "e2e" analogue)
// ---------------------------------------------------------------------------

describe("serializeTraceToHtml: static timeline", () => {
  const html = serializeTraceToHtml(sampleTrace(DEFAULT_SPANS));
  const root = parse(html);

  it("renders one timeline row per span, with zero JavaScript required", () => {
    const timeline = root.querySelector('[data-testid="timeline"]');
    expect(timeline).not.toBeNull();
    expect(root.querySelectorAll("li.span")).toHaveLength(DEFAULT_SPANS.length);
  });

  it("renders the span names, kinds, and a duration into the static DOM", () => {
    const names = (root.querySelectorAll(".span-name") as HTMLElement[]).map((e) => e.textContent);
    expect(names).toContain("gemma4:e4b chat");
    expect(names).toContain("run_terminal");
    const badges = (root.querySelectorAll(".badge") as HTMLElement[]).map((e) => e.textContent);
    expect(badges).toContain("llm_call");
    expect(badges).toContain("tool_call");
    expect(html).toContain("1.20 s"); // the 1200ms llm span duration
  });

  it("renders span attributes and span events", () => {
    expect(html).toContain("gemma4:e4b"); // attribute value
    expect(html).toContain("first_token"); // event name
  });

  it("renders a kind-filter chip per distinct kind", () => {
    const chips = (root.querySelectorAll(".chip[data-kind]") as HTMLElement[]).map((c) =>
      c.getAttribute("data-kind"),
    );
    expect(new Set(chips)).toEqual(new Set(["agent_turn", "llm_call", "tool_call"]));
  });
});

// ---------------------------------------------------------------------------
// serializeTraceToHtml -- sanitisation (InteractiveArtifact rules)
// ---------------------------------------------------------------------------

describe("serializeTraceToHtml: sanitisation of untrusted trace content", () => {
  const malicious = sampleTrace([
    span({
      spanId: "evil",
      name: "<img src=x onerror=alert(1)>",
      kind: "tool_call",
      attributes: { note: `</script><script>alert('xss')</script>`, link: "javascript:alert(2)" },
    }),
  ]);
  const html = serializeTraceToHtml(malicious);
  const root = parse(html);

  it("never turns an injected tag into a live element", () => {
    expect(root.querySelectorAll("img")).toHaveLength(0);
    // The span name survives as inert, escaped text.
    const name = root.querySelector(".span-name");
    expect(name?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("emits exactly two <script> tags: the JSON data block and the inert renderer", () => {
    expect((html.match(/<script/gi) || [])).toHaveLength(2);
    expect((html.match(/<\/script>/gi) || [])).toHaveLength(2);
  });

  it("an injected </script> in trace data cannot break out of the data block", () => {
    // The raw breakout sequence must never appear verbatim; embedJson escaped it.
    expect(html).not.toContain("</script><script>alert('xss')</script>");
    const parsed = JSON.parse(root.querySelector(`#${TRACE_DATA_ELEMENT_ID}`)!.textContent);
    // ...yet the original value is still faithfully recoverable from the JSON.
    expect(parsed.spans[0].attributes.note).toBe("</script><script>alert('xss')</script>");
  });

  it("carries no on* handler attributes and no javascript: URLs in executable positions", () => {
    // A trace can legitimately contain the literal text "javascript:" as data;
    // the guarantee is that it never lands in an executable position (an href /
    // src attribute) and that no on* handler attribute exists anywhere. The
    // malicious `link: "javascript:alert(2)"` attribute is only ever rendered as
    // escaped text inside a <dd> and as a JSON string -- never as a URL.
    const elements = root.querySelectorAll("*") as HTMLElement[];
    for (const el of elements) {
      for (const [attr, value] of Object.entries(el.attributes)) {
        expect(attr.toLowerCase().startsWith("on")).toBe(false);
        if (attr.toLowerCase() === "href" || attr.toLowerCase() === "src") {
          expect(/^\s*javascript:/i.test(value)).toBe(false);
        }
      }
    }
  });

  it("remains offline self-contained even with hostile trace content", () => {
    expect(findRemoteAssetRefs(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// serializeTraceToHtml -- options + edge cases
// ---------------------------------------------------------------------------

describe("serializeTraceToHtml: options and edge cases", () => {
  it("honors the title and exportedAtLabel options", () => {
    const html = serializeTraceToHtml(sampleTrace(DEFAULT_SPANS), {
      title: "My Trace",
      exportedAtLabel: "2026-06-15 12:00Z",
    });
    expect(parse(html).querySelector("title")?.textContent).toBe("My Trace");
    expect(html).toContain("2026-06-15 12:00Z");
  });

  it("renders a default title derived from the short trace id when none given", () => {
    const html = serializeTraceToHtml(sampleTrace(DEFAULT_SPANS));
    expect(parse(html).querySelector("title")?.textContent).toBe("Nexus Trace 11111111");
  });

  it("handles a trace with no spans without breaking offline integrity", () => {
    const html = serializeTraceToHtml(sampleTrace([], { spanCount: 0, endTime: null }));
    expect(parse(html).querySelector('[data-testid="empty-timeline"]')).not.toBeNull();
    expect(parse(html).querySelectorAll("li.span")).toHaveLength(0);
    expect(html).toContain("No spans to filter.");
    expect(findRemoteAssetRefs(html)).toEqual([]);
  });

  it("escapes a null session and a null endTime gracefully", () => {
    const html = serializeTraceToHtml(
      sampleTrace(DEFAULT_SPANS, { sessionId: null, endTime: null }),
    );
    expect(html).toContain("(none)");
    expect(findRemoteAssetRefs(html)).toEqual([]);
  });
});
