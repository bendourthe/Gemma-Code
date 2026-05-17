// v0.9.0 Phase 5 sub-task 5.3 -- shared Zod schema for agent-batch specs.
//
// A spec describes a batched dispatch of multiple agent runs over a set of
// GitHub issues. Each task selects an agent (claude / codex / cursor),
// optionally appends extra prompt text, and optionally declares dependencies
// on other tasks (by issue number) that must complete first.

import { z } from "zod";

export const AgentNameSchema = z.enum(["claude", "codex", "cursor"]);

export const AgentBatchTaskSchema = z.object({
  issue: z.number().int().positive(),
  agent: AgentNameSchema,
  extraPrompt: z.string().optional(),
  dependsOn: z.array(z.number().int().positive()).default([]),
});

export const AgentBatchSpecSchema = z.object({
  batchId: z.string().min(1),
  tasks: z.array(AgentBatchTaskSchema).min(1),
});

export function parseSpec(raw) {
  return AgentBatchSpecSchema.parse(raw);
}

export function safeParseSpec(raw) {
  return AgentBatchSpecSchema.safeParse(raw);
}
