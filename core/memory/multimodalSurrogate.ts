/**
 * v2.1.0 Phase 4 -- indexable text for a non-text chat turn.
 *
 * Bytes never enter memory. Retrieval matches the caption/summary surrogate.
 */

import { redactSecrets } from "../observability/redactSecrets.js";
import type { EpisodicMemory } from "./MemoryHub.js";

export interface MultimodalTurnInput {
  readonly id: string;
  readonly prompt: string;
  readonly kinds: readonly string[];
  readonly mime?: string;
  readonly source?: string;
}

export function multimodalSurrogate(input: MultimodalTurnInput): string {
  const kinds = input.kinds.length > 0 ? input.kinds.join(", ") : "attachment";
  const mime = input.mime ? ` (${input.mime})` : "";
  const prompt = input.prompt.trim() || "(no text)";
  return redactSecrets(`[multimodal ${kinds}${mime}] ${prompt}`);
}

export async function recordMultimodalTurn(
  episodic: Pick<EpisodicMemory, "record">,
  input: MultimodalTurnInput,
): Promise<string> {
  const content = multimodalSurrogate(input);
  await episodic.record({
    id: input.id,
    content,
    source: input.source ?? "chat-multimodal",
  });
  return content;
}
