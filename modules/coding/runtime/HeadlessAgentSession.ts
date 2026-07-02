// ---------------------------------------------------------------------------
// v1.7.0 headless agent runtime -- the vscode-free agentic loop.
//
// Drives a coding turn in plain Node: build a system prompt with tool
// declarations (+ an optional skill-body override for the optimizer), call the
// injected `LLMClient` port, parse tool calls out of the model's text with the
// vscode-free `Gemma4ToolFormat`, dispatch them to the headless tool set, feed
// the results back, and repeat until the model stops calling tools or the
// iteration budget is exhausted. No `vscode`, no `ConversationManager` (a plain
// message array replaces it), no webview -- so it loads in the desktop sidecar,
// the `nexus` CLI, and the golden-task optimizer rollout.
//
// Reuses the pure, vscode-free tool-call codec from `src/tools/Gemma4ToolFormat`
// (the same wire format the shipping extension uses, so a model behaves
// identically here). Relocating that codec into `modules/coding/` is a recorded
// follow-up; the import is a pure leaf (no cycle, no vscode).
// ---------------------------------------------------------------------------

import type { LLMClient, LLMMessage, LLMOptions } from "../llm/types.js";
import {
  formatToolResult,
  parseToolCalls,
  serializeToolDefinitions,
  stripToolCalls,
} from "../../../src/tools/Gemma4ToolFormat.js";
import type { ToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ToolResult } from "../../../src/tools/types.js";
import type { HeadlessTool, HeadlessToolResult } from "./headlessTools.js";

export const DEFAULT_HEADLESS_MAX_ITERATIONS = 12;

/** Streaming event surface (the sidecar maps these to its IPC event union). */
export type HeadlessAgentEvent =
  | { readonly kind: "token"; readonly text: string }
  | { readonly kind: "toolCall"; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly kind: "toolResult"; readonly name: string; readonly success: boolean; readonly output: string }
  | { readonly kind: "done"; readonly finishReason: HeadlessFinishReason };

export type HeadlessFinishReason = "done" | "max-iterations" | "aborted" | "error";

export interface HeadlessRunOptions {
  /** Natural-language instruction handed to the agent. */
  readonly task: string;
  /** Absolute working directory every tool is scoped to. */
  readonly workdir: string;
  /** Registry model id to run against. */
  readonly model: string;
  /** Extra base instructions prepended to the system prompt. */
  readonly systemInstructions?: string;
  /**
   * Optional skill-body override injected into the system prompt. The optimizer
   * rollout uses this to evaluate a candidate skill edit without writing a file.
   */
  readonly skillBody?: string;
  readonly maxIterations?: number;
  readonly signal?: AbortSignal;
  readonly llmOptions?: LLMOptions;
  readonly onEvent?: (event: HeadlessAgentEvent) => void;
}

export interface HeadlessRunResult {
  readonly finishReason: HeadlessFinishReason;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly llmCalls: number;
  /** The model's final assistant text with tool-call tokens stripped. */
  readonly finalText: string;
  readonly error?: string;
}

const BASE_SYSTEM_PROMPT = [
  "You are Nexus, a local coding agent operating headlessly on a working copy of a project.",
  "Use the declared tools to inspect and modify files and run commands. Call a tool with the",
  "format `<|tool_call>call:TOOL_NAME{\"arg\": value}<tool_call|>`. Make one focused change at a time,",
  "verify with a tool when useful, and when the task is fully complete reply with a short summary",
  "and NO tool call.",
].join(" ");

function buildSystemPrompt(tools: HeadlessTool[], opts: HeadlessRunOptions): string {
  const sections = [BASE_SYSTEM_PROMPT];
  if (opts.systemInstructions && opts.systemInstructions.trim().length > 0) {
    sections.push(opts.systemInstructions.trim());
  }
  if (opts.skillBody && opts.skillBody.trim().length > 0) {
    sections.push(`# Active skill\n${opts.skillBody.trim()}`);
  }
  // `serializeToolDefinitions` accepts the ToolMetadata shape (name/description/
  // parameters). A HeadlessTool is structurally compatible for those fields;
  // the only difference is the nominal `ToolName` type on `name` (used purely
  // as a string when rendering the declaration), so the cast is safe.
  const metadata = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })) as unknown as ToolMetadata[];
  sections.push(serializeToolDefinitions(metadata));
  return sections.join("\n\n");
}

/** Adapt a headless tool result to the `ToolResult` shape `formatToolResult` expects. */
function asToolResult(result: HeadlessToolResult): ToolResult {
  return {
    id: "",
    success: result.success,
    output: result.output,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

/**
 * The headless agentic loop. Construct once with an `LLMClient` port and the
 * headless tool set, then `run` per task. Stateless across runs (each run owns
 * its own message list), so a single instance is safe to reuse.
 */
export class HeadlessAgentSession {
  constructor(
    private readonly _llm: LLMClient,
    private readonly _tools: HeadlessTool[],
  ) {}

  async run(opts: HeadlessRunOptions): Promise<HeadlessRunResult> {
    const maxIterations = opts.maxIterations ?? DEFAULT_HEADLESS_MAX_ITERATIONS;
    const toolsByName = new Map(this._tools.map((t) => [t.name, t]));
    const messages: LLMMessage[] = [
      { role: "system", content: buildSystemPrompt(this._tools, opts) },
      { role: "user", content: opts.task },
    ];

    let iterations = 0;
    let toolCalls = 0;
    let llmCalls = 0;
    let finalText = "";

    const finish = (reason: HeadlessFinishReason, error?: string): HeadlessRunResult => {
      opts.onEvent?.({ kind: "done", finishReason: reason });
      return { finishReason: reason, iterations, toolCalls, llmCalls, finalText, error };
    };

    while (iterations < maxIterations) {
      if (opts.signal?.aborted) return finish("aborted");
      iterations += 1;

      let assistantText = "";
      try {
        llmCalls += 1;
        for await (const chunk of this._llm.streamChat(
          { model: opts.model, messages, stream: true, options: opts.llmOptions },
          opts.signal,
        )) {
          const delta = chunk.message?.content ?? "";
          if (delta) {
            assistantText += delta;
            opts.onEvent?.({ kind: "token", text: delta });
          }
          if (chunk.done) break;
        }
      } catch (err) {
        if (opts.signal?.aborted) return finish("aborted");
        return finish("error", err instanceof Error ? err.message : String(err));
      }

      messages.push({ role: "assistant", content: assistantText });

      const parsed = parseToolCalls(assistantText);
      if (!parsed.hasAny) {
        finalText = stripToolCalls(assistantText);
        return finish("done");
      }

      // Execute each parsed call in order, feeding results back as a tool turn.
      for (const result of parsed.results) {
        if (opts.signal?.aborted) return finish("aborted");
        if (!result.ok) {
          messages.push({
            role: "user",
            content: `<|tool_result>\n${JSON.stringify({ error: result.error })}\n<tool_result|>`,
          });
          continue;
        }
        const call = result.call;
        const tool = toolsByName.get(call.tool);
        if (!tool) {
          messages.push({
            role: "user",
            content: formatToolResult(
              call.tool,
              asToolResult({ success: false, output: "", error: `unknown tool: ${call.tool}` }),
            ),
          });
          continue;
        }
        toolCalls += 1;
        opts.onEvent?.({ kind: "toolCall", name: call.tool, args: call.parameters });
        const toolResult = await tool.execute(call.parameters, {
          workdir: opts.workdir,
          signal: opts.signal,
        });
        opts.onEvent?.({
          kind: "toolResult",
          name: call.tool,
          success: toolResult.success,
          output: toolResult.output,
        });
        messages.push({ role: "user", content: formatToolResult(call.tool, asToolResult(toolResult)) });
      }
    }

    return finish("max-iterations");
  }
}
