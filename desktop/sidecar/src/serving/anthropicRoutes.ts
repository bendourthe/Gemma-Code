/**
 * v1.16.0 Phase 1.4 (adoption item A1) -- Anthropic-compatible route.
 *
 *   POST /v1/messages  -> buffered or SSE-streamed completion
 *
 * Lets Claude Code (configured with a custom base URL + the local token) and any
 * Anthropic-SDK client drive a Nexus-installed local model. Model resolution,
 * message flattening, sampling mapping, and error mapping are the SAME code the
 * OpenAI routes use (`chatCore.ts` + `ModelRouter`); only the request/response
 * envelope differs.
 *
 * The streamed form emits the full Anthropic event sequence -- `message_start`,
 * `content_block_start`, `content_block_delta`, `content_block_stop`,
 * `message_delta`, `message_stop` -- because the official SDKs treat the
 * block-level start/stop frames as mandatory, not optional.
 */

import { z } from "zod";
import type { LLMMessage } from "../../../../modules/coding/llm/types.js";
import {
  type IdFactory,
  type ResponseWriter,
  WireContent,
  buildChatRequest,
  defaultIdFactory,
  flattenContent,
  normalizeRole,
  toLlmOptions,
} from "./chatCore.js";
import { badRequest } from "./errors.js";
import type { ModelRouter } from "./modelRouter.js";

const AnthropicMessage = z
  .object({
    role: z.string().min(1),
    content: WireContent,
  })
  .passthrough();

export const AnthropicMessagesRequest = z
  .object({
    model: z.string().min(1, "'model' is required."),
    messages: z.array(AnthropicMessage).min(1, "'messages' must contain at least one message."),
    /** Anthropic carries the system prompt out-of-band from `messages`. */
    system: WireContent.optional(),
    max_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
  })
  .passthrough();

export type AnthropicMessagesRequestT = z.infer<typeof AnthropicMessagesRequest>;

export interface AnthropicRouteDeps {
  readonly router: ModelRouter;
  readonly newId?: IdFactory;
}

export function parseAnthropicRequest(raw: unknown): AnthropicMessagesRequestT {
  const parsed = AnthropicMessagesRequest.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw badRequest(`Invalid request: ${detail}`, "invalid_body");
  }
  return parsed.data;
}

/**
 * Fold Anthropic's out-of-band `system` field into a leading system turn, which
 * is how the port (and Ollama beneath it) expects a system prompt.
 */
function toPortMessages(req: AnthropicMessagesRequestT): LLMMessage[] {
  const out: LLMMessage[] = [];
  if (req.system !== undefined) {
    const { text } = flattenContent(req.system);
    if (text.trim().length > 0) out.push({ role: "system", content: text });
  }
  for (const m of req.messages) {
    const { text, images } = flattenContent(m.content);
    const msg: LLMMessage = { role: normalizeRole(m.role), content: text };
    out.push(images.length > 0 ? { ...msg, images } : msg);
  }
  return out;
}

/** `POST /v1/messages` -- buffered or SSE, per the request's `stream`. */
export async function handleAnthropicMessages(
  raw: unknown,
  deps: AnthropicRouteDeps,
  writer: ResponseWriter,
  signal?: AbortSignal,
): Promise<void> {
  const req = parseAnthropicRequest(raw);
  const newId = deps.newId ?? defaultIdFactory;

  const resolved = await deps.router.resolve(req.model);
  const portRequest = buildChatRequest({
    modelName: resolved.modelName,
    messages: toPortMessages(req),
    stream: req.stream === true,
    options: toLlmOptions({
      temperature: req.temperature,
      top_p: req.top_p,
      top_k: req.top_k,
      num_ctx: req.max_tokens,
    }),
  });

  const id = newId("msg");
  // Echo the client's requested model id, not the runtime's internal name.
  const model = req.model;

  if (req.stream === true) {
    const sse = writer.sse();
    try {
      sse.write(
        JSON.stringify({
          type: "message_start",
          message: messageEnvelope(id, model, [], null),
        }),
        "message_start",
      );
      sse.write(
        JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
        "content_block_start",
      );
      for await (const chunk of resolved.client.streamChat(portRequest, signal)) {
        if (chunk.done) break;
        const delta = chunk.message.content;
        if (delta.length === 0) continue;
        sse.write(
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: delta },
          }),
          "content_block_delta",
        );
      }
      sse.write(JSON.stringify({ type: "content_block_stop", index: 0 }), "content_block_stop");
      sse.write(
        JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          // Zeros until Phase 2.1 wires real token counting; see chatCore.ts.
          usage: { output_tokens: 0 },
        }),
        "message_delta",
      );
      sse.write(JSON.stringify({ type: "message_stop" }), "message_stop");
    } finally {
      sse.end();
    }
    return;
  }

  let content = "";
  for await (const chunk of resolved.client.streamChat(portRequest, signal)) {
    if (chunk.done) break;
    content += chunk.message.content;
  }

  writer.json(
    200,
    messageEnvelope(id, model, [{ type: "text", text: content }], "end_turn"),
  );
}

function messageEnvelope(
  id: string,
  model: string,
  content: readonly unknown[],
  stopReason: string | null,
): Record<string, unknown> {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    // Zeros until Phase 2.1 wires real token counting; see chatCore.ts.
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
