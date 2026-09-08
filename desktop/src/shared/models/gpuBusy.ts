/**
 * v2.4.8 follow-up (2026-09-07) -- "switch from X to Y?" before a job runs.
 *
 * Operator report: after a chat reply the GPU still held Gemma 4, yet Images
 * started a job with no question asked, because the only thing checked was a
 * *running* scheduler job and the chat turn had already finished. What is
 * loaded matters as much as what is running: Ollama keeps a model resident
 * for minutes after its last reply, and that is the model the GPU card shows.
 * The holder is resolved from both -- the running job first, then residency --
 * and named the way the rest of the app names models, not by its raw tag.
 */

import { ipcCall } from "../../lib/ipc";
import type { SchedulerActiveJob } from "./schedulerResidency";

/** Sidebar tab names for the scheduler module ids. */
export const GPU_TAB_LABELS: Record<string, string> = {
  chat: "Chatbot",
  coding: "Agents",
  image: "Images",
  video: "Videos",
  tuning: "Training",
};

export function gpuTabLabel(moduleId: string): string {
  return GPU_TAB_LABELS[moduleId] ?? moduleId;
}

/** The kind of model a surface is asking to load, for the dialog title. */
export type GpuPillar = "chat" | "agentic" | "image" | "video";

const PILLAR_LABELS: Record<GpuPillar, string> = {
  chat: "Chat",
  agentic: "Agent",
  image: "Image",
  video: "Video",
};

/** What currently owns the GPU, ready for the dialog copy. */
export interface GpuHolder {
  /** What to call it: a model name when known, else "A task in Chatbot". */
  readonly label: string;
  /** True when work is in flight and switching would stop it. */
  readonly running: boolean;
}

export type GpuSwitchPrompt = { readonly holder: GpuHolder } & (
  | {
      readonly kind: "submit";
      readonly text: string;
      readonly attachments: readonly string[];
      readonly retryAssistantId?: string;
    }
  | { readonly kind: "queued"; readonly jobId: string; readonly messageId: string }
);

/** Ollama tags carry a `:tag`; compare on the bare name so `gemma4:12b` matches. */
function sameModel(a: string, b: string): boolean {
  const bare = (id: string): string => id.toLowerCase().split(":")[0] ?? id.toLowerCase();
  return bare(a) === bare(b);
}

interface ResidentDto {
  readonly name: string;
  readonly displayName?: string;
}

async function residentModels(): Promise<ResidentDto[]> {
  const reply = await ipcCall<{ models: ResidentDto[] }>("models.resident", {});
  return reply.ok ? reply.value.models : [];
}

/**
 * Who holds the GPU right now, or null when it is free for `targetModelId`.
 * `nameFor` maps a model id to its catalog display name.
 */
export async function resolveGpuHolder(input: {
  readonly active: SchedulerActiveJob | null | undefined;
  readonly targetModelId: string;
  readonly nameFor: (modelId: string) => string;
}): Promise<GpuHolder | null> {
  const { active, targetModelId, nameFor } = input;
  if (active) {
    return {
      label: active.modelId
        ? nameFor(active.modelId)
        : `A task in ${gpuTabLabel(active.moduleId)}`,
      running: true,
    };
  }
  const resident = (await residentModels()).filter(
    (model) => !sameModel(model.name, targetModelId),
  );
  const first = resident[0];
  if (!first) return null;
  // The sidecar resolves the catalog name; the raw tag is the fallback.
  return { label: first.displayName ?? nameFor(first.name), running: false };
}

/** The holder named by a runtime `queued` report (a job we cannot see). */
export function queuedHolder(blockedBy: string | undefined): GpuHolder {
  return { label: `A task in ${gpuTabLabel(blockedBy ?? "image")}`, running: true };
}

/** "Switch to Image model: RealVisXL V5.0?" */
export function gpuSwitchTitle(pillar: GpuPillar, targetModelName: string): string {
  return `Switch to ${PILLAR_LABELS[pillar]} model: ${targetModelName}?`;
}

/** The two body lines: what holds the GPU, then what switching does. */
export function gpuSwitchBody(
  holder: GpuHolder,
  targetModelName: string,
): readonly string[] {
  return holder.running
    ? [
        `${holder.label} is currently running on the GPU.`,
        `Switching will stop it, clear the GPU, and load ${targetModelName}.`,
      ]
    : [
        `${holder.label} is the model currently loaded on the GPU.`,
        `Switching will unload it, clear the GPU, and load ${targetModelName}.`,
      ];
}

/** Clear the GPU: cancel the running scheduler job and evict Ollama residents. */
export async function cancelActiveGpuJob(): Promise<boolean> {
  const reply = await ipcCall<{
    cancelled: { id: string; moduleId: string } | null;
  }>("generation.scheduler.cancelActive", {});
  return reply.ok && reply.value.cancelled !== null;
}
