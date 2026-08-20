import { describe, it, expect } from "vitest";
import { classifyEditApply, noopEditMessage } from "../../../src/tools/handlers/editNoop.js";
import { nearMissToken, takeNearMisses, escapeRegexLiteral } from "../../../src/tools/handlers/nearMiss.js";
import { originForTool, TOOL_RESULT_ORIGINS } from "../../../modules/coding/guardrails/toolResultOrigin.js";
import { formatToolResult } from "../../../src/tools/Gemma4ToolFormat.js";
import {
  assembleToolPromptDocs,
  TOOL_PROMPT_TOKEN_BUDGET,
} from "../../../modules/coding/chat/ToolPromptAssembler.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import type { PromptContext } from "../../../modules/coding/chat/PromptBuilder.types.js";

describe("editNoop", () => {
  it("reports noop when new_string is already in the file and old_string is gone", () => {
    expect(classifyEditApply("const x = 2;", "const x = 1;", "const x = 2;")).toBe("noop");
  });

  it("reports apply when old_string occurs once", () => {
    expect(classifyEditApply("hello world", "hello", "hi")).toBe("apply");
  });

  it("reports missing when neither side is present as an applied edit", () => {
    expect(classifyEditApply("abc", "zzz", "yyy")).toBe("missing");
  });

  it("reports ambiguous when old_string occurs twice", () => {
    expect(classifyEditApply("aa aa", "aa", "bb")).toBe("ambiguous");
  });

  it("noop message names the path", () => {
    expect(noopEditMessage("src/a.ts")).toContain("src/a.ts");
  });
});

describe("nearMiss", () => {
  it("extracts a token from a regex-ish pattern", () => {
    expect(nearMissToken("fooBar\\d+")).toBe("fooBar");
    expect(nearMissToken("ab")).toBe("ab");
    expect(nearMissToken(".")).toBeNull();
  });

  it("escapes regex literals", () => {
    expect(escapeRegexLiteral("a.b")).toBe("a\\.b");
  });

  it("caps probes at 5", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      file: `f${i}.ts`,
      line: 1,
      content: "x",
    }));
    expect(takeNearMisses(many)).toHaveLength(5);
  });
});

describe("tool result origin", () => {
  it("covers the closed taxonomy including reserved browser_snapshot", () => {
    expect(TOOL_RESULT_ORIGINS).toContain("browser_snapshot");
    expect(TOOL_RESULT_ORIGINS).toContain("stt_transcript");
    expect(originForTool("fetch_page")).toBe("web_fetch");
    expect(originForTool("run_terminal")).toBe("terminal");
    expect(originForTool("mcp:server/tool")).toBe("mcp_tool");
    expect(originForTool("hash_file")).toBe("workspace_file");
    expect(originForTool("browser_aria_snapshot")).toBe("browser_snapshot");
    expect(originForTool("browser_navigate")).toBe("browser_snapshot");
  });

  it("formatToolResult includes origin end-to-end", () => {
    const out = formatToolResult("fetch_page", {
      id: "1",
      success: true,
      output: "hello",
      origin: "web_fetch",
    });
    expect(out).toContain('"origin": "web_fetch"');
  });
});

describe("ToolPromptAssembler", () => {
  it("surfaces a registered test tool that is not in the static catalog", () => {
    const assembled = assembleToolPromptDocs(TOOL_CATALOG, ["test_probe"]);
    expect(assembled.tools.some((t) => t.name === "test_probe")).toBe(true);
    expect(assembled.overBudget).toBe(false);
    expect(assembled.estimatedTokens).toBeLessThan(TOOL_PROMPT_TOKEN_BUDGET);
  });

  it("PromptBuilder emits the test tool when registeredToolNames is set", () => {
    const builder = new PromptBuilder();
    const ctx: PromptContext = {
      modelName: "gemma4:e4b",
      maxTokens: 131072,
      planModeActive: false,
      thinkingMode: false,
      enabledTools: TOOL_CATALOG.slice(0, 3),
      promptStyle: "concise",
      registeredToolNames: ["test_probe"],
    };
    const prompt = builder.buildSync(ctx);
    expect(prompt).toContain("test_probe");
  });
});
