import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import type { SplitGoldenTaskSpec } from "../../../modules/coding/evaluation/goldenSplit.js";
import type { LLMClient, LLMChatRequest } from "../../../modules/coding/llm/types.js";
import type { Skill } from "../../../core/skills/SkillCatalog.js";
import type {
  RejectedEditBufferPort,
  SkillEditApprovalRequest,
} from "../../../modules/coding/skilloptimizer/types.js";
import {
  CapturingApprovalGate,
  autoApproveApprovalGate,
  autoDenyApprovalGate,
  createHeadlessCandidateFrontier,
  createHeadlessSkillOptimizer,
} from "../../../modules/coding/skilloptimizer/HeadlessOptimizerFactory.js";

// v1.12.0 Phase 2 (adoption-ecosystem-2026-07 L1 / EM005) -- the composition
// root that assembles a runnable SkillOptimizer from the shipped v1.7.0 seams.
// The load-bearing guarantee carried from v1.7 is: no skill file is written
// without approval. Here the train split PASSES, so the loop finds no failing
// trajectory, proposes nothing, and (with the deny gate) writes nothing -- the
// robust, non-brittle assertion. The SkillOptimizer's deeper "deny blocks an
// accepted edit" path is already covered by tests/unit/skilloptimizer.

let workRoot: string;
let snapshotRoot: string;
let catalogRoot: string;

beforeEach(async () => {
  workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-opt-factory-"));
  snapshotRoot = path.join(workRoot, "snap");
  catalogRoot = path.join(workRoot, "skills");
  await fsp.mkdir(snapshotRoot, { recursive: true });
  await fsp.mkdir(catalogRoot, { recursive: true });
});
afterEach(async () => {
  await fsp.rm(workRoot, { recursive: true, force: true });
});

const inMemoryBuffer: RejectedEditBufferPort = {
  has: () => false,
  record: () => ({}),
};

async function seedSnapshot(id: string): Promise<void> {
  await fsp.mkdir(path.join(snapshotRoot, id), { recursive: true });
}

function baseSpec(id: string): GoldenTaskSpec {
  return {
    id,
    name: `task ${id}`,
    category: "codegen",
    description: "Create greeting.ts exporting hello().",
    initialState: `snapshots/${id}`,
    expectedFilesChanged: ["greeting.ts"],
    successCriteria: [{ type: "file_contains", target: "greeting.ts", pattern: "hello" }],
    maxIterations: 5,
    timeoutSeconds: 30,
    modelTier: "balanced",
    tags: ["codegen"],
  } as unknown as GoldenTaskSpec;
}

function split(id: string, s: "train" | "validation"): SplitGoldenTaskSpec {
  return { ...baseSpec(id), split: s } as SplitGoldenTaskSpec;
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

async function seedSkill(): Promise<Skill> {
  const dir = path.join(catalogRoot, "code-quality");
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  await fsp.writeFile(file, "---\nname: code-quality\n---\nBODY original.\n");
  return {
    id: "nexus-hub/code-quality",
    displayName: "code-quality",
    path: file,
    provenance: { source: "nexus-hub", contentHash: "x" },
    frontmatter: { name: "code-quality" },
    body: "BODY original.",
  } as unknown as Skill;
}

describe("createHeadlessSkillOptimizer (L1 / EM005)", () => {
  it("assembles a runnable optimizer and writes nothing when the train split passes (deny gate)", async () => {
    const TRAIN_ID = "train-pass";
    await seedSnapshot(TRAIN_ID);
    await seedSnapshot("val-1");
    const skill = await seedSkill();
    const before = await fsp.readFile(skill.path, "utf8");

    const { client } = scriptedLlm([
      toolCall("create_file", { path: "greeting.ts", content: "export const hello = () => 'hi';" }),
      "Done.",
    ]);

    const optimizer = createHeadlessSkillOptimizer({
      llm: client,
      model: "m",
      snapshotRoot,
      catalogRoot: path.dirname(skill.path),
      buffer: inMemoryBuffer,
      approvalGate: autoDenyApprovalGate,
      config: { maxRounds: 2, learningRate: { maxOps: 2, maxChangedChars: 200 } },
      now: () => 1000,
    });

    const result = await optimizer.optimize({
      target: skill,
      train: [split(TRAIN_ID, "train")],
      validation: [split("val-1", "validation")],
    });

    expect(result.appliedCount).toBe(0);
    expect(typeof result.stopReason).toBe("string");
    const after = await fsp.readFile(skill.path, "utf8");
    expect(after).toBe(before); // the deny gate + passing train => no write
  });

  it("the bundled approval gates are terminal (deny=false, approve=true)", async () => {
    const req = {
      skillId: "s",
      skillPath: "/x",
      diff: "d",
    } as unknown as SkillEditApprovalRequest;
    expect(await autoDenyApprovalGate.requestApproval(req)).toBe(false);
    expect(await autoApproveApprovalGate.requestApproval(req)).toBe(true);
  });

  it("CapturingApprovalGate records the write-ready request and denies (never writes)", async () => {
    const gate = new CapturingApprovalGate();
    const req = {
      skillId: "s",
      skillPath: "/p",
      diff: "d",
      newContent: "NEW BODY",
    } as unknown as SkillEditApprovalRequest;
    expect(await gate.requestApproval(req)).toBe(false);
    expect(gate.captured).toEqual([
      { skillId: "s", skillPath: "/p", diff: "d", newContent: "NEW BODY" },
    ]);
  });

  it("wires the optional critic pre-filter without error (withCritic)", () => {
    const { client } = scriptedLlm([]);
    const optimizer = createHeadlessSkillOptimizer({
      llm: client,
      model: "m",
      snapshotRoot,
      catalogRoot,
      buffer: inMemoryBuffer,
      approvalGate: autoApproveApprovalGate,
      config: { maxRounds: 1, learningRate: { maxOps: 1, maxChangedChars: 100 } },
      withCritic: true,
    });
    expect(typeof optimizer.optimize).toBe("function");
  });
});

describe("createHeadlessCandidateFrontier (L1 / EM.P2.B)", () => {
  it("assembles a runnable frontier and promotes nothing when the train split passes", async () => {
    const TRAIN_ID = "train-pass";
    await seedSnapshot(TRAIN_ID);
    await seedSnapshot("val-1");
    const skill = await seedSkill();
    const before = await fsp.readFile(skill.path, "utf8");

    const { client } = scriptedLlm([
      toolCall("create_file", { path: "greeting.ts", content: "export const hello = () => 'hi';" }),
      "Done.",
    ]);

    const frontier = await createHeadlessCandidateFrontier({
      llm: client,
      model: "m",
      snapshotRoot,
      skill: { id: skill.id, path: skill.path, body: skill.body },
      train: [split(TRAIN_ID, "train")],
      validation: [split("val-1", "validation")],
      approvalGate: autoDenyApprovalGate,
      maxCandidates: 3,
      budget: { maxOps: 2, maxChangedChars: 200 },
      gitRunner: async () => null, // no git => isolation degrades (not exercised: no candidates)
      now: () => 1000,
    });

    const result = await frontier.evolve();
    expect(result.promoted).toBe(false);
    expect(result.approvalRequested).toBe(false);
    expect(result.frontier.length).toBe(0);
    const after = await fsp.readFile(skill.path, "utf8");
    expect(after).toBe(before); // passing train => no candidates => nothing promoted
  });
});
