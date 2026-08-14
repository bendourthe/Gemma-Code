/**
 * v1.16.0 Phase 1.3 (adoption item A1) -- OpenAI-compatible routes.
 *
 *   GET  /v1/models            -> the installed chat-capable models
 *   POST /v1/chat/completions  -> buffered or SSE-streamed completion
 *
 * Shapes follow the OpenAI REST contract closely enough that an unmodified
 * OpenAI-compatible client (Codex, the `openai` SDK, plain `curl`) works against
 * the gateway with only a base URL + key change. Request parsing, model
 * resolution, and error mapping are shared with the Anthropic route via
 * `chatCore.ts`.
 */

import { z } from "zod";
import type { LLMMessage } from "../../../../modules/coding/llm/types.js";
import {
  type CollectedUsage,
  type IdFactory,
  type NowFactory,
  type ResponseWriter,
  WireContent,
  buildChatRequest,
  collectUsage,
  defaultIdFactory,
  defaultNow,
  flattenContent,
  newUsage,
  normalizeRole,
  toLlmOptions,
} from "./chatCore.js";
import { badRequest } from "./errors.js";
import type { ModelRouter } from "./modelRouter.js";

const OpenAiMessage = z
  .object({
    role: z.string().min(1),
    content: WireContent.nullish(),
  })
  .passthrough();

export const OpenAiChatRequest = z
  .object({
    model: z.string().min(1, "'model' is required."),
    messages: z.array(OpenAiMessage).min(1, "'messages' must contain at least one message."),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
  })
  .passthrough();

export type OpenAiChatRequestT = z.infer<typeof OpenAiChatRequest>;

export interface OpenAiRouteDeps {
  readonly router: ModelRouter;
  readonly newId?: IdFactory;
  readonly now?: NowFactory;
}

/** Parse an untrusted body into the OpenAI request, mapping zod issues to 400. */
export function parseOpenAiChatRequest(raw: unknown): OpenAiChatRequestT {
  const parsed = OpenAiChatRequest.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw badRequest(`Invalid request: ${detail}`, "invalid_body");
  }
  return parsed.data;
}

function toPortMessages(req: OpenAiChatRequestT): LLMMessage[] {
  return req.messages.map((m) => {
    const { text, images } = flattenContent(m.content ?? "");
    const msg: LLMMessage = { role: normalizeRole(m.role), content: text };
    return images.length > 0 ? { ...msg, images } : msg;
  });
}

/** `GET /v1/models` -- OpenAI models-list shape over the installed registry slice. */
export async function handleOpenAiListModels(
  deps: OpenAiRouteDeps,
  writer: ResponseWriter,
): Promise<void> {
  const now = (deps.now ?? defaultNow)();
  const models = await deps.router.listModels();
  writer.json(200, {
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: now,
      owned_by: m.ownedBy,
    })),
  });
}

/** `POST /v1/chat/completions` -- buffered or SSE, per the request's `stream`. */
export async function handleOpenAiChatCompletion(
  raw: unknown,
  deps: OpenAiRouteDeps,
  writer: ResponseWriter,
  signal?: AbortSignal,
): Promise<void> {
  const req = parseOpenAiChatRequest(raw);
  const newId = deps.newId ?? defaultIdFactory;
  const now = deps.now ?? defaultNow;

  const resolved = await deps.router.resolve(req.model);
  const portRequest = buildChatRequest({
    modelName: resolved.modelName,
    messages: toPortMessages(req),
    stream: req.stream === true,
    options: toLlmOptions({
      temperature: req.temperature,
      top_p: req.top_p,
      top_k: req.top_k,
    }),
  });

  const id = newId("chatcmpl");
  const created = now();
  // The response echoes the model id the CLIENT asked for, not the runtime's
  // internal name, so a client comparing request to response sees a match.
  const model = req.model;

  const usage = newUsage();

  if (req.stream === true) {
    const sse = writer.sse();
    try {
      // Role-only opening delta, per the OpenAI streaming contract.
      sse.write(
        JSON.stringify(chunkEnvelope(id, created, model, { role: "assistant", content: "" }, null)),
      );
      for await (const chunk of resolved.client.streamChat(portRequest, signal)) {
        collectUsage(chunk, usage);
        if (chunk.done) break;
        const delta = chunk.message.content;
        if (delta.length === 0) continue;
        sse.write(JSON.stringify(chunkEnvelope(id, created, model, { content: delta }, null)));
      }
      // v1.16.0 Phase 2.1: the finish chunk carries usage, matching OpenAI's
      // `stream_options.include_usage` behavior. Harmless to a client that
      // ignores it, and the only place a streamed request can report counts.
      sse.write(
        JSON.stringify({
          ...chunkEnvelope(id, created, model, {}, "stop"),
          usage: usageEnvelope(usage),
        }),
      );
      sse.write("[DONE]");
    } finally {
      sse.end();
    }
    return;
  }

  let content = "";
  for await (const chunk of resolved.client.streamChat(portRequest, signal)) {
    collectUsage(chunk, usage);
    if (chunk.done) break;
    content += chunk.message.content;
  }

  writer.json(200, {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: usageEnvelope(usage),
  });
}

/** OpenAI usage block. Real counts when the backend reported them (LSO.P1.A). */
function usageEnvelope(usage: CollectedUsage): Record<string, number> {
  return {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.promptTokens + usage.completionTokens,
  };
}

function chunkEnvelope(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
