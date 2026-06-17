import * as path from "node:path";
import * as url from "node:url";
import { describe, it, expect, vi } from "vitest";
import {
  PanelExecutor,
  type LLMClientFactory,
} from "../../../modules/coding/orchestration/PanelExecutor.js";
import {
  FUSION_SECTIONS,
  FusionAgent,
  loadFusePrompt,
} from "../../../modules/coding/orchestration/FusionAgent.js";
import type { OllamaClient } from "../../../modules/coding/llm/types.js";
import { makeOllamaClient } from "../../helpers/factories.js";

// v1.6.0 adoption-openrouter-fusion Phase 2 (OF004 acceptance). End-to-end
// integration of the local panel-fusion path: PanelExecutor fans one prompt
// across two distinct mock models, and the REAL FusionAgent fuses their
// candidates using the REAL `fuse` skill prompt loaded from the catalog. No
// live model -- the panelists and the judge are mock LLM clients.

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REAL_CATALOG_DIR = path.resolve(
  __dirname,
  "../../../modules/coding/skills/catalog",
);

const JUDGE_OUTPUT = `## Consensus
Both candidates parse the input before using it.

## Contradictions
[gemma4:e4b] throws on bad input; [llama3:8b] returns null. Resolve toward throwing.

## Partial coverage
Only [llama3:8b] mentioned the empty-string boundary.

## Unique insights
[gemma4:e4b] flagged an integer-overflow risk worth keeping.

## Blind spots
Neither candidate addressed concurrent access.

## Fused answer
Parse first, throw on failure, and guard the empty-string boundary.
`;

describe("PanelExecutor + FusionAgent end-to-end (OF004)", () => {
  it("dispatches one prompt to two distinct models and fuses both candidates via the real fuse skill", async () => {
    const prompt = "Write a robust integer parser.";

    const panelClients: Record<string, OllamaClient> = {
      "gemma4:e4b": makeOllamaClient("Throw on non-numeric input."),
      "llama3:8b": makeOllamaClient("Return null on non-numeric input."),
    };
    const factory: LLMClientFactory = (id) => {
      const client = panelClients[id];
      if (!client) throw new Error(`unexpected model ${id}`);
      return client;
    };

    const judgeClient = makeOllamaClient(JUDGE_OUTPUT);
    const fusePrompt = loadFusePrompt(
      REAL_CATALOG_DIR,
      path.join(REAL_CATALOG_DIR, "__none__"),
    );
    const judge = new FusionAgent(judgeClient, "gemma4:e4b", { num_ctx: 131072 }, fusePrompt);

    const exec = new PanelExecutor({ clientFactory: factory, judge });
    const result = await exec.run(prompt, ["gemma4:e4b", "llama3:8b"]);

    // 1. Both panelists were dispatched with the SAME prompt.
    const gemmaReq = vi.mocked(panelClients["gemma4:e4b"]!.streamChat).mock.calls[0]![0];
    const llamaReq = vi.mocked(panelClients["llama3:8b"]!.streamChat).mock.calls[0]![0];
    expect(gemmaReq.messages[0]!.content).toBe(prompt);
    expect(llamaReq.messages[0]!.content).toBe(prompt);

    // 2. Both candidates were labeled and collected.
    expect(result.candidates).toEqual([
      { model: "gemma4:e4b", answer: "Throw on non-numeric input.", ok: true },
      { model: "llama3:8b", answer: "Return null on non-numeric input.", ok: true },
    ]);

    // 3. The fuse step ran over BOTH candidates: the judge saw both labels.
    const judgeReq = vi.mocked(judgeClient.streamChat).mock.calls[0]![0];
    const judgeUser = judgeReq.messages.find((m) => m.role === "user")!;
    expect(judgeUser.content).toContain("<<<CANDIDATE [gemma4:e4b]>>>");
    expect(judgeUser.content).toContain("<<<CANDIDATE [llama3:8b]>>>");

    // 4. The fused answer conforms to the F1 schema.
    expect(result.fusion.schemaValid).toBe(true);
    expect(result.fusion.fusedCandidateCount).toBe(2);
    for (const section of FUSION_SECTIONS) {
      expect(result.fusion.fusedOutput).toContain(section);
    }
  });
});
