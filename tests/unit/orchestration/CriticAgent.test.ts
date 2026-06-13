import { describe, it, expect, vi } from "vitest";
import {
  CriticAgent,
  parseCriticVerdict,
} from "../../../modules/coding/orchestration/CriticAgent.js";
import type { TaskNode } from "../../../modules/coding/orchestration/TaskDAG.js";
import { makeOllamaClient } from "../../helpers/factories.js";

// v1.5.0 Phase 4 (T011, closes the team-orchestration half of v1.4.0 T018.P3.B):
// the CriticAgent reviews a worker's output before the DAGExecutor accepts it.
// The parser is fail-open: an unparseable verdict must never block a worker
// that already succeeded.

function makeNode(): TaskNode {
  return {
    id: "n1",
    title: "Add token validation",
    description: "Add a JWT signature check to the auth middleware",
    type: "code",
    dependencies: [],
    status: "pending",
    retryCount: 0,
    maxRetries: 1,
  };
}

describe("parseCriticVerdict", () => {
  it("parses an approving verdict", () => {
    expect(parseCriticVerdict('{"approved": true, "feedback": "looks good"}')).toEqual({
      approved: true,
      feedback: "looks good",
    });
  });

  it("parses a rejecting verdict", () => {
    expect(
      parseCriticVerdict('{"approved": false, "feedback": "missing the check"}'),
    ).toEqual({ approved: false, feedback: "missing the check" });
  });

  it("extracts the verdict from a fenced block with preamble", () => {
    const raw =
      'Here is my review:\n```json\n{"approved": false, "feedback": "nope"}\n```\nThanks.';
    expect(parseCriticVerdict(raw)).toEqual({ approved: false, feedback: "nope" });
  });

  it("defaults feedback to empty string when absent", () => {
    expect(parseCriticVerdict('{"approved": true}')).toEqual({
      approved: true,
      feedback: "",
    });
  });

  it("fails open (approved) on completely unparseable output", () => {
    expect(parseCriticVerdict("not json at all").approved).toBe(true);
  });

  it("fails open when 'approved' is not a boolean", () => {
    expect(parseCriticVerdict('{"approved": "yes"}').approved).toBe(true);
  });

  it("fails open on an array payload", () => {
    expect(parseCriticVerdict('[{"approved": false}]').approved).toBe(true);
  });
});

describe("CriticAgent.review", () => {
  it("returns the verdict parsed from the model output", async () => {
    const client = makeOllamaClient('{"approved": false, "feedback": "incomplete"}');
    const critic = new CriticAgent(client, "gemma4", { num_ctx: 131072 });
    const verdict = await critic.review(makeNode(), "I added a log line.");
    expect(verdict.approved).toBe(false);
    expect(verdict.feedback).toBe("incomplete");
  });

  it("fails open when the model output cannot be parsed", async () => {
    const client = makeOllamaClient("the worker did fine I think");
    const critic = new CriticAgent(client, "gemma4", { num_ctx: 131072 });
    const verdict = await critic.review(makeNode(), "output");
    expect(verdict.approved).toBe(true);
  });

  it("passes the task and worker output to the model", async () => {
    const client = makeOllamaClient('{"approved": true, "feedback": "ok"}');
    const critic = new CriticAgent(client, "gemma4", { num_ctx: 131072 });
    await critic.review(makeNode(), "the worker output text");
    const call = vi.mocked(client.streamChat).mock.calls[0]![0];
    const userMessage = call.messages.find((m) => m.role === "user")!;
    expect(userMessage.content).toContain("Add token validation");
    expect(userMessage.content).toContain("the worker output text");
  });
});
