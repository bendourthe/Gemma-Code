/**
 * Time-to-first-token benchmark.
 *
 * Measures the wall-clock time from the moment sendMessage() is called on the
 * OllamaClient until the first token is yielded by the streaming generator.
 *
 * Requires a live Ollama instance. The test is skipped automatically when the
 * OLLAMA_URL environment variable is not set.
 *
 * Run separately (nightly CI or manual):
 *   npx vitest bench --config configs/vitest.config.ts tests/benchmarks/time-to-first-token.bench.ts
 */

import { bench, describe, it, expect } from "vitest";
import { createOllamaClient } from "../../src/ollama/client.js";

const OLLAMA_URL = process.env["OLLAMA_URL"];
const MODEL = process.env["TEST_MODEL"] ?? "gemma3:2b";

// ---------------------------------------------------------------------------
// Latency thresholds (ms)
// ---------------------------------------------------------------------------
const P50_LIMIT_MS = 2_000;
const P99_LIMIT_MS = 5_000;
const ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function measureFirstToken(client: ReturnType<typeof createOllamaClient>): Promise<number> {
  const start = performance.now();
  const stream = client.streamChat({
    model: MODEL,
    messages: [{ role: "user", content: "Say one word." }],
    stream: true,
  });

  for await (const chunk of stream) {
    if (chunk.message.content) {
      return performance.now() - start;
    }
  }

  return performance.now() - start;
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil(sorted.length * pct) - 1;
  return sorted[Math.max(0, idx)] ?? Infinity;
}

// ---------------------------------------------------------------------------
// Live benchmark (skipped when OLLAMA_URL is absent)
// ---------------------------------------------------------------------------

describe("time-to-first-token", () => {
  it.skipIf(!OLLAMA_URL)(
    `p50 < ${P50_LIMIT_MS}ms and p99 < ${P99_LIMIT_MS}ms (live Ollama)`,
    async () => {
      const client = createOllamaClient();
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        latencies.push(await measureFirstToken(client));
      }

      latencies.sort((a, b) => a - b);

      const p50 = percentile(latencies, 0.5);
      const p99 = percentile(latencies, 0.99);

      console.log(
        `[TTFT] n=${ITERATIONS}  p50=${p50.toFixed(0)}ms  p99=${p99.toFixed(0)}ms`
      );

      expect(p50).toBeLessThan(P50_LIMIT_MS);
      expect(p99).toBeLessThan(P99_LIMIT_MS);
    },
    60_000 // generous timeout for live Ollama
  );
});

// ---------------------------------------------------------------------------
// Benchmark declarations (benchmark mode only — no Ollama required)
// ---------------------------------------------------------------------------

if (OLLAMA_URL) {
  describe("TTFT throughput", () => {
    const client = createOllamaClient();

    bench(
      "time to first token from Ollama",
      async () => {
        await measureFirstToken(client);
      },
      { iterations: ITERATIONS }
    );
  });
}
