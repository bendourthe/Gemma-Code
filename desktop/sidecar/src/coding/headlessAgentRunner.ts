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
// otherwise an explicit runner workspace or NEXUS_WORKSPACE. There is no cwd
// fallback because the packaged sidecar directory is not a user project.
//
// This module lives under desktop/ (excluded from the dependency-cruiser
// boundary check), so importing the concrete Ollama client here is permitted --
// the sidecar is itself a composition root, like NexusCodingRuntime.

import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";
import type { HeadlessDocumentParser, HeadlessTool } from "../../../../modules/coding/runtime/headlessTools.js";
import { createSidecarHeadlessTools } from "./sidecarHeadlessTools.js";
import { HeadlessAgentSession } from "../../../../modules/coding/runtime/HeadlessAgentSession.js";
import { createHookBus, type HookBus } from "../../../../core/lifecycle/HookBus.js";
import type { CodingSessionEventT } from "../protocol.js";
import type { SidecarModelEntry } from "./models.js";
import { runEnrichedHeadlessSession } from "./headlessRunEnrichment.js";
import { isAbsolute } from "node:path";
import type { WorkspaceScope } from "../../../../core/project/WorkspaceScope.js";

export interface AgentRunnerInput {
  readonly sessionId: string;
  readonly message: string;
  readonly model: SidecarModelEntry;
  /** Per-session workspace root the tools are scoped to (overrides the default). */
  readonly workspacePath?: string;
  readonly workspaceScope?: WorkspaceScope;
  readonly signal?: AbortSignal;
}

/** Runs one coding turn and returns the mapped IPC event stream. */
export type AgentRunner = (input: AgentRunnerInput) => Promise<readonly CodingSessionEventT[]>;

export interface HeadlessAgentRunnerOptions {
  /** Override the LLM port (tests inject a scripted client; default: Ollama). */
  readonly llm?: LLMClient;
  /** Override the tool set (default: the sidecar headless tool set). */
  readonly tools?: HeadlessTool[];
  /** Default working directory when a session supplies none (default: NEXUS_WORKSPACE). */
  readonly workspace?: string;
  /** Extra base instructions folded into the system prompt. */
  readonly systemInstructions?: string;
  /** v1.20.0 Phase 1 (A1): forwarded when the default tool set is used. */
  readonly documentParser?: HeadlessDocumentParser;
  readonly parseDocumentEnabled?: boolean;
  readonly catalogDir?: string;
  readonly hookBus?: HookBus;
  readonly log?: (message: string) => void;
}

export function resolveWorkspace(
  perSession: string | undefined,
  explicit: string | undefined,
): string {
  const selected = perSession?.trim() || explicit?.trim() || process.env["NEXUS_WORKSPACE"]?.trim();
  if (!selected) throw new Error("workspacePath is required for a coding session");
  if (!isAbsolute(selected)) {
    throw new Error("workspacePath must be an absolute path");
  }
  if (selected.split(/[\\/]/).includes("..")) {
    throw new Error("workspacePath must not contain parent traversal");
  }
  return selected;
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
  const tools =
    options.tools ??
    createSidecarHeadlessTools({
      documentParser: options.documentParser,
      parseDocumentEnabled: options.parseDocumentEnabled,
    });
  const session = new HeadlessAgentSession(llm, tools);
  const hookBus = options.hookBus ?? createHookBus();

  return async (input) => {
    const events: CodingSessionEventT[] = [];
    let toolSeq = 0;
    let lastCallId = "";
    try {
      const workspace = input.workspaceScope?.primaryRoot ?? resolveWorkspace(input.workspacePath, options.workspace);
      const workspaceRoots = Object.freeze([
        ...(input.workspaceScope?.workspaceRoots ?? [workspace]),
      ]);
      const result = await runEnrichedHeadlessSession({
        session,
        sessionId: input.sessionId,
        message: input.message,
        workspacePath: workspace,
        workspaceRoots,
        workspaceId: input.workspaceScope?.workspaceId,
        model: input.model.id,
        ...(options.systemInstructions
          ? { baseSystemInstructions: options.systemInstructions }
          : {}),
        ...(options.catalogDir ? { catalogDir: options.catalogDir } : {}),
        hookBus,
        ...(options.log ? { log: options.log } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
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
              break;
          }
        },
      });
      events.push({ kind: "done", finishReason: result.finishReason });
    } catch (error) {
      events.push({
        kind: "token",
        text: `Could not run coding session: ${error instanceof Error ? error.message : String(error)}`,
      });
      events.push({ kind: "done", finishReason: "error" });
    }
    return events;
  };
}
