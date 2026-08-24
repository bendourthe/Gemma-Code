import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITIES,
  resolveAgentState,
  type AgentActivity,
  type AgentState,
} from "../src/components/agentState/mapping";

const EXPECTED: Record<
  AgentActivity,
  { state: AgentState; accentToken: string; accentFallback: string }
> = {
  idle: { state: "idle", accentToken: "--fg-muted", accentFallback: "#8a92a6" },
  "coding-tool-use": { state: "working", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "coding-solving": { state: "solving", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "memory-retrieval": { state: "searching", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "web-search": { state: "searching", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "chat-streaming": { state: "composing", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "asr-capture": { state: "listening", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "document-parse": { state: "searching", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "image-generation": { state: "shaping", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "video-generation": { state: "shaping", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "model-loading": { state: "working", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "model-inference": { state: "working", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
};

describe("resolveAgentState", () => {
  it("is exhaustive over every Nexus activity", () => {
    expect([...AGENT_ACTIVITIES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(AGENT_ACTIVITIES)("maps %s to the locked state and accent", (activity) => {
    const mapped = resolveAgentState(activity);
    const expected = EXPECTED[activity];
    expect(mapped.state).toBe(expected.state);
    expect(mapped.accentToken).toBe(expected.accentToken);
    expect(mapped.accentFallback).toBe(expected.accentFallback);
    expect(mapped.label.length).toBeGreaterThan(0);
    expect(mapped.rationale.length).toBeGreaterThan(0);
  });

  it("never introduces a non-Nexus palette token", () => {
    const allowed = new Set(["--accent-chatbot", "--fg-muted"]);
    for (const activity of AGENT_ACTIVITIES) {
      expect(allowed.has(resolveAgentState(activity).accentToken)).toBe(true);
    }
  });
});
