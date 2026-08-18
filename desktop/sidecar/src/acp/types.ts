/**
 * v1.18.0 Phase 5 (OI-A3) -- native Agent Client Protocol types.
 *
 * Implemented from the open ACP v1 JSON-RPC shapes
 * (https://agentclientprotocol.com/protocol/overview). No Open Interpreter
 * code is vendored. This is a subset: initialize, authenticate, session/new,
 * session/prompt, session/cancel, session/update. Optional session/load is
 * not advertised.
 *
 * Transport is JSON-RPC 2.0 over HTTP `POST /acp` on the shared loopback
 * control surface (not stdio). Notifications (`session/update`) are returned
 * in the `session/prompt` result's `updates` array, and also flushed as SSE
 * frames when the client sends `Accept: text/event-stream`.
 */

export const ACP_PROTOCOL_VERSION = 1;

export const ACP_AGENT_INFO = {
  name: "nexus-coding",
  title: "Nexus Agentic AI Coding",
  version: "1.17.0",
} as const;

export type AcpStopReason = "end_turn" | "cancelled" | "max_turn_requests" | "refusal";

export interface AcpContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly uri?: string;
}

export interface AcpSessionUpdate {
  readonly sessionId: string;
  readonly update: Record<string, unknown>;
}

export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export const ACP_PARSE_ERROR = -32700;
export const ACP_INVALID_REQUEST = -32600;
export const ACP_METHOD_NOT_FOUND = -32601;
export const ACP_INVALID_PARAMS = -32602;
export const ACP_SESSION_NOT_FOUND = -32001;
export const ACP_CONFIRMATION_REFUSED = -32010;
