/**
 * Context compaction benchmark.
 *
 * Measures the time taken by ContextCompactor.estimateTokens() and
 * shouldCompact() across conversation sizes of 50, 100, and 200 messages.
 * The actual compaction (which calls the model) is not benchmarked here;
 * that requires a live Ollama instance and is covered by the integration suite.
 *
 * Run: npx vitest bench --config configs/vitest.config.ts tests/benchmarks/context-compaction.bench.ts
 */

import { bench, describe, it, expect } from "vitest";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal stubs — avoids vscode module resolution at bench time
// ---------------------------------------------------------------------------

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, window: {} }));

const { ContextCompactor } = await import("../../src/chat/ContextCompactor.js");
const { createConversationManager } = await import("../../src/chat/ConversationManager.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHORT_MSG = "This is a short user message with no code blocks.";
const CODE_MSG = `Here is some code:\n\`\`\`typescript\nconst x = 1;\nconst y = 2;\nconst z = x + y;\n\`\`\`\nDone.`;

function buildConversation(messageCount: number) {
  const manager = createConversationManager();
  for (let i = 0; i < messageCount; i++) {
    if (i % 3 === 0) {
      manager.addUserMessage(SHORT_MSG);
    } else if (i % 3 === 1) {
      manager.addAssistantMessage(CODE_MSG);
    } else {
      manager.addUserMessage("Can you explain more?");
    }
  }
  return manager;
}

// ---------------------------------------------------------------------------
// Latency gate (p99 < 500ms for 200-message conversations)
// ---------------------------------------------------------------------------

const P99_LIMIT_MS = 500;
const ITERATIONS = 100;

function measureEstimate(compactor: InstanceType<typeof ContextCompactor>, iterations: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    compactor.estimateTokens();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b);
}

function p99(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

describe("ContextCompactor.estimateTokens() latency gate", () => {
  it(`estimates 200-message conversation in under ${P99_LIMIT_MS}ms at p99`, () => {
    const manager = buildConversation(200);
    // OllamaClient and postMessage are not used by estimateTokens/shouldCompact.
    const compactor = new ContextCompactor(manager, {} as never, "gemma4", 8192);
    const times = measureEstimate(compactor, ITERATIONS);
    expect(p99(times)).toBeLessThan(P99_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------
// Benchmark declarations
// ---------------------------------------------------------------------------

describe("ContextCompactor.estimateTokens() throughput", () => {
  const mgr50 = buildConversation(50);
  const mgr100 = buildConversation(100);
  const mgr200 = buildConversation(200);

  const c50 = new ContextCompactor(mgr50, {} as never, "gemma4", 8192);
  const c100 = new ContextCompactor(mgr100, {} as never, "gemma4", 8192);
  const c200 = new ContextCompactor(mgr200, {} as never, "gemma4", 8192);

  bench("estimateTokens — 50 messages", () => { c50.estimateTokens(); });
  bench("estimateTokens — 100 messages", () => { c100.estimateTokens(); });
  bench("estimateTokens — 200 messages", () => { c200.estimateTokens(); });
});
