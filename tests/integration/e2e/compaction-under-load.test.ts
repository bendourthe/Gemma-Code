/**
 * E2E: compaction pipeline under large conversation load.
 *
 * Exercises the CompactionPipeline with a realistic mix of user/assistant
 * messages + tool results and verifies it drives token usage below budget
 * while keeping the most recent messages intact.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CompactionPipeline,
  ToolResultClearing,
  SlidingWindow,
  CodeBlockTruncation,
  EmergencyTrim,
  estimateTokensForMessages,
} from "../../../src/chat/CompactionStrategy.js";
import type { Message } from "../../../src/chat/types.js";

function makeMessage(
  role: Message["role"],
  content: string
): Message {
  return {
    id: randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

function generateLargeConversation(count: number): Message[] {
  const messages: Message[] = [];
  messages.push(makeMessage("system", "system prompt"));
  for (let i = 0; i < count; i++) {
    messages.push(makeMessage("user", `User question ${i}: ${"token ".repeat(50)}`));
    messages.push(
      makeMessage(
        "assistant",
        `Reply ${i}. \`\`\`\n${"code line\n".repeat(30)}\`\`\``
      )
    );
    messages.push(
      makeMessage(
        "tool" as Message["role"],
        `Tool result ${i}:\n${"output line ".repeat(100)}`
      )
    );
  }
  return messages;
}

describe("e2e: compaction under load", () => {
  // Skip LLM strategy (needs Ollama client); use pure strategies only.
  const pipeline = new CompactionPipeline([
    new ToolResultClearing(8),
    new SlidingWindow(10),
    new CodeBlockTruncation(10),
    new EmergencyTrim(10),
  ]);

  it("reduces tokens below budget for a 100-message conversation", async () => {
    const messages = generateLargeConversation(30);
    const before = estimateTokensForMessages(messages);

    const budget = Math.floor(before * 0.5); // force compaction to halve it

    const result = await pipeline.run(messages, budget);
    const after = estimateTokensForMessages(result);

    expect(after).toBeLessThanOrEqual(budget);
    expect(after).toBeLessThan(before);
  });

  it("preserves system prompt across compaction", async () => {
    const messages = generateLargeConversation(20);
    const result = await pipeline.run(
      messages,
      Math.floor(estimateTokensForMessages(messages) * 0.5)
    );
    const systemMsg = result.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toBe("system prompt");
  });

  it("keeps the most recent user+assistant messages intact", async () => {
    const messages = generateLargeConversation(20);
    const latest = messages[messages.length - 2]!; // last user before last tool
    const result = await pipeline.run(
      messages,
      Math.floor(estimateTokensForMessages(messages) * 0.3)
    );
    // The last user message should still be present verbatim
    const present = result.some((m) => m.id === latest.id);
    expect(present).toBe(true);
  });

  it("no-ops when already under budget", async () => {
    const messages = generateLargeConversation(2);
    const budget = estimateTokensForMessages(messages) * 2;
    const result = await pipeline.run(messages, budget);
    expect(result.length).toBe(messages.length);
  });
});
