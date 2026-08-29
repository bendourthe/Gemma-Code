import { ipc, type IpcReply } from "../../lib/ipc";
import type { GenerationJob } from "../../../../core/generations/GenerationQueue";
import type { BatchSpec } from "../../../../core/generations/batchExpand";

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

export interface GenerationQueueClient {
  list(): Promise<readonly GenerationJob[]>;
  enqueue(input: {
    pillar: "image" | "video";
    jobType: string;
    parameters: Record<string, unknown>;
    priority?: "interactive" | "batch";
    batchSpec?: BatchSpec;
  }): Promise<readonly GenerationJob[]>;
  cancel(id: string): Promise<GenerationJob | null>;
  reorder(ids: readonly string[]): Promise<void>;
  pendingCount(): Promise<number>;
}

export function createIpcGenerationQueueClient(): GenerationQueueClient {
  return {
    async list() {
      const value = unwrap(
        await ipc.call<{ jobs: GenerationJob[] }>("generation.queue.list", {}),
      );
      return value.jobs;
    },
    async enqueue(input) {
      const value = unwrap(
        await ipc.call<{ jobs: GenerationJob[] }>(
          "generation.queue.enqueue",
          input as unknown as Record<string, unknown>,
        ),
      );
      return value.jobs;
    },
    async cancel(id) {
      const value = unwrap(
        await ipc.call<{ job: GenerationJob | null }>(
          "generation.queue.cancel",
          { id },
        ),
      );
      return value.job;
    },
    async reorder(ids) {
      unwrap(
        await ipc.call<{ ok: true }>("generation.queue.reorder", {
          ids: [...ids],
        }),
      );
    },
    async pendingCount() {
      const value = unwrap(
        await ipc.call<{ count: number }>("generation.queue.pendingCount", {}),
      );
      return value.count;
    },
  };
}

export class InMemoryGenerationQueueClient implements GenerationQueueClient {
  public jobs: GenerationJob[] = [];

  async list(): Promise<readonly GenerationJob[]> {
    return this.jobs;
  }
  async enqueue(input: {
    pillar: "image" | "video";
    jobType: string;
    parameters: Record<string, unknown>;
    priority?: "interactive" | "batch";
    batchSpec?: BatchSpec;
  }): Promise<readonly GenerationJob[]> {
    const job: GenerationJob = {
      id: `q-${this.jobs.length + 1}`,
      pillar: input.pillar,
      jobType: input.jobType,
      parameters: input.parameters,
      batchSpec: input.batchSpec ?? null,
      parentId: null,
      enhancement: null,
      sortOrder: this.jobs.length,
      state: "queued",
      priority: input.priority ?? "batch",
      threadId: null,
      error: null,
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z",
    };
    this.jobs.push(job);
    return [job];
  }
  async cancel(id: string): Promise<GenerationJob | null> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return null;
    const next = { ...job, state: "failed" as const, error: "cancelled" };
    this.jobs = this.jobs.map((j) => (j.id === id ? next : j));
    return next;
  }
  async reorder(ids: readonly string[]): Promise<void> {
    this.jobs = ids
      .map((id, sortOrder) => {
        const job = this.jobs.find((j) => j.id === id);
        return job ? { ...job, sortOrder } : null;
      })
      .filter((j): j is GenerationJob => j !== null);
  }
  async pendingCount(): Promise<number> {
    return this.jobs.filter(
      (j) => j.state === "queued" || j.state === "running",
    ).length;
  }
}
