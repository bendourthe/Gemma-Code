import { describe, it, expect } from "vitest";
import {
  LlmSkillEditProposer,
  parseProposedEdit,
} from "../../../modules/coding/skilloptimizer/SkillEditProposer.js";
import { makeOllamaClient } from "../../helpers/factories.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- unit tests for
 * the LLM-backed bounded-edit proposer: tolerant JSON parsing, op validation
 * (drop malformed ops), fail-closed on no valid op, and the streamed-client
 * round-trip.
 */

describe("parseProposedEdit", () => {
  it("parses a well-formed edit object", () => {
    const raw = JSON.stringify({
      rationale: "tighten the instruction",
      ops: [{ kind: "replace", match: "old", text: "new" }],
    });
    const edit = parseProposedEdit(raw, "s1");
    expect(edit).not.toBeNull();
    expect(edit!.skillId).toBe("s1");
    expect(edit!.rationale).toBe("tighten the instruction");
    expect(edit!.ops).toEqual([{ kind: "replace", match: "old", text: "new" }]);
  });

  it("extracts JSON from a fenced code block with preamble", () => {
    const raw = "Sure, here is the edit:\n```json\n" + JSON.stringify({ ops: [{ kind: "add", text: "x" }] }) + "\n```";
    const edit = parseProposedEdit(raw, "s1");
    expect(edit!.ops).toEqual([{ kind: "add", text: "x" }]);
  });

  it("drops malformed ops and keeps valid ones", () => {
    const raw = JSON.stringify({
      ops: [
        { kind: "bogus", text: "x" }, // unknown kind -> dropped
        { kind: "delete" }, // missing match -> dropped
        { kind: "add", text: "" }, // empty text -> dropped
        { kind: "replace", match: "a" }, // missing text -> dropped
        { kind: "add", text: "kept" }, // valid
      ],
    });
    const edit = parseProposedEdit(raw, "s1");
    expect(edit!.ops).toEqual([{ kind: "add", text: "kept" }]);
  });

  it("returns null when no valid op survives or the payload is not an object", () => {
    expect(parseProposedEdit(JSON.stringify({ ops: [] }), "s1")).toBeNull();
    expect(parseProposedEdit(JSON.stringify({ ops: [{ kind: "delete" }] }), "s1")).toBeNull();
    expect(parseProposedEdit("not json at all", "s1")).toBeNull();
    expect(parseProposedEdit(JSON.stringify([1, 2, 3]), "s1")).toBeNull();
    expect(parseProposedEdit(JSON.stringify({ noOps: true }), "s1")).toBeNull();
  });
});

describe("LlmSkillEditProposer", () => {
  it("returns the parsed edit from the streamed model response", async () => {
    const client = makeOllamaClient(JSON.stringify({ rationale: "r", ops: [{ kind: "add", text: "y" }] }));
    const proposer = new LlmSkillEditProposer(client, "model", { num_ctx: 4096 });
    const edit = await proposer.propose({
      skillId: "s1",
      skillBody: "body",
      diagnosis: "tasks failed because of X",
      budget: { maxOps: 2, maxChangedChars: 100 },
    });
    expect(edit!.skillId).toBe("s1");
    expect(edit!.ops).toEqual([{ kind: "add", text: "y" }]);
  });

  it("returns null (fail-closed) when the model emits no usable edit", async () => {
    const proposer = new LlmSkillEditProposer(makeOllamaClient("I cannot help with that."), "model", {});
    const edit = await proposer.propose({
      skillId: "s1",
      skillBody: "body",
      diagnosis: "d",
      budget: { maxOps: 2, maxChangedChars: 100 },
    });
    expect(edit).toBeNull();
  });
});
