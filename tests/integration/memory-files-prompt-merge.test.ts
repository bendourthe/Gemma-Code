import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MemoryFiles } from "../../src/storage/MemoryFiles.js";
import { PromptBuilder } from "../../modules/coding/chat/PromptBuilder.js";
import type { PromptContext } from "../../modules/coding/chat/PromptBuilder.types.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../../src/tools/ToolCatalog.js";

/**
 * v0.7.0 Phase 2 -- end-to-end check that PromptBuilder consumes both the
 * file-backed memory architecture and the SQL-backed memory injection, with
 * Memory.md appearing AFTER SQL memory in the rendered prompt and shadowed
 * SQL lines dropped when Memory.md already states the same fact.
 */

function makeBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemma-mem-merge-"));
}

function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    modelName: "gemma4:e4b",
    maxTokens: 131072,
    planModeActive: false,
    thinkingMode: false,
    enabledTools: TOOL_CATALOG.map(toDynamicMetadata),
    promptStyle: "concise",
    systemPromptBudgetPercent: 10,
    ...overrides,
  };
}

describe("PromptBuilder + MemoryFiles merge (v0.7.0 Phase 2)", () => {
  let baseDir: string;
  let memoryFiles: MemoryFiles;

  beforeEach(() => {
    baseDir = makeBaseDir();
    memoryFiles = new MemoryFiles("integration-workspace", baseDir);
    memoryFiles.init();
  });

  it("renders both SQL-backed and file-backed memory with Memory.md last", () => {
    memoryFiles.appendToMemory("Decisions", "Always squash-merge before tagging");

    const builder = new PromptBuilder(memoryFiles);
    const prompt = builder.build(
      makeContext({
        memoryContext: "Recalled facts:\n- user prefers Conventional Commits\n",
      }),
    );

    expect(prompt).toContain("user prefers Conventional Commits");
    expect(prompt).toContain("Always squash-merge before tagging");

    const sqlIdx = prompt.indexOf("user prefers Conventional Commits");
    const memoryMdIdx = prompt.indexOf("Always squash-merge before tagging");
    expect(sqlIdx).toBeGreaterThan(0);
    expect(memoryMdIdx).toBeGreaterThan(sqlIdx);
  });

  it("places Instructions.md and Context.md before SQL-backed memory", () => {
    fs.writeFileSync(
      memoryFiles.instructionsPath,
      "# Instructions\n\n## Who you are\n\nSenior reliability engineer at a financial-services firm.\n",
    );
    fs.writeFileSync(
      memoryFiles.contextPath,
      "# Context\n\n## About this project\n\nLatency-critical trading dashboard, Vue + TypeScript.\n",
    );
    memoryFiles.invalidateCache();

    const builder = new PromptBuilder(memoryFiles);
    const prompt = builder.build(
      makeContext({
        memoryContext: "Recalled facts:\n- prefer Vitest over Jest\n",
      }),
    );

    const instructionsIdx = prompt.indexOf("Senior reliability engineer");
    const contextIdx = prompt.indexOf("Latency-critical trading dashboard");
    const sqlIdx = prompt.indexOf("prefer Vitest over Jest");

    expect(instructionsIdx).toBeGreaterThan(0);
    expect(contextIdx).toBeGreaterThan(instructionsIdx);
    expect(sqlIdx).toBeGreaterThan(contextIdx);
  });

  it("drops SQL-backed lines that are already shadowed by Memory.md", () => {
    memoryFiles.appendToMemory("Preferences", "Use Conventional Commits");

    const builder = new PromptBuilder(memoryFiles);
    const prompt = builder.build(
      makeContext({
        memoryContext: "Recalled facts:\n- use Conventional Commits\n- otherwise unrelated fact\n",
      }),
    );

    // The on-disk Memory.md keeps "Use Conventional Commits"; the case-
    // insensitive shadow check drops the SQL-backed echo so the model only
    // sees the canonical version once.
    expect(occurrences(prompt, /use conventional commits/gi)).toBe(1);
    expect(prompt).toContain("otherwise unrelated fact");
  });

  it("emits no file-memory section when MemoryFiles is null", () => {
    const builder = new PromptBuilder(null);
    const prompt = builder.build(
      makeContext({
        memoryContext: "Recalled facts:\n- something\n",
      }),
    );
    expect(prompt).not.toContain("Memory.md");
    expect(prompt).not.toContain("Instructions.md");
    expect(prompt).toContain("something");
  });

  it("respects the 50% file-memory budget cap", () => {
    // Fill Memory.md with content well past the system-prompt budget so the
    // truncation path engages.
    const filler = "## Preferences\n\n" + "- a really long preference line to fill the budget\n".repeat(2000);
    fs.writeFileSync(memoryFiles.memoryPath, filler);
    memoryFiles.invalidateCache();

    const builder = new PromptBuilder(memoryFiles);
    const prompt = builder.build(
      makeContext({
        // Tiny token budget exposes the truncation pathway.
        maxTokens: 4096,
        systemPromptBudgetPercent: 10,
      }),
    );

    // The renderer must drop content rather than blow past the budget. We
    // assert prompt size stays well under the raw filler size so the
    // truncation logic actually engaged.
    expect(prompt.length).toBeLessThan(filler.length);
  });
});

function occurrences(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches?.length ?? 0;
}
