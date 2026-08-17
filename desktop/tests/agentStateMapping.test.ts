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
  "coding-tool-use": { state: "working", accentToken: "--accent-coding", accentFallback: "#ec4899" },
  "coding-solving": { state: "solving", accentToken: "--accent-coding", accentFallback: "#ec4899" },
  "memory-retrieval": { state: "searching", accentToken: "--accent-coding", accentFallback: "#ec4899" },
  "web-search": { state: "searching", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "chat-streaming": { state: "composing", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "asr-capture": { state: "listening", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "document-parse": { state: "searching", accentToken: "--accent-chatbot", accentFallback: "#22d3ee" },
  "image-generation": { state: "shaping", accentToken: "--accent-image", accentFallback: "#f97316" },
  "video-generation": { state: "shaping", accentToken: "--accent-video", accentFallback: "#22c55e" },
  "model-loading": { state: "working", accentToken: "--accent-coding", accentFallback: "#ec4899" },
  "model-inference": { state: "working", accentToken: "--accent-coding", accentFallback: "#ec4899" },
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
    const allowed = new Set([
      "--accent-coding",
      "--accent-chatbot",
      "--accent-image",
      "--accent-video",
      "--fg-muted",
    ]);
    for (const activity of AGENT_ACTIVITIES) {
      expect(allowed.has(resolveAgentState(activity).accentToken)).toBe(true);
    }
  });
});
