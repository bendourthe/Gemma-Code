import { describe, it, expect, vi } from "vitest";
import { ReflexionEngine } from "../../../modules/coding/orchestration/ReflexionEngine.js";
import { ReflexionDiagnoser } from "../../../modules/coding/skilloptimizer/ReflexionDiagnoser.js";
import type { FailingTrajectory } from "../../../modules/coding/skilloptimizer/types.js";
import { makeOllamaClient } from "../../helpers/factories.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- unit tests for
 * the ReflexionEngine-backed failure diagnoser: it aggregates per-trajectory
 * analyses and treats trajectory text as untrusted input (redactSecrets before
 * the text reaches the model).
 */

function trajectory(over: Partial<FailingTrajectory> = {}): FailingTrajectory {
  return {
    taskId: "t1",
    taskName: "Task 1",
    taskDescription: "do the thing",
    failures: ["criterion X failed"],
    ...over,
  };
}

describe("ReflexionDiagnoser", () => {
  it("returns an empty diagnosis for an empty minibatch", async () => {
    const diagnoser = new ReflexionDiagnoser(new ReflexionEngine(makeOllamaClient("unused"), "m", {}, null));
    expect(await diagnoser.diagnose([])).toBe("");
  });

  it("aggregates each trajectory's analysis, tagged by task id", async () => {
    const reflexion = new ReflexionEngine(makeOllamaClient("The skill text is too vague."), "m", {}, null);
    const diagnoser = new ReflexionDiagnoser(reflexion);
    const out = await diagnoser.diagnose([trajectory({ taskId: "alpha" }), trajectory({ taskId: "beta" })]);
    expect(out).toContain("Diagnosis of 2 failing task(s)");
    expect(out).toContain("[alpha]");
    expect(out).toContain("[beta]");
    expect(out).toContain("The skill text is too vague.");
  });

  it("substitutes a placeholder when a trajectory carries no failure detail", async () => {
    const client = makeOllamaClient("analysis");
    const diagnoser = new ReflexionDiagnoser(new ReflexionEngine(client, "m", {}, null));
    await diagnoser.diagnose([trajectory({ failures: [] })]);
    const userContent = vi.mocked(client.streamChat).mock.calls[0]![0].messages.map((m) => m.content).join("\n");
    expect(userContent).toContain("(no failure detail recorded)");
  });

  it("redacts secrets in failure + description text before it reaches the model", async () => {
    const client = makeOllamaClient("analysis");
    const diagnoser = new ReflexionDiagnoser(new ReflexionEngine(client, "m", {}, null));
    const secret = "ghp_0123456789012345678901234567890123456";
    await diagnoser.diagnose([trajectory({ failures: [`auth used ${secret}`], taskDescription: `desc ${secret}` })]);

    const firstCall = vi.mocked(client.streamChat).mock.calls[0]![0];
    const userContent = firstCall.messages.map((m) => m.content).join("\n");
    expect(userContent).not.toContain(secret);
    expect(userContent).toContain("<redacted>");
  });
});
