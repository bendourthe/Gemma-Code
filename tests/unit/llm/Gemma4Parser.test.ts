import { describe, it, expect } from "vitest";
import {
  parseChannel,
  stripLeadingThinkBlocks,
  Gemma4StreamScrubber,
} from "../../../modules/coding/llm/Gemma4Parser.js";

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

  describe("Gemma4StreamScrubber (v0.9.0 Phase 2.1)", () => {
    it("passes plain text through unchanged", () => {
      const s = new Gemma4StreamScrubber();
      expect(s.feed("hello ")).toBe("hello ");
      expect(s.feed("world")).toBe("world");
      expect(s.flush()).toBe("");
    });

    it("strips a complete think block in a single chunk", () => {
      const s = new Gemma4StreamScrubber();
      expect(s.feed("a<think>secret</think>b")).toBe("ab");
    });

    it("holds back partial opener bytes across chunks", () => {
      const s = new Gemma4StreamScrubber();
      let out = "";
      out += s.feed("answer: <thi");
      out += s.feed("nk>hidden</thi");
      out += s.feed("nk> visible");
      out += s.flush();
      expect(out).toBe("answer:  visible");
    });

    it("strips channel-format thought blocks streamed in chunks", () => {
      const s = new Gemma4StreamScrubber();
      let out = "";
      out += s.feed("pre <|chan");
      out += s.feed("nel>thought\nreason\n<chann");
      out += s.feed("el|>post");
      out += s.flush();
      expect(out).toBe("pre post");
    });

    it("strips standalone turn separators without buffering", () => {
      const s = new Gemma4StreamScrubber();
      expect(s.feed("a<turn|>b")).toBe("ab");
    });

    it("drops a partial-opener residue at flush time", () => {
      const s = new Gemma4StreamScrubber();
      let out = "";
      out += s.feed("done<tu");
      out += s.flush();
      // Pre-flush bytes already emitted; the partial token is discarded.
      expect(out).toBe("done");
    });
  });
});
