import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import {
  serializeTraceToHtml,
  type ExportableTrace,
} from "../../../modules/coding/observability/TraceHtmlExport.js";
import type { Span } from "../../../modules/coding/observability/TraceStore.js";

// v1.6.0 Phase 4 (A2) -- the A4 export renders the run tree (planner -> worker
// -> critic) with depth-based indentation, and falls back to the flat timeline
// (every row at depth 0) for traces without run-nesting metadata.

const BASE = 1_700_000_000_000;

function span(overrides: Partial<Span> & Pick<Span, "spanId" | "name" | "kind">): Span {
  return {
    traceId: "trace-1",
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

function trace(spans: readonly Span[]): ExportableTrace {
  return {
    traceId: "trace-1",
    sessionId: null,
    rootSpanId: "s-root",
    startTime: BASE,
    endTime: BASE + 5000,
    spanCount: spans.length,
    spans,
  };
}

describe("TraceHtmlExport run-nesting render (A2)", () => {
  it("indents nested runs by depth (planner -> worker -> critic)", () => {
    const spans = [
      span({ spanId: "s-root", name: "root", kind: "agent_turn", startTime: BASE }),
      span({
        spanId: "s-worker",
        name: "sub_agent_planning",
        kind: "sub_agent",
        startTime: BASE + 100,
        groupId: "g1",
        parentRunId: "s-root",
      }),
      span({
        spanId: "s-critic",
        name: "critic_task_1",
        kind: "critic",
        startTime: BASE + 200,
        groupId: "g1",
        parentRunId: "s-worker",
      }),
    ];

    const html = serializeTraceToHtml(trace(spans));
    const root = parse(html);
    const items = root.querySelectorAll("li.span");

    expect(items).toHaveLength(3);
    // Pre-order with increasing depth: root(0) -> worker(1) -> critic(2).
    const depths = items.map((li) => li.getAttribute("data-depth"));
    expect(depths).toEqual(["0", "1", "2"]);
    // The depth drives the indent custom property used by the stylesheet.
    expect(items[2]!.getAttribute("style")).toContain("--depth:2");
    // The critic kind reaches the badge.
    expect(html).toContain(">critic<");
  });

  it("renders a flat timeline (all depth 0) for a trace without nesting fields", () => {
    const spans = [
      span({ spanId: "s-root", name: "root", kind: "agent_turn", startTime: BASE }),
      span({ spanId: "s-llm", name: "llm", kind: "llm_call", startTime: BASE + 50 }),
      span({ spanId: "s-tool", name: "tool", kind: "tool_call", startTime: BASE + 80 }),
    ];

    const html = serializeTraceToHtml(trace(spans));
    const root = parse(html);
    const items = root.querySelectorAll("li.span");

    expect(items.map((li) => li.getAttribute("data-depth"))).toEqual(["0", "0", "0"]);
  });
});
