/**
 * v1.18.0 Phase 5 (OI-A3) -- native ACP agent over the shared loopback surface.
 *
 * JSON-RPC 2.0 at `POST /acp`. Every consequential tool call is classified and
 * gated the same way as the headless UI path. Unattended confirmation
 * parks in the Phase 4 ask inbox (fail-closed if no inbox is configured).
 * No Open Interpreter code is vendored.
 * `# DEVIATION:` ACP is JSON-RPC 2.0 over HTTP `POST /acp` on the shared
 * loopback listener (not a stdio subprocess). `session/update` notifications
 * are collected on `session/prompt` as `updates[]`, and flushed as SSE when
 * the client sends `Accept: text/event-stream`.
 */

import { randomUUID } from "node:crypto";

import type { AskInbox } from "../../../../modules/coding/autonomy/AskInbox.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";
import { ActionRisk } from "../../../../modules/coding/guardrails/ActionClassifier.js";
import { HeadlessAgentSession } from "../../../../modules/coding/runtime/HeadlessAgentSession.js";
import type { HeadlessConfirmFn } from "../../../../modules/coding/runtime/headlessGuards.js";
import {
  createHeadlessTools,
  type HeadlessTool,
} from "../../../../modules/coding/runtime/headlessTools.js";
import { CONTROL_SURFACE_ACP_PATH } from "../controlSurface/contract.js";
import {
  parseJsonBody,
  readLimitedBody,
  type ControlSurfaceContext,
  type ControlSurfaceRoute,
} from "../controlSurface/loopbackServer.js";
import {
  classifyAcpCall,
  createAcpConfirm,
  type AcpConfirmationOptions,
} from "./AcpConfirmation.js";
import {
  ACP_AGENT_INFO,
  ACP_INVALID_PARAMS,
  ACP_INVALID_REQUEST,
  ACP_METHOD_NOT_FOUND,
  ACP_PARSE_ERROR,
  ACP_PROTOCOL_VERSION,
  ACP_SESSION_NOT_FOUND,
  type AcpContentBlock,
  type AcpSessionUpdate,
  type AcpStopReason,
  type JsonRpcError,
  type JsonRpcRequest,
} from "./types.js";

export interface AcpAgentOptions {
  readonly llm: LLMClient;
  readonly tools?: HeadlessTool[];
  readonly defaultModel?: string;
  readonly confirmation?: AcpConfirmationOptions;
  /** Phase 4 ask inbox. When omitted, unattended confirms fail-close. */
  readonly inbox?: AskInbox;
}

interface AcpSession {
  readonly id: string;
  readonly cwd: string;
  readonly model: string;
  abort: AbortController;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function promptToText(prompt: unknown): string {
  if (!Array.isArray(prompt)) {
    throw jsonRpcError(ACP_INVALID_PARAMS, "session/prompt requires params.prompt[]");
  }
  const parts: string[] = [];
  for (const block of prompt as AcpContentBlock[]) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "resource_link" && typeof block.uri === "string") {
      parts.push(`[resource ${block.uri}]`);
    }
  }
  const text = parts.join("\n").trim();
  if (text.length === 0) {
    throw jsonRpcError(ACP_INVALID_PARAMS, "session/prompt requires at least one text block");
  }
  return text;
}

function jsonRpcError(code: number, message: string, data?: unknown): Error & JsonRpcError {
  return Object.assign(new Error(message), { code, ...(data !== undefined ? { data } : {}) });
}

function jsonRpcErrorFromUnknown(err: unknown): JsonRpcError {
  if (err instanceof Error && "code" in err && typeof (err as Error & JsonRpcError).code === "number") {
    const coded = err as Error & JsonRpcError;
    return { code: coded.code, message: coded.message, data: coded.data };
  }
  return { code: -32603, message: err instanceof Error ? err.message : String(err) };
}

function wrapBlocked(tools: HeadlessTool[]): HeadlessTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(args, ctx) {
      const classified = classifyAcpCall(tool.name, args);
      if (classified.risk === ActionRisk.BLOCKED) {
        return { success: false, output: "", error: classified.reason };
      }
      return tool.execute(args, ctx);
    },
  }));
}

function stopReasonFrom(finish: string): AcpStopReason {
  switch (finish) {
    case "aborted":
      return "cancelled";
    case "max-iterations":
      return "max_turn_requests";
    case "error":
      return "refusal";
    default:
      return "end_turn";
  }
}

export class AcpAgent {
  private readonly _llm: LLMClient;
  private readonly _tools: HeadlessTool[];
  private readonly _defaultModel: string;
  private readonly _inbox?: AskInbox;
  private readonly _confirmation: AcpConfirmationOptions;
  private _activeSessionId: string | undefined;
  private _enabled = false;
  private _initialized = false;
  private readonly _sessions = new Map<string, AcpSession>();

  constructor(opts: AcpAgentOptions) {
    this._llm = opts.llm;
    this._defaultModel = opts.defaultModel ?? process.env.NEXUS_ACP_MODEL ?? "gemma4:e4b";
    this._inbox = opts.inbox ?? opts.confirmation?.inbox;
    this._confirmation = opts.confirmation ?? {};
    const confirm: HeadlessConfirmFn = (toolName, summary, detail, args) =>
      createAcpConfirm({
        ...this._confirmation,
        inbox: this._inbox,
        runId: this._activeSessionId ? `acp:${this._activeSessionId}` : "acp",
        sessionId: this._activeSessionId,
      })(toolName, summary, detail, args);
    const guarded = opts.tools ?? createHeadlessTools({ guards: { confirm } });
    this._tools = wrapBlocked(guarded);
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      for (const session of this._sessions.values()) session.abort.abort();
      this._sessions.clear();
      this._initialized = false;
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  asRoute(): ControlSurfaceRoute {
    return async (ctx) => this._handle(ctx);
  }

  private async _handle(ctx: ControlSurfaceContext): Promise<boolean> {
    if (!this._enabled) return false;
    if (ctx.method !== "POST" || ctx.path !== CONTROL_SURFACE_ACP_PATH) return false;

    const raw = await readLimitedBody(ctx.req, ctx.maxBodyBytes);

    let req: JsonRpcRequest;
    try {
      req = parseJsonBody(raw) as JsonRpcRequest;
    } catch {
      ctx.writer.json(200, {
        jsonrpc: "2.0",
        id: null,
        error: { code: ACP_PARSE_ERROR, message: "Parse error" },
      });
      return true;
    }

    const id = req.id ?? null;
    const method = req.method;
    if (typeof method !== "string") {
      ctx.writer.json(200, {
        jsonrpc: "2.0",
        id,
        error: { code: ACP_INVALID_REQUEST, message: "Invalid Request" },
      });
      return true;
    }

    const wantsSse = String(ctx.req.headers.accept ?? "").includes("text/event-stream");

    try {
      const result = await this._dispatch(method, req.params, {
        signal: ctx.signal,
        onUpdate: wantsSse
          ? (update) => {
              ctx.writer.sse().write(
                JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: update }),
              );
            }
          : undefined,
      });

      if (id === null) {
        if (!ctx.res.headersSent) {
          ctx.res.writeHead(204);
          ctx.res.end();
        } else {
          ctx.writer.sse().end();
        }
        return true;
      }

      if (wantsSse) {
        ctx.writer.sse().write(JSON.stringify({ jsonrpc: "2.0", id, result }));
        ctx.writer.sse().end();
        return true;
      }

      ctx.writer.json(200, { jsonrpc: "2.0", id, result });
    } catch (err) {
      const error = jsonRpcErrorFromUnknown(err);
      if (wantsSse && ctx.res.headersSent) {
        ctx.writer.sse().write(JSON.stringify({ jsonrpc: "2.0", id, error }));
        ctx.writer.sse().end();
      } else {
        ctx.writer.json(200, { jsonrpc: "2.0", id, error });
      }
    }
    return true;
  }

  private async _dispatch(
    method: string,
    params: unknown,
    ctx: {
      readonly signal: AbortSignal;
      readonly onUpdate?: (update: AcpSessionUpdate) => void;
    },
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this._initialize(params);
      case "authenticate":
        return this._authenticate();
      case "session/new":
        return this._sessionNew(params);
      case "session/prompt":
        return this._sessionPrompt(params, ctx);
      case "session/cancel":
        this._sessionCancel(params);
        return {};
      default:
        throw jsonRpcError(ACP_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private _initialize(params: unknown): Record<string, unknown> {
    const protocolVersion = isRecord(params) ? params.protocolVersion : undefined;
    if (typeof protocolVersion !== "number") {
      throw jsonRpcError(ACP_INVALID_PARAMS, "initialize requires params.protocolVersion");
    }
    this._initialized = true;
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
      },
      agentInfo: { ...ACP_AGENT_INFO },
      // Transport already required the local bearer token; no extra ACP auth
      // handshake is needed (and none can loosen the HTTP check).
      authMethods: [],
    };
  }

  private _authenticate(): Record<string, never> {
    // HTTP bearer already passed. Empty success so a client that still calls
    // `authenticate` is not stuck.
    return {};
  }

  private _sessionNew(params: unknown): { sessionId: string } {
    if (!this._initialized) {
      throw jsonRpcError(ACP_INVALID_REQUEST, "initialize must complete before session/new");
    }
    if (!isRecord(params) || typeof params.cwd !== "string" || params.cwd.trim().length === 0) {
      throw jsonRpcError(ACP_INVALID_PARAMS, "session/new requires params.cwd");
    }
    const model =
      typeof params.model === "string" && params.model.trim().length > 0
        ? params.model.trim()
        : this._defaultModel;
    const id = randomUUID();
    this._sessions.set(id, {
      id,
      cwd: params.cwd.trim(),
      model,
      abort: new AbortController(),
    });
    return { sessionId: id };
  }

  private async _sessionPrompt(
    params: unknown,
    ctx: {
      readonly signal: AbortSignal;
      readonly onUpdate?: (update: AcpSessionUpdate) => void;
    },
  ): Promise<{ stopReason: AcpStopReason; updates: AcpSessionUpdate[] }> {
    if (!isRecord(params) || typeof params.sessionId !== "string") {
      throw jsonRpcError(ACP_INVALID_PARAMS, "session/prompt requires params.sessionId");
    }
    const session = this._sessions.get(params.sessionId);
    if (!session) throw jsonRpcError(ACP_SESSION_NOT_FOUND, "Unknown sessionId");

    const task = promptToText(params.prompt);
    this._activeSessionId = session.id;
    session.abort = new AbortController();
    const signal = abortAny(ctx.signal, session.abort.signal);
    const updates: AcpSessionUpdate[] = [];
    const emit = (update: Record<string, unknown>): void => {
      const payload: AcpSessionUpdate = { sessionId: session.id, update };
      updates.push(payload);
      ctx.onUpdate?.(payload);
    };

    const loop = new HeadlessAgentSession(this._llm, this._tools);
    const result = await loop.run({
      task,
      workdir: session.cwd,
      model: session.model,
      signal,
      onEvent: (event) => {
        switch (event.kind) {
          case "token":
            emit({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: event.text },
            });
            break;
          case "toolCall":
            emit({
              sessionUpdate: "tool_call",
              toolCallId: `${session.id}:${event.name}`,
              title: event.name,
              kind: "other",
              status: "pending",
            });
            break;
          case "toolResult":
            emit({
              sessionUpdate: "tool_call_update",
              toolCallId: `${session.id}:${event.name}`,
              status: event.success ? "completed" : "failed",
              content: [{ type: "content", content: { type: "text", text: event.output || event.name } }],
            });
            break;
          default:
            break;
        }
      },
    });

    return { stopReason: stopReasonFrom(result.finishReason), updates };
  }

  private _sessionCancel(params: unknown): void {
    if (!isRecord(params) || typeof params.sessionId !== "string") return;
    this._sessions.get(params.sessionId)?.abort.abort();
  }
}

function abortAny(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
