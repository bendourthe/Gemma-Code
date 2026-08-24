import type { EpisodicEventInput, EpisodicMemory } from "../../../../core/memory/MemoryHub";
import { ipcCall } from "../../lib/ipc";

export type ChatEpisodicMemory = Pick<EpisodicMemory, "record">;

export interface ChatMemoryHubClient {
  readonly episodic: ChatEpisodicMemory;
}

export interface EpisodicSearchHit {
  readonly id: string;
  readonly content: string;
  readonly source?: string;
  readonly capturedAt: string;
  readonly scopeId?: string | null;
}

export function createIpcChatMemoryHub(): ChatMemoryHubClient {
  return {
    episodic: {
      async record(event: EpisodicEventInput): Promise<void> {
        const reply = await ipcCall<{ ok: true }>("memory.episodic.record", {
          id: event.id,
          content: event.content,
          ...(event.source ? { source: event.source } : {}),
          ...(event.scopeId !== undefined ? { scopeId: event.scopeId } : {}),
        });
        if (!reply.ok) throw new Error(reply.message);
      },
    },
  };
}

export async function searchIpcEpisodicMemory(input: {
  query: string;
  limit?: number;
  scopeId?: string | null;
}): Promise<readonly EpisodicSearchHit[]> {
  const reply = await ipcCall<{ hits: EpisodicSearchHit[] }>(
    "memory.episodic.search",
    input,
  );
  if (!reply.ok) throw new Error(reply.message);
  return reply.value.hits;
}
