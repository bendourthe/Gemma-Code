import { describe, it, expect } from "vitest";
import { createLmStudioClient } from "../../../modules/coding/llm/LmStudioClient.js";

/**
 * v0.9.0 Phase 6.7 (from v0.8.0 known-gaps 10.O.J) -- LM Studio live
 * integration test.
 *
 * Skipped by default. Set `LMSTUDIO_LIVE=1` in the environment AND run a
 * local LM Studio server on `127.0.0.1:1234` with at least one model
 * loaded. The test exercises a single streamed completion round-trip to
 * verify the OpenAI-shaped SSE parser handles a real server stream (not
 * just the mocked-fetch suite at tests/unit/llm/LmStudioClient.test.ts).
 *
 * NO automatic outbound network traffic: with the env var unset the
 * `describe.runIf` block is skipped silently.
 */

const LIVE = process.env.LMSTUDIO_LIVE === "1";
const BASE_URL = process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234";

describe.runIf(LIVE)("LM Studio live (env-gated)", () => {
  it("streams one completion against the local server", async () => {
    const client = createLmStudioClient({
      baseUrl: BASE_URL,
      timeoutMs: 30_000,
    });

    const healthy = await client.checkHealth();
    expect(healthy).toBe(true);

    const models = await client.listModels();
    expect(models.length).toBeGreaterThan(0);
    const model = models[0]!.name;

    let totalChunks = 0;
    let accumulated = "";
    for await (const chunk of client.streamChat({
      model,
      messages: [
        { role: "user", content: "Reply with the single word: ok." },
      ],
      options: { temperature: 0, num_ctx: 512 },
    })) {
      totalChunks += 1;
      if (chunk.content) accumulated += chunk.content;
      if (totalChunks > 200) break; // safety cap for runaway streams
    }

    expect(totalChunks).toBeGreaterThan(0);
    expect(accumulated.length).toBeGreaterThan(0);
  }, 60_000);
});
