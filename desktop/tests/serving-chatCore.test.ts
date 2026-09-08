/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- shared completion plumbing.
 *
 * The pure translation helpers both wire dialects depend on. Tested directly
 * (rather than only through the gateway's socket-level tests) because their edge
 * cases -- structured content parts, unusual roles, absent sampling options --
 * are cheap to enumerate here and expensive to enumerate over HTTP.
 */

import { describe, expect, it } from "vitest";

import {
  buildChatRequest,
  collectUsage,
  flattenContent,
  newUsage,
  normalizeRole,
  toLlmOptions,
  turnUsageFromCollected,
} from "../sidecar/src/serving/chatCore";
import { ServingHttpError } from "../sidecar/src/serving/errors";
import type { LLMStreamChunk } from "../../modules/coding/llm/types";

describe("flattenContent", () => {
  it("passes a plain string through", () => {
    expect(flattenContent("hello")).toEqual({ text: "hello", images: [] });
  });

  it("joins multiple text parts with newlines", () => {
    expect(
      flattenContent([
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ]),
    ).toEqual({ text: "one\ntwo", images: [] });
  });

  it("strips the data-URL prefix from an OpenAI image part", () => {
    expect(
      flattenContent([{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }]),
    ).toEqual({ text: "", images: ["QUJD"] });
  });

  it("keeps a bare base64 image_url unchanged", () => {
    expect(flattenContent([{ type: "image_url", image_url: { url: "QUJD" } }]).images).toEqual([
      "QUJD",
    ]);
  });

  it("reads an Anthropic structured image block", () => {
    expect(
      flattenContent([{ type: "image", source: { type: "base64", data: "WFla" } }]).images,
    ).toEqual(["WFla"]);
  });

  it("ignores an Anthropic image block with no data", () => {
    expect(flattenContent([{ type: "image", source: { type: "url" } }]).images).toEqual([]);
  });

  it("handles a mixed text + image transcript", () => {
    const out = flattenContent([
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,SU1H" } },
    ]);
    expect(out).toEqual({ text: "describe this", images: ["SU1H"] });
  });

  it("returns empty text for an empty parts array", () => {
    expect(flattenContent([])).toEqual({ text: "", images: [] });
  });
});

describe("normalizeRole", () => {
  it.each([
    ["system", "system"],
    ["developer", "system"],
    ["assistant", "assistant"],
    ["user", "user"],
    ["tool", "user"],
    ["something-unexpected", "user"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });
});

describe("toLlmOptions", () => {
  it("returns undefined when no knob is set, so no options key is sent", () => {
    expect(toLlmOptions({})).toBeUndefined();
  });

  it("maps only the knobs that are present", () => {
    expect(toLlmOptions({ temperature: 0.3 })).toEqual({ temperature: 0.3 });
  });

  it("maps every supported knob", () => {
    expect(toLlmOptions({ temperature: 0.1, top_p: 0.2, top_k: 3, num_ctx: 4 })).toEqual({
      temperature: 0.1,
      top_p: 0.2,
      top_k: 3,
      num_ctx: 4,
    });
  });

  it("preserves an explicit zero temperature", () => {
    expect(toLlmOptions({ temperature: 0 })).toEqual({ temperature: 0 });
  });
});

describe("buildChatRequest", () => {
  it("builds a port request from the resolved runtime model name", () => {
    expect(
      buildChatRequest({
        modelName: "gemma4:12b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    ).toEqual({
      model: "gemma4:12b",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
  });

  it("omits the options key entirely when none are given", () => {
    const req = buildChatRequest({
      modelName: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
    expect("options" in req).toBe(false);
  });

  it("includes options when supplied", () => {
    const req = buildChatRequest({
      modelName: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      options: { temperature: 0.5 },
    });
    expect(req.options).toEqual({ temperature: 0.5 });
  });

  it("rejects an empty transcript as a 400, not an upstream failure", () => {
    try {
      buildChatRequest({ modelName: "m", messages: [], stream: false });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ServingHttpError);
      expect((err as ServingHttpError).status).toBe(400);
    }
  });
});

// v1.16.0 Phase 2.1 (closes gap LSO.P1.A).
describe("collectUsage", () => {
  const chunk = (over: Partial<LLMStreamChunk> = {}): LLMStreamChunk => ({
    message: { role: "assistant", content: "" },
    done: true,
    ...over,
  });

  it("starts unreported with zero counts", () => {
    expect(newUsage()).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: null,
      reported: false,
    });
  });

  it("reads Ollama-shaped counters", () => {
    const usage = newUsage();
    collectUsage(chunk({ prompt_eval_count: 11, eval_count: 22 }), usage);
    expect(usage).toEqual({
      promptTokens: 11,
      completionTokens: 22,
      reasoningTokens: null,
      reported: true,
    });
  });

  it("reads an OpenAI-shaped usage block", () => {
    const usage = newUsage();
    collectUsage(chunk({ usage: { prompt_tokens: 3, completion_tokens: 4 } }), usage);
    expect(usage).toEqual({
      promptTokens: 3,
      completionTokens: 4,
      reasoningTokens: null,
      reported: true,
    });
  });

  it("leaves the accumulator unreported when a chunk carries no counters", () => {
    const usage = newUsage();
    collectUsage(chunk({ message: { role: "assistant", content: "hi" }, done: false }), usage);
    expect(usage.reported).toBe(false);
  });

  it("lets a later chunk's cumulative totals win", () => {
    const usage = newUsage();
    collectUsage(chunk({ eval_count: 5 }), usage);
    collectUsage(chunk({ eval_count: 40 }), usage);
    expect(usage.completionTokens).toBe(40);
  });

  it("distinguishes a reported zero from an absent count", () => {
    const usage = newUsage();
    collectUsage(chunk({ prompt_eval_count: 0, eval_count: 0 }), usage);
    expect(usage.reported).toBe(true);
    expect(usage.completionTokens).toBe(0);
  });

  it("merges partial counters across chunks", () => {
    const usage = newUsage();
    collectUsage(chunk({ prompt_eval_count: 9 }), usage);
    collectUsage(chunk({ usage: { completion_tokens: 12 } }), usage);
    expect(usage).toEqual({
      promptTokens: 9,
      completionTokens: 12,
      reasoningTokens: null,
      reported: true,
    });
  });

  it("reads reasoning_tokens and thinking text into turn usage", () => {
    const usage = newUsage();
    collectUsage(
      chunk({
        prompt_eval_count: 10,
        eval_count: 10,
        usage: { reasoning_tokens: 6 },
      }),
      usage,
    );
    // v2.4.8 Phase 1: an explicit reasoning count is subtracted from the
    // completion total (10 total, 6 reasoning -> 4 output), never added to it.
    expect(turnUsageFromCollected(usage)).toEqual({
      inputTokens: 10,
      reasoningTokens: 6,
      outputTokens: 4,
    });
    const thinkingOnly = newUsage();
    expect(turnUsageFromCollected(thinkingOnly, "abcd")).toEqual({
      inputTokens: null,
      reasoningTokens: 1,
      outputTokens: null,
    });
  });

  // v2.4.8 Phase 1 (T003): Ollama's eval_count already includes thinking
  // tokens. Screenshot 1 (2026-09-06) showed `(126 tokens)` split as 54
  // reasoning / 72 output for a five-line thought and a nine-token reply; the
  // provider total was 72 and the bytes/4 estimate had been added on top.
  describe("v2.4.8 token split", () => {
    const THINKING =
      'The user said "Hi".\nThe user is greeting me.\nI am "Nexus," a helpful, concise local AI assistant.\nRespond in a friendly and helpful manner, keeping it concise.\n\nPlan:\n1. Acknowledge the greeting.\n2. Offer assistance.';
    const REPLY = "Hello! How can I help you today?";

    it("keeps the provider total and splits it by text proportion", () => {
      const usage = newUsage();
      collectUsage(chunk({ prompt_eval_count: 30, eval_count: 72 }), usage);
      const turn = turnUsageFromCollected(usage, THINKING, REPLY);
      expect(turn.inputTokens).toBe(30);
      expect((turn.reasoningTokens ?? 0) + (turn.outputTokens ?? 0)).toBe(72);
      expect(turn.reasoningTokens).toBeGreaterThan(turn.outputTokens ?? 0);
      // 215 thinking bytes against 32 reply bytes: 72 * 215 / 247 = 62.7.
      expect(turn).toEqual({ inputTokens: 30, reasoningTokens: 63, outputTokens: 9 });
    });

    it("never double-counts: the sum of the parts equals eval_count", () => {
      for (const total of [1, 7, 72, 1001]) {
        const usage = newUsage();
        collectUsage(chunk({ eval_count: total }), usage);
        const turn = turnUsageFromCollected(usage, THINKING, REPLY);
        expect((turn.reasoningTokens ?? 0) + (turn.outputTokens ?? 0)).toBe(total);
      }
    });

    it("reports output equal to the total when there was no thinking", () => {
      const usage = newUsage();
      collectUsage(chunk({ prompt_eval_count: 5, eval_count: 40 }), usage);
      expect(turnUsageFromCollected(usage, "", REPLY)).toEqual({
        inputTokens: 5,
        reasoningTokens: null,
        outputTokens: 40,
      });
    });

    it("attributes the whole total to reasoning when the reply is empty", () => {
      const usage = newUsage();
      collectUsage(chunk({ eval_count: 20 }), usage);
      expect(turnUsageFromCollected(usage, THINKING, "")).toEqual({
        inputTokens: 0,
        reasoningTokens: 20,
        outputTokens: 0,
      });
    });

    it("floors output at zero when explicit reasoning exceeds completion", () => {
      const usage = newUsage();
      collectUsage(
        chunk({ usage: { completion_tokens: 3, reasoning_tokens: 6 } }),
        usage,
      );
      expect(turnUsageFromCollected(usage, THINKING, REPLY).outputTokens).toBe(0);
    });

    it("still estimates reasoning from thinking bytes when nothing was reported", () => {
      const usage = newUsage();
      expect(turnUsageFromCollected(usage, THINKING, REPLY)).toEqual({
        inputTokens: null,
        reasoningTokens: Math.ceil(215 / 4),
        outputTokens: null,
      });
    });
  });
});
