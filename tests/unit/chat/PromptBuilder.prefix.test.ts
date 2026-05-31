import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import type { PromptContext } from "../../../modules/coding/chat/PromptBuilder.types.js";

/**
 * v0.8.0 Phase 4 sub-task 4.5 -- the locked prefix invariant.
 *
 * The first N tokens of the rendered system prompt must be byte-identical
 * across two adjacent tool turns of the same session, so the underlying LLM's
 * KV prefix cache stays warm. Variable per-turn content (memory results,
 * sub-agent context) must only appear AFTER the locked prefix.
 *
 * "Adjacent tool turns" means the user-message identity is unchanged, the
 * enabled-tool set is unchanged, and the frozen memory snapshot is
 * unchanged. The per-turn memory context (`memoryContext` field) is what
 * varies.
 */

function makeContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    modelName: "gemma4:e4b",
    maxTokens: 131072,
    planModeActive: false,
    thinkingMode: false,
    enabledTools: [...TOOL_CATALOG],
    promptStyle: "concise",
    ...overrides,
  };
}

describe("PromptBuilder locked prefix", () => {
  it("yields a byte-identical prefix across two prompt builds with different memoryContext", () => {
    const builder = new PromptBuilder();
    const a = builder.buildSync(
      makeContext({ memoryContext: "" }),
    );
    const b = builder.buildSync(
      makeContext({ memoryContext: "## Recalled Memories\n- New item" }),
    );
    // The first 50% of the shorter prompt must match exactly (this captures
    // identity + tool declarations + the empty file-memory pre block).
    const checkLen = Math.floor(Math.min(a.length, b.length) * 0.5);
    expect(a.slice(0, checkLen)).toBe(b.slice(0, checkLen));
  });

  it("identity + tool declarations are emitted first regardless of optional sections", () => {
    const builder = new PromptBuilder();
    const result = builder.buildSync(
      makeContext({
        planModeActive: true,
        thinkingMode: true,
        activeSkillPrompt: "Use the foo skill.",
        memoryContext: "## Recalled Memories\n- one",
      }),
    );
    const identityIdx = result.indexOf("Gemma Code");
    const toolIdx = result.indexOf("<|tool>");
    const planIdx = result.indexOf("PLAN MODE");
    const memoryIdx = result.indexOf("Recalled Memories");
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(identityIdx);
    expect(planIdx).toBeGreaterThan(toolIdx);
    expect(memoryIdx).toBeGreaterThan(planIdx);
  });

  it("changing only the memory context does not perturb the identity/tool prefix", () => {
    const builder = new PromptBuilder();
    const a = builder.buildSync(makeContext({ memoryContext: "" }));
    const b = builder.buildSync(makeContext({ memoryContext: "alpha" }));
    const c = builder.buildSync(makeContext({ memoryContext: "beta" }));
    const toolEndA = a.indexOf("<tool|>");
    const toolEndB = b.indexOf("<tool|>");
    const toolEndC = c.indexOf("<tool|>");
    expect(toolEndA).toBeGreaterThan(0);
    expect(a.slice(0, toolEndA)).toBe(b.slice(0, toolEndB));
    expect(b.slice(0, toolEndB)).toBe(c.slice(0, toolEndC));
  });
});
