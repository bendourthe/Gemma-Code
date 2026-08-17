import { describe, it, expect, vi } from "vitest";
import { mockOf } from "../../helpers/factories.js";
import type { GemmaCodeSettings } from "../../../modules/coding/config/settings.js";
import {
  HarnessSelector,
  HarnessSessionOverride,
  toPromptOverlay,
} from "../../../modules/coding/orchestration/HarnessSelector.js";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/ws" } }],
  },
}));

const { ToolActivationContext } = await import("../../../src/panels/ToolActivationContext.js");

function settings(partial: Partial<GemmaCodeSettings> = {}): GemmaCodeSettings {
  return {
    modelName: "llama3.2:3b",
    maxTokens: 8192,
    thinkingMode: false,
    promptStyle: "concise",
    systemPromptBudgetPercent: 10,
    harnessSelectorEnabled: false,
    ...partial,
  } as GemmaCodeSettings;
}

function makeContext(opts: {
  settings: GemmaCodeSettings;
  selector?: HarnessSelector;
  session?: HarnessSessionOverride;
}): InstanceType<typeof ToolActivationContext> {
  return new ToolActivationContext({
    planMode: mockOf({ active: false }),
    getSettings: () => opts.settings,
    getRegistry: () => null,
    getMcpTools: () => [],
    getOllamaReachable: () => true,
    getTierConfig: () => undefined,
    getWorkingMemory: () => null,
    getUnifiedRetriever: () => null,
    ...(opts.selector ? { getHarnessSelector: () => opts.selector } : {}),
    ...(opts.session ? { getHarnessSession: () => opts.session } : {}),
  });
}

describe("ToolActivationContext.buildPromptContext -- harness overlay (v1.18 OI-A5)", () => {
  it("is byte-identical to settings knobs when the selector is off", () => {
    const s = settings({ harnessSelectorEnabled: false, thinkingMode: false, promptStyle: "concise" });
    const ctx = makeContext({ settings: s });
    const prompt = ctx.buildPromptContext();
    expect(prompt.thinkingMode).toBe(false);
    expect(prompt.promptStyle).toBe("concise");
    expect(prompt.systemPromptBudgetPercent).toBe(10);
    expect(prompt.modelName).toBe("llama3.2:3b");
  });

  it("spreads the selected overlay when the selector is on", () => {
    const s = settings({
      modelName: "qwen2.5-coder:7b",
      harnessSelectorEnabled: true,
      promptStyle: "concise",
      thinkingMode: false,
      systemPromptBudgetPercent: 10,
    });
    const ctx = makeContext({ settings: s });
    const prompt = ctx.buildPromptContext();
    const overlay = new HarnessSelector().overlayForModel("qwen2.5-coder:7b");
    expect(prompt.promptStyle).toBe(overlay.promptStyle);
    expect(prompt.thinkingMode).toBe(overlay.thinkingMode);
    expect(prompt.systemPromptBudgetPercent).toBe(overlay.systemPromptBudgetPercent);
    expect(prompt.promptStyle).toBe("detailed");
    expect(prompt.thinkingMode).toBe(true);
  });

  it("applies a session override only when the selector is on", () => {
    const selector = new HarnessSelector();
    const session = new HarnessSessionOverride();
    session.set("plan-first", "llama3.2:3b");

    const off = makeContext({
      settings: settings({ harnessSelectorEnabled: false }),
      selector,
      session,
    }).buildPromptContext();
    expect(off.promptStyle).toBe("concise");
    expect(off.systemPromptBudgetPercent).toBe(10);

    const on = makeContext({
      settings: settings({ harnessSelectorEnabled: true }),
      selector,
      session,
    }).buildPromptContext();
    expect(on.promptStyle).toBe(toPromptOverlay(selector.select("llama3.2:3b", "plan-first").profile).promptStyle);
    expect(on.promptStyle).toBe("detailed");
  });

  it("never throws for an unknown model (falls back to the default overlay)", () => {
    const s = settings({ modelName: "not-a-real-model", harnessSelectorEnabled: true });
    const ctx = makeContext({ settings: s });
    expect(() => ctx.buildPromptContext()).not.toThrow();
    const prompt = ctx.buildPromptContext();
    expect(prompt.promptStyle).toBe("concise");
    expect(prompt.thinkingMode).toBe(true);
    expect(prompt.systemPromptBudgetPercent).toBe(12);
  });
});
