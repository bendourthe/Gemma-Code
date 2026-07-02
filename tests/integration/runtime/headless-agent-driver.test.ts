import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GoldenSuccessCriterion } from "../../../modules/coding/evaluation/goldenCriteria.js";
import { runGoldenTask } from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import type { LLMClient } from "../../../modules/coding/llm/types.js";
import { HeadlessAgentDriver } from "../../../modules/coding/runtime/HeadlessAgentDriver.js";

let snapshotRoot: string;

beforeEach(async () => {
  snapshotRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-driver-snap-"));
});
afterEach(async () => {
  await fsp.rm(snapshotRoot, { recursive: true, force: true });
});

const TASK_ID = "answer-task";

async function seedSnapshot(): Promise<void> {
  await fsp.mkdir(path.join(snapshotRoot, TASK_ID), { recursive: true });
}

function makeSpec(criteria: GoldenSuccessCriterion[]): GoldenTaskSpec {
  return {
    id: TASK_ID,
    name: "Answer task",
    category: "codegen",
    description: "Create answer.ts exporting the answer 42.",
    initialState: `snapshots/${TASK_ID}`,
    expectedFilesChanged: ["answer.ts"],
    successCriteria: criteria,
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

function scriptedLlm(responses: string[]): LLMClient {
  let i = 0;
  return {
    async checkHealth() {
      return true;
    },
    async listModels() {
      return [];
    },
    async *streamChat() {
      const text = responses[i++] ?? "Done.";
      yield { message: { role: "assistant", content: text }, done: true };
    },
  };
}

describe("HeadlessAgentDriver end-to-end via runGoldenTask", () => {
  it("drives a real task to a passing result and maps metrics", async () => {
    await seedSnapshot();
    const llm = scriptedLlm([
      toolCall("create_file", {
        path: "answer.ts",
        content: "export const answer = 42;",
      }),
      "Created answer.ts. Done.",
    ]);
    const driver = new HeadlessAgentDriver({ llm, model: "test-model" });

    const result = await runGoldenTask(
      makeSpec([{ type: "file_contains", target: "answer.ts", pattern: "answer = 42" }]),
      { mode: "live", driver, snapshotRoot, initGit: false },
    );

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics.toolStepCount).toBe(1);
    expect(result.metrics.llmCallCount).toBe(2);
  });

  it("reports a failing result when the agent does not satisfy the criteria", async () => {
    await seedSnapshot();
    const llm = scriptedLlm([
      toolCall("create_file", { path: "answer.ts", content: "export const answer = 7;" }),
      "Done (wrong value).",
    ]);
    const driver = new HeadlessAgentDriver({ llm, model: "test-model" });

    const result = await runGoldenTask(
      makeSpec([{ type: "file_contains", target: "answer.ts", pattern: "answer = 42" }]),
      { mode: "live", driver, snapshotRoot, initGit: false },
    );

    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
