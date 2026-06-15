/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T015) -- shared mapper from the
 * in-memory conversation history to the vendor-neutral `LLMMessage[]` the
 * model-call path sends.
 *
 * Both the Chat pillar (`StreamingPipeline`) and the Coding pillar
 * (`AgentLoop`) assemble the outgoing prompt the same way; this helper keeps
 * the multimodal gate in one place. Image attachments are forwarded ONLY when
 * `allowImages` is true (the caller resolves this from the model's vision
 * capability via `isVisionCapableModel`). When the active model is text-only,
 * images are dropped so the model receives a clean text-only request.
 */

import type { Message } from "./types.js";
import type { LLMMessage } from "../llm/types.js";

/**
 * Map conversation history to LLM messages, attaching per-message images only
 * when the active model is vision-capable.
 *
 * @param history the conversation history (system + user + assistant turns)
 * @param allowImages whether the active model accepts image input
 */
export function toLlmMessages(
  history: readonly Message[],
  allowImages: boolean,
): LLMMessage[] {
  return history.map((m) => {
    if (allowImages && m.images && m.images.length > 0) {
      return { role: m.role, content: m.content, images: m.images };
    }
    return { role: m.role, content: m.content };
  });
}
