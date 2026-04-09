import { describe, it, expect, vi } from "vitest";
import {
  estimateTokensForMessages,
  CompactionPipeline,
  ToolResultClearing,
  SlidingWindow,
  CodeBlockTruncation,
  LlmSummary,
  EmergencyTrim,
} from "../../../src/chat/CompactionStrategy.js";
import type { CompactionStrategy } from "../../../src/chat/CompactionStrategy.js";
import type { Message } from "../../../src/chat/types.js";
import type { OllamaClient, OllamaChatChunk } from "../../../src/ollama/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let msgCounter = 0;

function msg(role: "user" | "assistant" | "system", content: string): Message {
  msgCounter++;
  return {
    id: `msg-${msgCounter}`,
    role,
    content,
    timestamp: 1000 + msgCounter,
  };
}

function toolResultMsg(name: string, success: boolean, output: string): Message {
  const payload = JSON.stringify({
    name,
    response: { success, output },
  }, null, 2);
  return msg("user", `<|tool_result>\n${payload}\n<tool_result|>`);
}

async function* singleChunkStream(text: string): AsyncGenerator<OllamaChatChunk> {
  yield { message: { role: "assistant", content: text }, done: true };
}

function makeClient(summaryText: string): OllamaClient {
  return {
    streamChat: vi.fn(() => singleChunkStream(summaryText)),
    checkHealth: vi.fn(),
    listModels: vi.fn(),
  } as unknown as OllamaClient;
}

// ---------------------------------------------------------------------------
// estimateTokensForMessages
// ---------------------------------------------------------------------------

describe("estimateTokensForMessages", () => {
  it("estimates tokens as char_count / 4 for plain text", () => {
    const messages = [msg("user", "a".repeat(400))];
    expect(estimateTokensForMessages(messages)).toBe(100);
  });

  it("applies 1.3x multiplier for messages containing code blocks", () => {
    const messages = [msg("assistant", "```js\n" + "a".repeat(400) + "\n```")];
    expect(estimateTokensForMessages(messages)).toBeGreaterThan(100);
  });

  it("returns 0 for an empty array", () => {
    expect(estimateTokensForMessages([])).toBe(0);
  });

  it("sums tokens across multiple messages", () => {
    const messages = [
      msg("user", "a".repeat(200)),   // 50 tokens
      msg("assistant", "b".repeat(200)), // 50 tokens
    ];
    expect(estimateTokensForMessages(messages)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// CompactionPipeline
// ---------------------------------------------------------------------------

describe("CompactionPipeline", () => {
  it("returns messages unchanged when already under budget", async () => {
    const messages = [msg("user", "short")];
    const strategy: CompactionStrategy = {
      name: "test",
      canApply: vi.fn().mockReturnValue(true),
      apply: vi.fn(),
    };
    const pipeline = new CompactionPipeline([strategy]);
    const result = await pipeline.run(messages, 100_000);
    expect(result).toEqual(messages);
    expect(strategy.apply).not.toHaveBeenCalled();
  });

  it("calls strategies in order until under budget", async () => {
    const callOrder: string[] = [];
    const bigMessages = [msg("user", "a".repeat(4000))]; // 1000 tokens

    const s1: CompactionStrategy = {
      name: "first",
      canApply: () => true,
      apply: async (msgs) => {
        callOrder.push("first");
        return msgs; // Does not reduce (still over budget)
      },
    };
    const s2: CompactionStrategy = {
      name: "second",
      canApply: () => true,
      apply: async () => {
        callOrder.push("second");
        return [msg("user", "tiny")]; // Reduces to fit
      },
    };
    const s3: CompactionStrategy = {
      name: "third",
      canApply: () => true,
      apply: vi.fn(),
    };

    const pipeline = new CompactionPipeline([s1, s2, s3]);
    await pipeline.run(bigMessages, 500);

    expect(callOrder).toEqual(["first", "second"]);
    expect(s3.apply).not.toHaveBeenCalled();
  });

  it("skips strategies whose canApply returns false", async () => {
    const bigMessages = [msg("user", "a".repeat(4000))]; // 1000 tokens
    const skipped: CompactionStrategy = {
      name: "skipped",
      canApply: () => false,
      apply: vi.fn(),
    };
    const applied: CompactionStrategy = {
      name: "applied",
      canApply: () => true,
      apply: async () => [msg("user", "small")],
    };

    const pipeline = new CompactionPipeline([skipped, applied]);
    await pipeline.run(bigMessages, 500);

    expect(skipped.apply).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ToolResultClearing
// ---------------------------------------------------------------------------

describe("ToolResultClearing", () => {
  it("clears older tool results and preserves the N most recent", async () => {
    const messages: Message[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push(toolResultMsg(`tool_${i}`, true, `output ${i}`));
    }

    const strategy = new ToolResultClearing(8);
    const result = await strategy.apply(messages, 0);

    // Oldest 4 should be cleared (one-line summaries).
    for (let i = 0; i < 4; i++) {
      expect(result[i]?.content).toMatch(/\[Tool result cleared: tool_\d+ succeeded\]/);
      expect(result[i]?.content).not.toContain("<|tool_result>");
    }
    // Newest 8 should be intact.
    for (let i = 4; i < 12; i++) {
      expect(result[i]?.content).toContain("<|tool_result>");
    }
  });

  it("extracts tool name correctly from the JSON body", async () => {
    const messages = [
      toolResultMsg("read_file", true, "file content"),
      toolResultMsg("write_file", true, "ok"),
    ];
    const strategy = new ToolResultClearing(1);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toBe("[Tool result cleared: read_file succeeded]");
  });

  it("marks failed tool results correctly", async () => {
    const messages = [
      toolResultMsg("read_file", false, "not found"),
      toolResultMsg("write_file", true, "ok"),
    ];
    const strategy = new ToolResultClearing(1);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toBe("[Tool result cleared: read_file failed]");
  });

  it("handles malformed JSON gracefully", async () => {
    const malformed = msg("user", "<|tool_result>\nnot valid json\n<tool_result|>");
    const good = toolResultMsg("write_file", true, "ok");
    const strategy = new ToolResultClearing(1);
    const result = await strategy.apply([malformed, good], 0);

    expect(result[0]?.content).toBe("[Tool result cleared]");
  });

  it("leaves non-tool-result messages untouched", async () => {
    const messages = [
      msg("user", "Hello"),
      toolResultMsg("read_file", true, "content"),
      msg("assistant", "Here is the file"),
    ];
    const strategy = new ToolResultClearing(0);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toBe("Hello");
    expect(result[2]?.content).toBe("Here is the file");
  });

  it("canApply returns false when all tool results are within the keep window", () => {
    const messages = [
      toolResultMsg("read_file", true, "content"),
      toolResultMsg("write_file", true, "ok"),
    ];
    const strategy = new ToolResultClearing(5);
    expect(strategy.canApply(messages, 0)).toBe(false);
  });

  it("canApply returns true when tool results exceed the keep window", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(toolResultMsg(`tool_${i}`, true, "output"));
    }
    const strategy = new ToolResultClearing(8);
    expect(strategy.canApply(messages, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SlidingWindow
// ---------------------------------------------------------------------------

describe("SlidingWindow", () => {
  it("preserves system messages, first user message, and last N messages", async () => {
    const messages: Message[] = [
      msg("system", "You are a helper."),
      msg("user", "Original question"),
    ];
    for (let i = 0; i < 20; i++) {
      messages.push(msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }

    const strategy = new SlidingWindow(5);
    const result = await strategy.apply(messages, 0);

    // System message preserved.
    expect(result[0]?.role).toBe("system");
    // First user message preserved.
    expect(result[1]?.content).toBe("Original question");
    // Last 5 non-system messages preserved.
    const nonSystem = result.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBe(6); // first user + last 5
  });

  it("preserves conversation summary markers", async () => {
    const messages: Message[] = [
      msg("system", "system prompt"),
      msg("user", "first question"),
      msg("assistant", "[Conversation summary]\n\nPrevious work summary"),
      msg("user", "middle question 1"),
      msg("assistant", "middle answer 1"),
      msg("user", "middle question 2"),
      msg("assistant", "middle answer 2"),
      msg("user", "recent question"),
      msg("assistant", "recent answer"),
    ];

    const strategy = new SlidingWindow(3);
    const result = await strategy.apply(messages, 0);
    const contents = result.map((m) => m.content);

    expect(contents).toContain("first question");
    expect(contents).toContain("[Conversation summary]\n\nPrevious work summary");
    expect(contents).toContain("recent answer");
  });

  it("does not duplicate messages when first user is within the tail", async () => {
    const messages: Message[] = [
      msg("system", "system prompt"),
      msg("user", "question"),
      msg("assistant", "answer"),
    ];

    const strategy = new SlidingWindow(10);
    const result = await strategy.apply(messages, 0);

    const nonSystem = result.filter((m) => m.role !== "system");
    // No duplicates.
    const ids = nonSystem.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("canApply returns false when conversation is small", () => {
    const messages = [
      msg("system", "sys"),
      msg("user", "q"),
      msg("assistant", "a"),
    ];
    const strategy = new SlidingWindow(10);
    expect(strategy.canApply(messages, 0)).toBe(false);
  });

  it("canApply returns true when conversation exceeds keepRecent + 1", () => {
    const messages: Message[] = [msg("system", "sys")];
    for (let i = 0; i < 15; i++) {
      messages.push(msg("user", `q${i}`));
    }
    const strategy = new SlidingWindow(5);
    expect(strategy.canApply(messages, 0)).toBe(true);
  });

  it("maintains chronological order", async () => {
    const messages: Message[] = [
      msg("system", "sys"),
      msg("user", "first"),
    ];
    for (let i = 0; i < 20; i++) {
      messages.push(msg("user", `mid ${i}`));
    }

    const strategy = new SlidingWindow(5);
    const result = await strategy.apply(messages, 0);
    const nonSystem = result.filter((m) => m.role !== "system");

    for (let i = 1; i < nonSystem.length; i++) {
      const prev = nonSystem[i - 1];
      const curr = nonSystem[i];
      if (prev && curr) {
        expect(curr.timestamp).toBeGreaterThanOrEqual(prev.timestamp);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CodeBlockTruncation
// ---------------------------------------------------------------------------

describe("CodeBlockTruncation", () => {
  it("replaces large code blocks with a placeholder", async () => {
    const largeCode = "line\n".repeat(100);
    const messages = [msg("assistant", `Here:\n\`\`\`typescript\n${largeCode}\`\`\`\nDone.`)];

    const strategy = new CodeBlockTruncation(80);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toContain("[Code block: 101 lines, typescript]");
    expect(result[0]?.content).not.toContain("line\nline\n");
  });

  it("leaves small code blocks unchanged", async () => {
    const smallCode = "const x = 1;\nconst y = 2;\n";
    const content = `\`\`\`js\n${smallCode}\`\`\``;
    const messages = [msg("assistant", content)];

    const strategy = new CodeBlockTruncation(80);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toBe(content);
  });

  it("handles code blocks with no language tag", async () => {
    const largeCode = "line\n".repeat(100);
    const messages = [msg("assistant", `\`\`\`\n${largeCode}\`\`\``)];

    const strategy = new CodeBlockTruncation(80);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toContain("[Code block: 101 lines]");
    expect(result[0]?.content).not.toContain(", typescript");
  });

  it("replaces only large blocks when a message has multiple", async () => {
    const largeCode = "line\n".repeat(100);
    const smallCode = "x = 1\n";
    const content = `\`\`\`py\n${smallCode}\`\`\`\nand:\n\`\`\`py\n${largeCode}\`\`\``;
    const messages = [msg("assistant", content)];

    const strategy = new CodeBlockTruncation(80);
    const result = await strategy.apply(messages, 0);

    expect(result[0]?.content).toContain("x = 1");
    expect(result[0]?.content).toContain("[Code block: 101 lines, py]");
  });

  it("canApply returns false when no code blocks exceed the threshold", () => {
    const messages = [msg("assistant", "```js\nconst x = 1;\n```")];
    const strategy = new CodeBlockTruncation(80);
    expect(strategy.canApply(messages, 0)).toBe(false);
  });

  it("canApply returns true when a code block exceeds the threshold", () => {
    const largeCode = "line\n".repeat(100);
    const messages = [msg("assistant", `\`\`\`\n${largeCode}\`\`\``)];
    const strategy = new CodeBlockTruncation(80);
    expect(strategy.canApply(messages, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LlmSummary
// ---------------------------------------------------------------------------

describe("LlmSummary", () => {
  it("produces a summary message from the LLM response", async () => {
    const client = makeClient("Summary of conversation.");
    const messages: Message[] = [
      msg("system", "sys prompt"),
      msg("user", "a".repeat(4000)),
      msg("assistant", "response"),
    ];

    const strategy = new LlmSummary(client, "gemma4", 1);
    const result = await strategy.apply(messages, 100);

    // System message preserved.
    expect(result[0]?.role).toBe("system");
    // Summary message.
    expect(result[1]?.role).toBe("assistant");
    expect(result[1]?.content).toMatch(/^\[Conversation summary\]/);
    expect(result[1]?.content).toContain("Summary of conversation.");
    // Last 1 non-system message (the assistant "response").
    expect(result[2]?.content).toBe("response");
  });

  it("returns messages unchanged on LLM failure", async () => {
    const client = {
      streamChat: vi.fn().mockImplementation(async function* () {
        throw new Error("network error");
      }),
    } as unknown as OllamaClient;

    const messages = [msg("system", "sys"), msg("user", "hello")];
    const strategy = new LlmSummary(client, "gemma4", 1);
    const result = await strategy.apply(messages, 100);

    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe("sys");
    expect(result[1]?.content).toBe("hello");
  });

  it("returns messages unchanged on empty summary", async () => {
    const client = makeClient("   ");
    const messages = [msg("system", "sys"), msg("user", "hello")];
    const strategy = new LlmSummary(client, "gemma4", 1);
    const result = await strategy.apply(messages, 100);

    expect(result).toHaveLength(2);
  });

  it("canApply returns false when within 5% of budget", () => {
    // 20 chars = 5 tokens. Budget = 5 tokens. 5 <= 5 * 1.05 = 5.25.
    const messages = [msg("user", "a".repeat(20))];
    const strategy = new LlmSummary(makeClient(""), "gemma4", 1);
    expect(strategy.canApply(messages, 5)).toBe(false);
  });

  it("canApply returns true when more than 5% over budget", () => {
    // 400 chars = 100 tokens. Budget = 50. 100 > 50 * 1.05 = 52.5.
    const messages = [msg("user", "a".repeat(400))];
    const strategy = new LlmSummary(makeClient(""), "gemma4", 1);
    expect(strategy.canApply(messages, 50)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EmergencyTrim
// ---------------------------------------------------------------------------

describe("EmergencyTrim", () => {
  it("drops non-system messages from the front until under budget", async () => {
    const messages: Message[] = [
      msg("system", "sys"),
      msg("user", "a".repeat(400)),   // 100 tokens
      msg("assistant", "b".repeat(400)), // 100 tokens
      msg("user", "c".repeat(40)),     // 10 tokens
    ];

    const strategy = new EmergencyTrim();
    // Budget of 50 tokens: system (1 token) + user-c (10 tokens) = ~11 tokens.
    const result = await strategy.apply(messages, 50);

    expect(result.some((m) => m.role === "system")).toBe(true);
    expect(result.some((m) => m.content === "a".repeat(400))).toBe(false);
  });

  it("always preserves system messages", async () => {
    const messages: Message[] = [
      msg("system", "a".repeat(800)),
      msg("user", "b".repeat(800)),
    ];

    const strategy = new EmergencyTrim();
    const result = await strategy.apply(messages, 1);

    expect(result.some((m) => m.role === "system")).toBe(true);
  });

  it("returns messages unchanged when already under budget", async () => {
    const messages = [msg("user", "short")];
    const strategy = new EmergencyTrim();
    const result = await strategy.apply(messages, 100_000);
    expect(result).toEqual(messages);
  });

  it("canApply always returns true", () => {
    const strategy = new EmergencyTrim();
    expect(strategy.canApply([], 0)).toBe(true);
  });
});
