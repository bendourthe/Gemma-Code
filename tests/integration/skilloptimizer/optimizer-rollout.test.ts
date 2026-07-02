import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import type { LLMChatRequest, LLMClient } from "../../../modules/coding/llm/types.js";
import { HeadlessOptimizerRollout } from "../../../modules/coding/skilloptimizer/HeadlessOptimizerRollout.js";

let snapshotRoot: string;

beforeEach(async () => {
  snapshotRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-rollout-snap-"));
});
afterEach(async () => {
  await fsp.rm(snapshotRoot, { recursive: true, force: true });
});

const TASK_ID = "greet-task";

async function seedSnapshot(): Promise<void> {
  await fsp.mkdir(path.join(snapshotRoot, TASK_ID), { recursive: true });
}

function spec(): GoldenTaskSpec {
  return {
    id: TASK_ID,
    name: "Greet task",
    category: "codegen",
    description: "Create greeting.ts exporting hello().",
    initialState: `snapshots/${TASK_ID}`,
    expectedFilesChanged: ["greeting.ts"],
    successCriteria: [{ type: "file_contains", target: "greeting.ts", pattern: "hello" }],
    maxIterations: 5,
    timeoutSeconds: 30,
    modelTier: "balanced",
    tags: ["codegen"],
  };
}

function toolCall(name: string, args: Record<string, string>): string {
  const body = Object.entries(args)
    .map(([k, v]) => `${k}:<|"|>${v}<|"|>`)
    .join("");
  return `<|tool_call>call:${name}{${body}}<tool_call|>`;
}

function scriptedLlm(responses: string[]): { client: LLMClient; requests: LLMChatRequest[] } {
  let i = 0;
  const requests: LLMChatRequest[] = [];
  const client: LLMClient = {
    async checkHealth() {
      return true;
    },
    async listModels() {
      return [];
    },
    async *streamChat(request) {
      requests.push(request);
      const text = responses[i++] ?? "Done.";
      yield { message: { role: "assistant", content: text }, done: true };
    },
  };
  return { client, requests };
}

describe("HeadlessOptimizerRollout (SO003.P3.B)", () => {
  it("runs the baseline rollout over a task set and returns scored results", async () => {
    await seedSnapshot();
    const { client } = scriptedLlm([
      toolCall("create_file", {
        path: "greeting.ts",
        content: "export const hello = () => 'hi';",
      }),
      "Done.",
    ]);
    const rollout = new HeadlessOptimizerRollout({ llm: client, model: "m", snapshotRoot });

    const results = await rollout.run([spec()]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.taskId).toBe(TASK_ID);
  });

  it("injects the candidate skill body into the rollout when a SkillOverride is passed", async () => {
    await seedSnapshot();
    const { client, requests } = scriptedLlm([
      toolCall("create_file", { path: "greeting.ts", content: "export const hello = 1;" }),
      "Done.",
    ]);
    const rollout = new HeadlessOptimizerRollout({ llm: client, model: "m", snapshotRoot });

    const results = await rollout.run([spec()], {
      skillId: "coding/greet",
      body: "RULE: always export hello",
    });

    expect(results).toHaveLength(1);
    const system = requests[0]?.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("RULE: always export hello");
  });
});
