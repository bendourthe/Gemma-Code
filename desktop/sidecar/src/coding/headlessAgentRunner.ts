// v1.7.0 -- production coding-agent runner for the desktop sidecar.
//
// Replaces the Phase 3.1 canned `CodingSessionManager.sendMessage` placeholder
// with a REAL agent run over the vscode-free headless runtime (SO001.P1.A):
// createOllamaClient (the loopback LLM port) + the headless tool set + the
// HeadlessAgentSession loop. The session's streaming events are mapped onto the
// sidecar's existing `CodingSessionEvent` IPC union, so the desktop frontend's
// tool-call render code works unchanged.
//
// Workspace: the agent's file/terminal tools are scoped to the session's
// workspace path when the frontend supplies one (start-request `workspacePath`),
// otherwise NEXUS_WORKSPACE, otherwise the sidecar cwd.
//
// This module lives under desktop/ (excluded from the dependency-cruiser
// boundary check), so importing the concrete Ollama client here is permitted --
// the sidecar is itself a composition root, like NexusCodingRuntime.

import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";
import {
  createHeadlessTools,
  type HeadlessTool,
} from "../../../../modules/coding/runtime/headlessTools.js";
import { HeadlessAgentSession } from "../../../../modules/coding/runtime/HeadlessAgentSession.js";
import type { CodingSessionEventT } from "../protocol.js";
import type { SidecarModelEntry } from "./models.js";

export interface AgentRunnerInput {
  readonly sessionId: string;
  readonly message: string;
  readonly model: SidecarModelEntry;
  /** Per-session workspace root the tools are scoped to (overrides the default). */
  readonly workspacePath?: string;
  readonly signal?: AbortSignal;
}

/** Runs one coding turn and returns the mapped IPC event stream. */
export type AgentRunner = (input: AgentRunnerInput) => Promise<readonly CodingSessionEventT[]>;

export interface HeadlessAgentRunnerOptions {
  /** Override the LLM port (tests inject a scripted client; default: Ollama). */
  readonly llm?: LLMClient;
  /** Override the tool set (default: the full headless tool set). */
  readonly tools?: HeadlessTool[];
  /** Default working directory when a session supplies none (default: NEXUS_WORKSPACE or cwd). */
  readonly workspace?: string;
  /** Extra base instructions folded into the system prompt. */
  readonly systemInstructions?: string;
}

function resolveWorkspace(perSession: string | undefined, explicit: string | undefined): string {
  if (perSession && perSession.length > 0) return perSession;
  if (explicit && explicit.length > 0) return explicit;
  const env = process.env["NEXUS_WORKSPACE"];
  if (env && env.length > 0) return env;
  return process.cwd();
}

/**
 * Build the production agent runner. Constructed once by the sidecar
 * composition root and injected into `CodingSessionManager`; each call runs a
 * fresh `HeadlessAgentSession` turn and collects its events. Never throws --
 * an LLM/tool failure is surfaced as a trailing `done` event with reason
 * `error`, so the IPC contract (an event array) always holds.
 */
export function createHeadlessAgentRunner(
  options: HeadlessAgentRunnerOptions = {},
): AgentRunner {
  const llm = options.llm ?? createHeadlessOllamaClient();
  const tools = options.tools ?? createHeadlessTools();
  const session = new HeadlessAgentSession(llm, tools);

  return async (input) => {
    const events: CodingSessionEventT[] = [];
    let toolSeq = 0;
    let lastCallId = "";
    const workspace = resolveWorkspace(input.workspacePath, options.workspace);

    const result = await session.run({
      task: input.message,
      workdir: workspace,
      model: input.model.id,
      systemInstructions: options.systemInstructions,
      signal: input.signal,
      onEvent: (event) => {
        switch (event.kind) {
          case "token":
            events.push({ kind: "token", text: event.text });
            break;
          case "toolCall": {
            toolSeq += 1;
            lastCallId = `${input.sessionId}:tc-${toolSeq}`;
            events.push({ kind: "toolCallHeader", callId: lastCallId, name: event.name });
            events.push({
              kind: "toolCallArgDelta",
              callId: lastCallId,
              delta: JSON.stringify(event.args),
            });
            break;
          }
          case "toolResult":
            events.push({
              kind: "toolCallComplete",
              callId: lastCallId,
              result: event.output,
            });
            break;
          case "done":
            // The trailing done event is appended below with the final reason.
            break;
        }
      },
    });

    events.push({ kind: "done", finishReason: result.finishReason });
    return events;
  };
}
