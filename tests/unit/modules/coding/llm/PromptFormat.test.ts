import { describe, it, expect } from "vitest";
import {
  getPromptFormat,
  PROMPT_FORMAT_NAMES,
  type ChatMessage,
} from "../../../../../modules/coding/llm/PromptFormat.js";

const sample: readonly ChatMessage[] = [
  { role: "system", content: "You are a careful agent." },
  { role: "user", content: "What is 2 + 2?" },
];

describe("PromptFormat strategies", () => {
  it("getPromptFormat throws on unknown name", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getPromptFormat("nope" as any)).toThrow(/unknown strategy/);
  });

  it("PROMPT_FORMAT_NAMES enumerates every strategy", () => {
    expect(PROMPT_FORMAT_NAMES).toEqual(["gemma4", "llama3", "qwen", "deepseek"]);
  });

  it("Gemma 4 emits start_of_turn user / model turns + a system preamble", () => {
    const out = getPromptFormat("gemma4").render(sample);
    expect(out).toContain("<start_of_turn>user");
    expect(out).toContain("<end_of_turn>");
    expect(out).toMatch(/<start_of_turn>model\n$/);
    expect(out).toContain("[system]");
  });

  it("Llama 3 emits begin_of_text + header tags + assistant tail", () => {
    const out = getPromptFormat("llama3").render(sample);
    expect(out.startsWith("<|begin_of_text|>")).toBe(true);
    expect(out).toContain("<|start_header_id|>system<|end_header_id|>");
    expect(out).toContain("<|start_header_id|>user<|end_header_id|>");
    expect(out.endsWith("<|start_header_id|>assistant<|end_header_id|>\n\n")).toBe(true);
  });

  it("Qwen wraps each turn in im_start / im_end", () => {
    const out = getPromptFormat("qwen").render(sample);
    expect(out).toContain("<|im_start|>system");
    expect(out).toContain("<|im_end|>");
    expect(out).toMatch(/<\|im_start\|>assistant\n$/);
  });

  it("DeepSeek uses ### Instruction / ### Response and stops on |EOT|", () => {
    const out = getPromptFormat("deepseek").render(sample);
    expect(out).toContain("### Instruction:");
    expect(out.trim().endsWith("### Response:")).toBe(true);
    expect(getPromptFormat("deepseek").stopTokens).toContain("<|EOT|>");
  });

  it("tool messages flow into the prompt for every family", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "tool", content: '{"ok":true}', toolName: "fs.read" },
    ];
    for (const name of PROMPT_FORMAT_NAMES) {
      const out = getPromptFormat(name).render(msgs);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("assistant turns render under their canonical role for every family", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ];
    expect(getPromptFormat("gemma4").render(msgs)).toContain("<start_of_turn>model");
    expect(getPromptFormat("llama3").render(msgs)).toContain(
      "<|start_header_id|>assistant<|end_header_id|>",
    );
    expect(getPromptFormat("qwen").render(msgs)).toContain("<|im_start|>assistant");
    expect(getPromptFormat("deepseek").render(msgs)).toContain("### Response:");
  });

  it("stop tokens are non-empty for every strategy", () => {
    for (const name of PROMPT_FORMAT_NAMES) {
      const stop = getPromptFormat(name).stopTokens;
      expect(stop.length).toBeGreaterThan(0);
      expect(stop.every((s) => s.length > 0)).toBe(true);
    }
  });
});
