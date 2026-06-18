#!/usr/bin/env node
/**
 * scripts/run-panel-ab.mjs -- the live runner for the local A/B harness (OF010).
 *
 * v1.6.0 adoption-openrouter-fusion Phase 4. Runs a fixed set of Nexus coding
 * tasks twice -- once on the single best resident model, once on a small-model
 * panel via the FusionAgent/PanelExecutor path -- and records quality (local
 * keyword assertions) and wall-clock latency for each, then writes a structured
 * comparison report to tests/benchmarks/results/ and prints the routing-default
 * decision the A/B implies.
 *
 * Local-only, no cloud. Requires a live Ollama at OLLAMA_URL; without it the
 * script prints guidance and exits 0 (the aggregation + decision logic is
 * verified without a model in tests/unit/orchestration/PanelAbHarness.test.ts).
 *
 * The pure aggregation/decision logic lives in
 * modules/coding/orchestration/PanelAbHarness.ts; this runner is only the live
 * wiring. Run `npm run build` first so the compiled modules exist under out/.
 *
 * Usage:
 *   OLLAMA_URL=http://localhost:11434 \
 *   TEST_MODEL=gemma4:e4b \
 *   PANEL_MODELS=gemma4:e4b,qwen2.5-coder:3b,llama3.2:3b \
 *   JUDGE_MODEL=gemma4:e4b \
 *   node scripts/run-panel-ab.mjs
 *
 * F5 eval integrity: each task's keyword oracle is used only to score the
 * answer AFTER generation -- it is never concatenated into the prompt, and
 * panelists get no tools, so no arm can reach the expected output.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const OLLAMA_URL = process.env.OLLAMA_URL;
const SINGLE_MODEL = process.env.TEST_MODEL ?? "gemma4:e4b";
const PANEL_MODELS = (process.env.PANEL_MODELS ?? "gemma4:e4b,qwen2.5-coder:3b,llama3.2:3b")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? SINGLE_MODEL;

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_DIR = path.join(REPO_ROOT, "modules", "coding", "skills", "catalog");
const RESULTS_DIR = path.join(REPO_ROOT, "tests", "benchmarks", "results");

if (!OLLAMA_URL) {
  console.log(
    "[panel-ab] OLLAMA_URL is not set; skipping the live A/B run.\n" +
      "[panel-ab] Set OLLAMA_URL (and optionally TEST_MODEL / PANEL_MODELS / JUDGE_MODEL)\n" +
      "[panel-ab] and run `npm run build` first. The aggregation + routing-default\n" +
      "[panel-ab] logic is verified without a model in PanelAbHarness.test.ts.",
  );
  process.exit(0);
}

// A small, fixed fixture of Nexus coding tasks. Keyword oracles score the answer
// after generation; they are NEVER part of the prompt (F5 eval integrity).
const TASKS = [
  {
    id: "parse-int-robust",
    category: "code",
    prompt:
      "Write a TypeScript function that parses a string to an integer and " +
      "rejects non-numeric input. Explain how it handles the empty string.",
    keywords: ["number", "throw", "empty"],
  },
  {
    id: "null-guard",
    category: "bugfix",
    prompt:
      "Given a function that dereferences obj.user.name, describe the bug when " +
      "user is undefined and the safest fix.",
    keywords: ["undefined", "optional", "guard"],
  },
  {
    id: "dedupe-array",
    category: "code",
    prompt:
      "Write a function that removes duplicate items from an array of strings " +
      "while preserving order. State its time complexity.",
    keywords: ["set", "order", "complexity"],
  },
];

/**
 * Minimal vscode-free Ollama chat client for this benchmark runner. The shipped
 * `createOllamaClient` factory (modules/coding/llm/OllamaClient.ts) statically
 * imports the settings module, which `require`s `vscode` and so cannot load in a
 * plain-Node script -- the same vscode coupling A4 worked around with
 * `TraceDbReader`. This implements only the `streamChat` slice that
 * `PanelExecutor` and `FusionAgent` consume, reading the Ollama `/api/chat`
 * NDJSON stream over `fetch`.
 */
function createFetchOllamaClient(baseUrl) {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async *streamChat(request) {
      const res = await fetch(`${root}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Ollama /api/chat failed: ${res.status} ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const chunk = JSON.parse(trimmed);
            yield chunk;
            if (chunk.done) return;
          }
        }
        const tail = buffer.trim();
        if (tail) yield JSON.parse(tail);
      } finally {
        reader.releaseLock();
      }
    },
  };
}

async function main() {
  const { PanelExecutor } = await import(
    "../out/modules/coding/orchestration/PanelExecutor.js"
  );
  const { FusionAgent, loadFusePrompt } = await import(
    "../out/modules/coding/orchestration/FusionAgent.js"
  );
  const { runAbHarness, scoreByKeywords, measurePanelRun, decidePanelRoutingDefault } =
    await import("../out/modules/coding/orchestration/PanelAbHarness.js");

  const client = createFetchOllamaClient(OLLAMA_URL);

  async function collect(model, prompt) {
    let answer = "";
    const stream = client.streamChat({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });
    for await (const chunk of stream) {
      answer += chunk.message.content ?? "";
    }
    return answer;
  }

  const fusePrompt = loadFusePrompt(CATALOG_DIR);
  const judge = new FusionAgent(client, JUDGE_MODEL, { num_ctx: 131072 }, fusePrompt);
  const executor = new PanelExecutor({
    clientFactory: () => client,
    judge,
  });

  // Map task id -> keyword oracle so the runners can score without leaking it.
  const oracle = new Map(TASKS.map((t) => [t.id, t.keywords]));

  const runners = {
    runSingle: async (task) => {
      const start = performance.now();
      const answer = await collect(SINGLE_MODEL, task.prompt);
      const latencyMs = performance.now() - start;
      return { quality: scoreByKeywords(answer, oracle.get(task.id) ?? []), latencyMs };
    },
    runPanel: async (task) => {
      const start = performance.now();
      const run = await executor.run(task.prompt, PANEL_MODELS);
      const latencyMs = performance.now() - start;
      return measurePanelRun(run, latencyMs, (fused) =>
        scoreByKeywords(fused, oracle.get(task.id) ?? []),
      );
    },
  };

  const report = await runAbHarness(
    TASKS.map(({ id, prompt, category }) => ({ id, prompt, category })),
    runners,
    { tieEpsilon: 0.05 },
  );
  const decision = decidePanelRoutingDefault(report);

  const result = {
    generatedAt: new Date().toISOString(),
    singleModel: SINGLE_MODEL,
    panelModels: PANEL_MODELS,
    judgeModel: JUDGE_MODEL,
    report,
    routingDefaultDecision: decision,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(
    RESULTS_DIR,
    `panel-ab-${result.generatedAt.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`[panel-ab] tasks: ${report.taskCount}`);
  console.log(
    `[panel-ab] panel wins: ${report.panelWins}  single wins: ${report.singleWins}  ties: ${report.ties}`,
  );
  console.log(
    `[panel-ab] mean quality delta (panel - single): ${report.aggregateQualityDelta.toFixed(3)}`,
  );
  console.log(`[panel-ab] latency multiplier (panel / single): ${report.latencyMultiplier.toFixed(2)}x`);
  console.log(`[panel-ab] routing default -> ${decision.enableByDefault ? "ON" : "opt-in (off)"}: ${decision.rationale}`);
  console.log(`[panel-ab] wrote ${path.relative(REPO_ROOT, outFile)}`);
}

main().catch((err) => {
  console.error("[panel-ab] failed:", err);
  process.exit(1);
});
