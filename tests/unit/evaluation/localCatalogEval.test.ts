import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  HostBelowModelTierError,
  assertHostMeetsTier,
  notRunEvalBlock,
  runCatalogModelEval,
  serializeGpu,
  writeLocalEvalDocument,
} from "../../../modules/coding/evaluation/localCatalogEval.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import type { AgentDriver } from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { CommandRunner } from "../../../modules/coding/evaluation/goldenCriteria.js";
import type { GitRunner } from "../../../modules/coding/evaluation/goldenSnapshot.js";

let snapshotRoot: string;
let workBase: string;
const noopGit: GitRunner = () => "";
const failCommand: CommandRunner = () => ({ code: 1, stdout: "", stderr: "", timedOut: false });

beforeEach(async () => {
  snapshotRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "local-eval-snaps-"));
  workBase = await fsp.mkdtemp(path.join(os.tmpdir(), "local-eval-work-"));
});

afterEach(async () => {
  await fsp.rm(snapshotRoot, { recursive: true, force: true });
  await fsp.rm(workBase, { recursive: true, force: true });
});

async function scaffold(taskId: string): Promise<GoldenTaskSpec> {
  const dir = path.join(snapshotRoot, taskId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "src.ts"), "DONE", "utf8");
  return {
    id: taskId,
    name: taskId,
    category: "test",
    description: "synthetic",
    initialState: `snapshots/${taskId}`,
    expectedFilesChanged: [],
    successCriteria: [{ type: "file_contains", target: "src.ts", pattern: "DONE" }],
    maxIterations: 5,
    timeoutSeconds: 60,
    modelTier: "any",
    tags: [],
  };
}

describe("localCatalogEval (v2.1.0 Phase 1)", () => {
  it("refuses to start below the model's VRAM tier", () => {
    expect(() => assertHostMeetsTier(12, 24)).toThrow(HostBelowModelTierError);
    expect(() => assertHostMeetsTier(24, 24)).not.toThrow();
  });

  it("marks a stubbed live suite pass and does not promote not_run blocks", async () => {
    const spec = await scaffold("ok");
    const driver: AgentDriver = {
      async run() {
        return {};
      },
    };
    const result = await runCatalogModelEval({
      spec: { id: "muse-glimmer:30b", requiredVramGB: 24, displayName: "Muse" },
      tasks: [spec],
      hostVramGb: 24,
      hardwareTier: "24GB",
      runnerOptions: {
        snapshotRoot,
        baseDir: workBase,
        gitRunner: noopGit,
        runCommand: failCommand,
        mode: "live",
      },
      driver,
    });
    expect(result.localEval.status).toBe("pass");
    expect(result.passed).toBe(1);
  });

  it("records incomplete when the driver times out", async () => {
    const spec = await scaffold("slow");
    const driver: AgentDriver = {
      async run() {
        return { error: "task timed out after 1ms" };
      },
    };
    const result = await runCatalogModelEval({
      spec: { id: "nemotron-lightning:30b-a3b", requiredVramGB: 24, displayName: "Lightning" },
      tasks: [spec],
      hostVramGb: 24,
      hardwareTier: "24GB",
      runnerOptions: {
        snapshotRoot,
        baseDir: workBase,
        gitRunner: noopGit,
        runCommand: failCommand,
        mode: "live",
      },
      driver,
    });
    expect(result.localEval.status).toBe("incomplete");
    expect(result.timedOut).toBeGreaterThan(0);
  });

  it("serializes concurrent GPU work", async () => {
    const order: number[] = [];
    await Promise.all([
      serializeGpu(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      }),
      serializeGpu(async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("writes a not_run document that forbids default-route promotion", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "local-eval-doc-"));
    const file = path.join(tmp, "eval.json");
    await writeLocalEvalDocument(file, [
      {
        modelId: "muse-glimmer:30b",
        localEval: notRunEvalBlock("no 24 GB host", "24GB"),
        passed: 0,
        failed: 0,
        timedOut: 0,
      },
    ]);
    const body = JSON.parse(await fsp.readFile(file, "utf8")) as {
      defaultRouteProposal: string;
    };
    expect(body.defaultRouteProposal).toMatch(/no-change/);
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
