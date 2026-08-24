import { describe, it, expect } from "vitest";
import {
  getToolCallFormat,
  TOOL_FORMAT_NAMES,
} from "../../../../../modules/coding/llm/ToolCallFormat.js";

describe("ToolCallFormat strategies", () => {
  it("TOOL_FORMAT_NAMES exposes every family parser", () => {
    expect(TOOL_FORMAT_NAMES).toEqual([
      "gemma4-xml",
      "llama3-json",
      "qwen-json",
      "deepseek-json",
      "lfm-pythonic",
    ]);
  });

  it("getToolCallFormat throws on unknown name", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getToolCallFormat("nope" as any)).toThrow(/unknown parser/);
  });

  it("Gemma 4 XML extractor returns name + args", () => {
    const text = `<|tool_call|>{"name":"fs.read","arguments":{"path":"a.ts"}}</|tool_call|>`;
    const calls = getToolCallFormat("gemma4-xml").parse(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("fs.read");
    expect(calls[0]?.args).toEqual({ path: "a.ts" });
  });

  it("Gemma 4 ignores malformed JSON bodies", () => {
    const text = `<|tool_call|>not-json</|tool_call|>`;
    const calls = getToolCallFormat("gemma4-xml").parse(text);
    expect(calls).toEqual([]);
  });

  it("Llama 3 JSON extractor accepts a bare JSON body", () => {
    const text = `{"name":"fs.write","parameters":{"path":"a","contents":"b"}}`;
    const calls = getToolCallFormat("llama3-json").parse(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("fs.write");
    expect(calls[0]?.args).toEqual({ path: "a", contents: "b" });
  });

  it("Llama 3 JSON extractor accepts python_tag-wrapped bodies", () => {
    const text =
      'preamble<|python_tag|>{"name":"shell","parameters":{"cmd":"ls"}}<|eom_id|> tail';
    const calls = getToolCallFormat("llama3-json").parse(text);
    expect(calls.some((c) => c.name === "shell")).toBe(true);
  });

  it("Llama 3 returns [] for plain prose", () => {
    expect(getToolCallFormat("llama3-json").parse("just text")).toEqual([]);
  });

  it("Qwen XML envelope extractor", () => {
    const text =
      '<tool_call>{"name":"calc","parameters":{"a":1,"b":2}}</tool_call>';
    const calls = getToolCallFormat("qwen-json").parse(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({ a: 1, b: 2 });
  });

  it("DeepSeek extractor prefers fenced ```tool blocks", () => {
    const text =
      'prose ```tool\n{"name":"fs.read","parameters":{"path":"x"}}\n``` tail';
    const calls = getToolCallFormat("deepseek-json").parse(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("fs.read");
  });

  it("DeepSeek falls back to bare-JSON when no fence is present", () => {
    const text = '{"name":"x","parameters":{"v":42}}';
    const calls = getToolCallFormat("deepseek-json").parse(text);
    expect(calls[0]?.args).toEqual({ v: 42 });
  });

  it("Each parser accepts the alternative arguments-key alias", () => {
    const variants = [
      { fmt: "gemma4-xml" as const, wrap: (b: string) => `<|tool_call|>${b}</|tool_call|>` },
      { fmt: "llama3-json" as const, wrap: (b: string) => b },
      { fmt: "qwen-json" as const, wrap: (b: string) => `<tool_call>${b}</tool_call>` },
      { fmt: "deepseek-json" as const, wrap: (b: string) => b },
    ];
    for (const v of variants) {
      const body = `{"name":"fs.read","parameters":{"path":"y"}}`;
      const out = getToolCallFormat(v.fmt).parse(v.wrap(body));
      expect(out[0]?.args).toEqual({ path: "y" });
    }
  });

  it("Empty or whitespace input produces an empty list", () => {
    for (const name of TOOL_FORMAT_NAMES) {
      expect(getToolCallFormat(name).parse("")).toEqual([]);
      expect(getToolCallFormat(name).parse("   ")).toEqual([]);
    }
  });

  it("LFM pythonic parser reads official tool_call_start spans", () => {
    const text =
      '<|tool_call_start|>[get_candidate_status(candidate_id="12345")]<|tool_call_end|>';
    const calls = getToolCallFormat("lfm-pythonic").parse(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("get_candidate_status");
    expect(calls[0]?.args).toEqual({ candidate_id: "12345" });
  });

  it("LFM pythonic parser reads multiple calls and nested JSON kwargs", () => {
    const text =
      '<|tool_call_start|>[read_file(path="a.ts"), search(query="x", filters={"tags":["coding"]})]<|tool_call_end|>';
    const calls = getToolCallFormat("lfm-pythonic").parse(text);
    expect(calls.map((c) => c.name)).toEqual(["read_file", "search"]);
    expect(calls[1]?.args).toEqual({ query: "x", filters: { tags: ["coding"] } });
  });

  it("LFM pythonic parser accepts a JSON-array override body", () => {
    const text =
      '<|tool_call_start|>[{"name":"get_weather","arguments":{"location":"Paris"}}]<|tool_call_end|>';
    const calls = getToolCallFormat("lfm-pythonic").parse(text);
    expect(calls[0]?.name).toBe("get_weather");
    expect(calls[0]?.args).toEqual({ location: "Paris" });
  });

  it("LFM pythonic parser reads a live local emission with think tags and single quotes", () => {
    const text =
      "<think>plan</think><|tool_call_start|>[get_candidate_status(candidate_id='12345')]<|tool_call_end|>";
    const calls = getToolCallFormat("lfm-pythonic").parse(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("get_candidate_status");
    expect(calls[0]?.args).toEqual({ candidate_id: "12345" });
  });

  it("LFM pythonic parser returns [] for unclosed or prose-only output", () => {
    expect(
      getToolCallFormat("lfm-pythonic").parse(
        '<|tool_call_start|>[get_candidate_status(candidate_id="12345")',
      ),
    ).toEqual([]);
    expect(getToolCallFormat("lfm-pythonic").parse("just a reply.")).toEqual([]);
  });

  it("LFM pythonic parser covers True/False/None, numbers, positional args, and empty lists", () => {
    const fmt = getToolCallFormat("lfm-pythonic");
    const mixed =
      "<|tool_call_start|>[flag(on=True, off=False, empty=None, n=3, ratio=1.5, ok=true, no=false, z=null)]<|tool_call_end|>";
    expect(fmt.parse(mixed)[0]?.args).toEqual({
      on: true,
      off: false,
      empty: null,
      n: 3,
      ratio: 1.5,
      ok: true,
      no: false,
      z: null,
    });
    const positional =
      "<|tool_call_start|>[read_file(\"a.ts\")]<|tool_call_end|>";
    expect(fmt.parse(positional)[0]?.args).toEqual({ _0: "a.ts" });
    expect(fmt.parse("<|tool_call_start|>[]<|tool_call_end|>")).toEqual([]);
    const unwrapped =
      "<|tool_call_start|>get_candidate_status(candidate_id=\"x\")<|tool_call_end|>";
    expect(fmt.parse(unwrapped)[0]?.name).toBe("get_candidate_status");
    expect(
      fmt.parse("<|tool_call_start|>[{not-json]<|tool_call_end|>"),
    ).toEqual([]);
  });

  it("Gemma4 XML parser does not treat LFM spans as tool calls", () => {
    const text =
      '<|tool_call_start|>[get_candidate_status(candidate_id="12345")]<|tool_call_end|>';
    expect(getToolCallFormat("gemma4-xml").parse(text)).toEqual([]);
  });
});
