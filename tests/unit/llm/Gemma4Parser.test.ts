import { describe, it, expect } from "vitest";
import {
  parseChannel,
  stripLeadingThinkBlocks,
} from "../../../src/llm/Gemma4Parser.js";

describe("Gemma4Parser", () => {
  describe("parseChannel", () => {
    it("returns the input unchanged when no channel tokens are present", () => {
      const out = parseChannel("hello world");
      expect(out.visible).toBe("hello world");
      expect(out.thought).toBe("");
      expect(out.toolResponse).toBeUndefined();
    });

    it("extracts and removes <think> blocks", () => {
      const raw =
        "<think>internal reasoning here</think>The answer is 42.";
      const out = parseChannel(raw);
      expect(out.visible).toBe("The answer is 42.");
      expect(out.thought).toBe("internal reasoning here");
    });

    it("extracts channel-format thought spans", () => {
      const raw =
        "<|channel>thought\nstep one\n<channel|>visible answer";
      const out = parseChannel(raw);
      expect(out.thought).toBe("step one");
      expect(out.visible).toBe("visible answer");
    });

    it("captures tool response blocks separately", () => {
      const raw =
        "preamble <|tool_response>{\"ok\":true}<tool_response|> trailer";
      const out = parseChannel(raw);
      expect(out.visible).toBe("preamble  trailer");
      expect(out.toolResponse).toBe('{"ok":true}');
    });

    it("drops dangling channel tokens", () => {
      const raw = "before <turn|>middle<start_function_call>end";
      const out = parseChannel(raw);
      expect(out.visible).toBe("before middleend");
    });

    it("handles empty input", () => {
      const out = parseChannel("");
      expect(out.visible).toBe("");
      expect(out.thought).toBe("");
    });

    it("aggregates multiple thought blocks", () => {
      const raw =
        "<think>a</think>first\n<|channel>thought\nb\n<channel|>second";
      const out = parseChannel(raw);
      expect(out.thought.split("\n\n").length).toBe(2);
      expect(out.visible).toContain("first");
      expect(out.visible).toContain("second");
    });
  });

  describe("stripLeadingThinkBlocks", () => {
    it("removes a leading think block", () => {
      const out = stripLeadingThinkBlocks("<think>x</think>visible");
      expect(out).toBe("visible");
    });

    it("removes all think blocks, not only the leading one", () => {
      const out = stripLeadingThinkBlocks(
        "<think>a</think>one<think>b</think>two",
      );
      expect(out).toBe("onetwo");
    });

    it("returns empty string for empty input", () => {
      expect(stripLeadingThinkBlocks("")).toBe("");
    });
  });
});
