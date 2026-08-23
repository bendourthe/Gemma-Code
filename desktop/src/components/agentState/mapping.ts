/**
 * Agent-state vocabulary for Nexus (v1.17.0 Phase 2).
 *
 * Adapts the six thought-orb states (working, searching, solving, listening,
 * composing, shaping) onto Nexus activities without importing that library.
 * Surfaces pass an `AgentActivity`; this module returns the state, locked
 * accent token, and accessible label. Accents are aliases of the v1.0 palette
 * only -- no new colors.
 */

export type AgentState =
  | "idle"
  | "working"
  | "searching"
  | "solving"
  | "listening"
  | "composing"
  | "shaping";

export type AgentActivity =
  | "idle"
  | "coding-tool-use"
  | "coding-solving"
  | "memory-retrieval"
  | "web-search"
  | "chat-streaming"
  | "asr-capture"
  | "document-parse"
  | "image-generation"
  | "video-generation"
  | "model-loading"
  | "model-inference";

export type AgentAccentToken =
  | "--accent-coding"
  | "--accent-chatbot"
  | "--accent-image"
  | "--accent-video"
  | "--fg-muted";

export interface AgentStateMapping {
  activity: AgentActivity;
  state: AgentState;
  /** CSS custom property from the locked palette. */
  accentToken: AgentAccentToken;
  /** Hex identical to tokens.css, used when canvas cannot resolve the var. */
  accentFallback: string;
  label: string;
  /** Why this activity maps to this state. */
  rationale: string;
}

const MAPPINGS: Record<AgentActivity, AgentStateMapping> = {
  idle: {
    activity: "idle",
    state: "idle",
    accentToken: "--fg-muted",
    accentFallback: "#8a92a6",
    label: "Idle",
    rationale: "Default rest state when no agent work is in flight.",
  },
  "coding-tool-use": {
    activity: "coding-tool-use",
    state: "working",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Working",
    rationale: "Coding tool-use (read/edit/bash) is active labor; working is the busy orbit.",
  },
  "coding-solving": {
    activity: "coding-solving",
    state: "solving",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Solving",
    rationale: "Multi-step coding reasoning converges toward an answer; solving spirals inward.",
  },
  "memory-retrieval": {
    activity: "memory-retrieval",
    state: "searching",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Searching",
    rationale: "Memory/RAG retrieval is a search over the local index; coding accent because memory lives in the coding pillar.",
  },
  "web-search": {
    activity: "web-search",
    state: "searching",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Searching",
    rationale: "Web/grep search is outward lookup; chatbot cyan matches the explorer pillar.",
  },
  "chat-streaming": {
    activity: "chat-streaming",
    state: "composing",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Composing",
    rationale: "Token streaming is the model writing a reply; composing is the sequential chase.",
  },
  "asr-capture": {
    activity: "asr-capture",
    state: "listening",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Listening",
    rationale: "ASR/whisper capture is inbound audio; listening breathes as a pulse.",
  },
  "document-parse": {
    activity: "document-parse",
    state: "searching",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Searching",
    rationale: "OCR/document parse reads pages for text; searching, on the chatbot/explorer accent.",
  },
  "image-generation": {
    activity: "image-generation",
    state: "shaping",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Shaping",
    rationale: "Image generation forms a picture; shaping morphs the ring on the image accent.",
  },
  "video-generation": {
    activity: "video-generation",
    state: "shaping",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Shaping",
    rationale: "Video generation forms a clip; same shaping state, video accent.",
  },
  "model-loading": {
    activity: "model-loading",
    state: "working",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Working",
    rationale: "Connecting to a local model is agent work before the first sample arrives.",
  },
  "model-inference": {
    activity: "model-inference",
    state: "working",
    accentToken: "--accent-chatbot",
    accentFallback: "#22d3ee",
    label: "Working",
    rationale: "A loaded model that is not idle is doing inference; working, coding accent as the default agent color.",
  },
};

export const AGENT_ACTIVITIES: readonly AgentActivity[] = Object.keys(MAPPINGS) as AgentActivity[];

export function resolveAgentState(activity: AgentActivity): AgentStateMapping {
  return MAPPINGS[activity];
}
