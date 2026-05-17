// v1.0.0 Phase 3.5 -- panel-data providers for Memory / Trace / Sessions.
//
// The desktop Coding module's left-rail tabs (`Memory`, `Trace`, `Sessions`)
// each consume a dedicated IPC method. Phase 3 ships deterministic
// placeholder data so the frontend, tests, and the trace dashboard's
// secret-path redaction can be exercised end-to-end without a live session.
// A follow-on commit wires these to `MemoryHub`, `TelemetryBus`, and the
// `CodingSessionManager` once the engine has been physically relocated to
// `modules/coding/`.

import type {
  CodingMemorySnapshotResponseT,
  CodingTraceSubscribeResponseT,
  MemorySnapshotT,
  TraceEventT,
} from "../protocol.js";

const PLACEHOLDER_SNAPSHOT: MemorySnapshotT = Object.freeze({
  layers: {
    core: ["Project: Nexus", "Goal: pass Phase 3 stability gate"],
    recent: ["Edited modules/coding/llm/PromptFormat.ts"],
    working: [],
    project: ["Owner: Benjamin Dourthe", "License: see LICENSE"],
  },
  anticipated: [
    "Likely next ask: add Qwen 2.5 tool-format coverage",
  ],
  proposedSkills: ["devai-hub/python-cleanup"],
});

const REDACTED_TOKEN = "<redacted>";
const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED_TOKEN);
  }
  return out;
}

export function memorySnapshot(): CodingMemorySnapshotResponseT {
  return { snapshot: PLACEHOLDER_SNAPSHOT };
}

const PLACEHOLDER_TRACE: readonly TraceEventT[] = Object.freeze([
  {
    id: "t-001",
    timestamp: "2026-05-17T11:30:00.000Z",
    kind: "skill",
    summary: "Loaded skill devai-hub/python-cleanup",
  },
  {
    id: "t-002",
    timestamp: "2026-05-17T11:30:02.123Z",
    kind: "tool",
    summary: "read_file invoked",
    payload: { path: "modules/coding/llm/PromptFormat.ts" },
  },
]);

export function traceSubscribe(): CodingTraceSubscribeResponseT {
  const events: TraceEventT[] = PLACEHOLDER_TRACE.map((e) => ({
    ...e,
    summary: redactSecrets(e.summary),
  }));
  return { events };
}
