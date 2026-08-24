/**
 * v1.0.0 Phase 3.2 -- per-model-family prompt-format strategies.
 *
 * The pre-Nexus engine (`src/chat/PromptBuilder.ts`) emitted prompts that
 * targeted Gemma 4's `<|tool_call|>` token grammar exclusively. With Llama 3,
 * Qwen 2.5, and DeepSeek Coder added to the catalog in Phase 3, each family
 * needs its own chat-template surface: Llama 3 uses ChatML-style
 * `<|begin_of_text|><|start_header_id|>...|<|end_header_id|>` envelopes,
 * Qwen 2.5 uses the OpenAI-style `<|im_start|>role\n...<|im_end|>` pair, and
 * DeepSeek Coder uses Llama-style headers with a `### Instruction:` /
 * `### Response:` body convention.
 *
 * Each strategy converts a neutral `ChatMessage[]` into the wire-format
 * string the model expects. Tool-call extraction lives next door in
 * `ToolCallFormat.ts`; the two are split because the family that defines the
 * prompt envelope (e.g. Llama 3) is not always the same as the family that
 * defines the tool grammar (e.g. some Qwen finetunes use the same JSON
 * format Llama 3.1 does).
 *
 * The strategies are pure functions with no I/O; callers (`PromptBuilder`,
 * `OllamaClient`) inject them via the strategy registry below.
 */

import type { PromptFormatName } from "../../../core/registry/ModelCatalog.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** Optional tool-call name when role === "tool". */
  readonly toolName?: string;
}

export interface PromptFormat {
  readonly name: PromptFormatName;
  /** Wire-format prompt the model expects, given the conversation. */
  render(messages: readonly ChatMessage[]): string;
  /** Stop tokens that should be passed to the runtime to halt generation. */
  readonly stopTokens: readonly string[];
}

// ----- Gemma 4 --------------------------------------------------------------
// Native template: `<start_of_turn>user\n...\n<end_of_turn>\n<start_of_turn>model\n`.
// Tool calls live inside the model turn between `<|tool_call|>` ... `</|tool_call|>`.
const Gemma4Format: PromptFormat = {
  name: "gemma4",
  stopTokens: ["<end_of_turn>"],
  render(messages) {
    const out: string[] = [];
    for (const m of messages) {
      const role = m.role === "assistant" ? "model" : m.role;
      if (m.role === "system") {
        // Gemma 4's modelfile prepends the system content to the first user
        // turn rather than declaring its own role; emit as a synthetic user
        // preamble for compatibility.
        out.push(`<start_of_turn>user\n[system]\n${m.content}\n<end_of_turn>`);
        continue;
      }
      if (m.role === "tool") {
        out.push(
          `<start_of_turn>user\n[tool:${m.toolName ?? "unknown"}]\n${m.content}\n<end_of_turn>`,
        );
        continue;
      }
      out.push(`<start_of_turn>${role}\n${m.content}\n<end_of_turn>`);
    }
    out.push("<start_of_turn>model\n");
    return out.join("\n");
  },
};

// ----- Llama 3 (ChatML / Llama-3 header style) ------------------------------
// Native template: `<|begin_of_text|><|start_header_id|>role<|end_header_id|>\n\n
//   content<|eot_id|>`.
const Llama3Format: PromptFormat = {
  name: "llama3",
  stopTokens: ["<|eot_id|>"],
  render(messages) {
    const out: string[] = ["<|begin_of_text|>"];
    for (const m of messages) {
      const role = m.role === "tool" ? "ipython" : m.role;
      out.push(
        `<|start_header_id|>${role}<|end_header_id|>\n\n${m.content}<|eot_id|>`,
      );
    }
    out.push("<|start_header_id|>assistant<|end_header_id|>\n\n");
    return out.join("");
  },
};

// ----- Qwen 2.5 (im_start / im_end) -----------------------------------------
const QwenFormat: PromptFormat = {
  name: "qwen",
  stopTokens: ["<|im_end|>"],
  render(messages) {
    const out: string[] = [];
    for (const m of messages) {
      const role = m.role === "tool" ? "tool" : m.role;
      out.push(`<|im_start|>${role}\n${m.content}<|im_end|>`);
    }
    out.push("<|im_start|>assistant\n");
    return out.join("\n");
  },
};

// ----- DeepSeek Coder -------------------------------------------------------
// Uses Llama-style header tags with a distinct `### Response:` post-marker for
// completion convergence -- many DeepSeek finetunes accept either grammar; we
// pick the documented "instruct" form.
const DeepSeekFormat: PromptFormat = {
  name: "deepseek",
  stopTokens: ["<|EOT|>"],
  render(messages) {
    const out: string[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        out.push(`${m.content}`);
        continue;
      }
      if (m.role === "user") {
        out.push(`### Instruction:\n${m.content}`);
        continue;
      }
      if (m.role === "assistant") {
        out.push(`### Response:\n${m.content}<|EOT|>`);
        continue;
      }
      if (m.role === "tool") {
        out.push(`### Tool (${m.toolName ?? "unknown"}):\n${m.content}`);
      }
    }
    out.push("### Response:\n");
    return out.join("\n");
  },
};

// ----- LFM2.5 (ChatML + startoftext; tool role is first-class) ----------------
// Official template (Liquid docs, fetched 2026-08-18):
//   <|startoftext|><|im_start|>system\n...<|im_end|>
//   <|im_start|>user\n...<|im_end|>
//   <|im_start|>assistant\n
const LfmFormat: PromptFormat = {
  name: "lfm",
  stopTokens: ["<|im_end|>"],
  render(messages) {
    const turns = messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>`);
    return `<|startoftext|>${turns.join("\n")}\n<|im_start|>assistant\n`;
  },
};

const STRATEGIES: Record<PromptFormatName, PromptFormat> = {
  gemma4: Gemma4Format,
  llama3: Llama3Format,
  qwen: QwenFormat,
  deepseek: DeepSeekFormat,
  lfm: LfmFormat,
};

export function getPromptFormat(name: PromptFormatName): PromptFormat {
  const found = STRATEGIES[name];
  if (!found) throw new Error(`PromptFormat: unknown strategy ${name}`);
  return found;
}

export const PROMPT_FORMAT_NAMES: readonly PromptFormatName[] = Object.freeze([
  "gemma4",
  "llama3",
  "qwen",
  "deepseek",
  "lfm",
]);
