import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { createOllamaClient } from "../../../modules/coding/llm/OllamaClient.js";
import { loadGoldenTask } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import {
  runGoldenTask,
  zeroSessionMetrics,
  type AgentDriver,
} from "../../../modules/coding/evaluation/GoldenTaskRunner.js";

/**
 * v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- live golden-
 * runner smoke against a real Ollama backend.
 *
 * Skipped by default. Set `GOLDEN_LIVE_OLLAMA=1` AND `OLLAMA_URL` (and
 * optionally `TEST_MODEL`) with a local Ollama serving at least one model.
 * The test drives the runner's live path with a driver backed by the real
 * (vscode-free) OllamaClient: it confirms the backend is reachable, streams one
 * completion, and proves the runner materialize -> live-run -> evaluate -> score
 * round-trip executes against the real backend. It does NOT assert the model
 * solved the task (a smoke, not an eval).
 *
 * NO automatic outbound traffic: with the env var unset the block is skipped.
 */

const LIVE = process.env.GOLDEN_LIVE_OLLAMA === "1";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SNAPSHOTS_ROOT = path.join(REPO_ROOT, "tests", "golden", "snapshots");
const TASKS_DIR = path.join(REPO_ROOT, "tests", "golden", "tasks");

describe.runIf(LIVE)("golden runner live (env-gated)", () => {
  it("runs one task against the real Ollama backend and produces a scored result", async () => {
    const client = createOllamaClient({ baseUrl: OLLAMA_URL, timeoutMs: 30_000 });
    expect(await client.checkHealth()).toBe(true);
    const models = await client.listModels();
    expect(models.length).toBeGreaterThan(0);
    const model = process.env.TEST_MODEL ?? models[0]!.name;

    const driver: AgentDriver = {
      run: async () => {
        let chunks = 0;
        for await (const _chunk of client.streamChat({
          model,
          messages: [{ role: "user", content: "Reply with the single word: ok." }],
          options: { temperature: 0, num_ctx: 512 },
        })) {
          chunks += 1;
          if (chunks > 200) break; // runaway-stream safety cap
        }
        expect(chunks).toBeGreaterThan(0);
        return { traceId: "live-smoke", metrics: { ...zeroSessionMetrics(), llmCallCount: 1 } };
      },
    };

    const spec = loadGoldenTask(path.join(TASKS_DIR, "testgen-unit-function-01.yaml"));
    const result = await runGoldenTask(spec, { mode: "live", snapshotRoot: SNAPSHOTS_ROOT, driver });

    expect(result.taskId).toBe(spec.id);
    expect(typeof result.passed).toBe("boolean");
    expect(result.metrics.llmCallCount).toBe(1);
    expect(result.traceId).toBe("live-smoke");
  }, 120_000);
});
