/**
 * v2.1.0 Phase 1 -- local golden-task re-verification of vendor catalog claims.
 *
 * Vendor-reported scores stay in `vendorReported` and must not drive routing
 * until this runner records a `localEval` block. The runner refuses to start
 * below the model's VRAM tier, serializes GPU-bound suite runs, and marks a
 * timed-out or OOM suite `incomplete` rather than silently passing.
 *
 * Boundary: vscode-free. Live agent execution is injected (`AgentDriver` via
 * GoldenTaskRunner); tests stub the driver.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LocalEvalBlock, LocalEvalStatus, ModelSpec } from "../../../core/registry/catalog.js";
import { localEvalMayPromote } from "../../../core/registry/catalog.js";
import type { GoldenTaskSpec } from "./goldenTaskLoader.js";
import {
  runGoldenTask,
  type AgentDriver,
  type GoldenRunOptions,
} from "./GoldenTaskRunner.js";

export class HostBelowModelTierError extends Error {
  readonly hostVramGb: number;
  readonly requiredVramGb: number;

  constructor(hostVramGb: number, requiredVramGb: number) {
    super(
      `Golden-task suite refused: host ${hostVramGb} GB VRAM is below the model's ${requiredVramGb} GB tier`,
    );
    this.name = "HostBelowModelTierError";
    this.hostVramGb = hostVramGb;
    this.requiredVramGb = requiredVramGb;
  }
}

export interface CatalogModelEvalInput {
  readonly spec: Pick<ModelSpec, "id" | "requiredVramGB" | "vramGB" | "displayName">;
  readonly tasks: readonly GoldenTaskSpec[];
  readonly hostVramGb: number;
  readonly hardwareTier: string;
  readonly runnerOptions: GoldenRunOptions;
  readonly driver?: AgentDriver;
  readonly now?: () => Date;
}

export interface CatalogModelEvalResult {
  readonly modelId: string;
  readonly localEval: LocalEvalBlock;
  readonly passed: number;
  readonly failed: number;
  readonly timedOut: number;
}

let gpuTail: Promise<void> = Promise.resolve();

/** Serialize GPU-bound eval runs so two suites never share the same GPU. */
export function serializeGpu<T>(fn: () => Promise<T>): Promise<T> {
  const run = gpuTail.then(fn, fn);
  gpuTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function requiredVramForSpec(
  spec: Pick<ModelSpec, "requiredVramGB" | "vramGB">,
): number {
  const required = spec.requiredVramGB ?? spec.vramGB ?? 0;
  return typeof required === "number" && Number.isFinite(required) ? required : 0;
}

export function assertHostMeetsTier(hostVramGb: number, requiredVramGb: number): void {
  if (hostVramGb < requiredVramGb) {
    throw new HostBelowModelTierError(hostVramGb, requiredVramGb);
  }
}

function isoDate(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

function statusFor(counts: {
  readonly passed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly total: number;
}): LocalEvalStatus {
  if (counts.timedOut > 0 || counts.passed + counts.failed < counts.total) {
    return "incomplete";
  }
  if (counts.failed > 0) return "fail";
  if (counts.passed === counts.total && counts.total > 0) return "pass";
  return "not_run";
}

/**
 * Run the golden-task suite against one catalog model. Refuses below-tier
 * hosts. Concurrent callers are serialized on the GPU lock.
 */
export function runCatalogModelEval(
  input: CatalogModelEvalInput,
): Promise<CatalogModelEvalResult> {
  return serializeGpu(async () => {
    const required = requiredVramForSpec(input.spec);
    assertHostMeetsTier(input.hostVramGb, required);
    const now = input.now ?? (() => new Date());
    const options: GoldenRunOptions = {
      ...input.runnerOptions,
      mode: input.runnerOptions.mode ?? "live",
      driver: input.driver ?? input.runnerOptions.driver,
    };

    let passed = 0;
    let failed = 0;
    let timedOut = 0;
    const failures: string[] = [];

    for (const task of input.tasks) {
      const result = await runGoldenTask(task, options);
      if (result.failures.some((f) => /timed out/i.test(f))) {
        timedOut += 1;
        failures.push(`${task.id}: timeout`);
        continue;
      }
      if (result.passed) {
        passed += 1;
      } else {
        failed += 1;
        failures.push(`${task.id}: ${result.failures.join("; ") || "failed"}`);
      }
    }

    const status = statusFor({
      passed,
      failed,
      timedOut,
      total: input.tasks.length,
    });
    const localEval: LocalEvalBlock = {
      suite: "nexus-golden-task",
      status,
      date: isoDate(now),
      hardwareTier: input.hardwareTier,
      result:
        status === "pass"
          ? `${passed}/${input.tasks.length} golden tasks passed`
          : failures.slice(0, 8).join(" | ") || `${status}: ${passed} passed, ${failed} failed, ${timedOut} timed out`,
      reason:
        status === "pass"
          ? undefined
          : status === "incomplete"
            ? "Suite did not finish (timeout or OOM). Vendor-reported figures remain the only scores."
            : undefined,
    };

    return {
      modelId: input.spec.id,
      localEval,
      passed,
      failed,
      timedOut,
    };
  });
}

/** Persist a local-eval JSON document next to the version's benchmarks. */
export async function writeLocalEvalDocument(
  filePath: string,
  results: readonly CatalogModelEvalResult[],
): Promise<void> {
  const body = {
    suite: "nexus-golden-task",
    date: new Date().toISOString().slice(0, 10),
    defaultRouteProposal: results.every((r) => localEvalMayPromote({ localEval: r.localEval }))
      ? "eligible-for-proposal"
      : "no-change: local eval is not a passing recorded result",
    results: results.map((r) => ({
      modelId: r.modelId,
      localEval: r.localEval,
      passed: r.passed,
      failed: r.failed,
      timedOut: r.timedOut,
    })),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/** Record a not-run block when the host cannot execute the live suite. */
export function notRunEvalBlock(reason: string, hardwareTier: string, date = "2026-08-20"): LocalEvalBlock {
  return {
    suite: "nexus-golden-task",
    status: "not_run",
    date,
    hardwareTier,
    reason,
  };
}
