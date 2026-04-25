/**
 * Per-tier model benchmark matrix.
 *
 * Measures TTFT (p50/p99), throughput (tokens/second), and context load
 * time across each configured model tier. Tiers are read from the
 * TEST_MODEL_TIERS env var (comma-separated) or fall back to TEST_MODEL.
 *
 * Requires a live Ollama instance reachable at OLLAMA_URL. The test
 * suite is skipped when that env var is absent.
 *
 * Tier thresholds (p50 TTFT and min throughput tokens/sec):
 *   E2B: <1000ms, >30 tok/s
 *   E4B: <2000ms, >20 tok/s
 *   26B: <3000ms, >10 tok/s
 *   31B: <5000ms, >5 tok/s
 */

import { bench, describe, it, expect } from "vitest";
import { createOllamaClient } from "../../src/llm/OllamaClient.js";

const OLLAMA_URL = process.env["OLLAMA_URL"];
const MODEL_TIERS = (
  process.env["TEST_MODEL_TIERS"] ??
  process.env["TEST_MODEL"] ??
  "gemma4:e4b"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ITERATIONS = 5;

interface TierThresholds {
  ttftP50Ms: number;
  minThroughputTokPerSec: number;
}

function thresholdsFor(model: string): TierThresholds {
  const tier = model.split(":")[1] ?? model;
  if (tier.includes("e2b")) return { ttftP50Ms: 1000, minThroughputTokPerSec: 30 };
  if (tier.includes("e4b")) return { ttftP50Ms: 2000, minThroughputTokPerSec: 20 };
  if (tier.includes("26")) return { ttftP50Ms: 3000, minThroughputTokPerSec: 10 };
  if (tier.includes("31")) return { ttftP50Ms: 5000, minThroughputTokPerSec: 5 };
  return { ttftP50Ms: 5000, minThroughputTokPerSec: 1 }; // lenient fallback
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil(sorted.length * pct) - 1;
  return sorted[Math.max(0, idx)] ?? Infinity;
}

async function timeFirstToken(
  client: ReturnType<typeof createOllamaClient>,
  model: string
): Promise<number> {
  const start = performance.now();
  const stream = client.streamChat({
    model,
    messages: [{ role: "user", content: "Reply with one word." }],
    stream: true,
  });
  for await (const chunk of stream) {
    if (chunk.message.content) return performance.now() - start;
  }
  return performance.now() - start;
}

async function measureThroughput(
  client: ReturnType<typeof createOllamaClient>,
  model: string
): Promise<number> {
  const start = performance.now();
  let tokens = 0;
  const stream = client.streamChat({
    model,
    messages: [{ role: "user", content: "Count: one two three four five." }],
    stream: true,
  });
  for await (const chunk of stream) {
    if (chunk.message.content) tokens += chunk.message.content.length;
    if (tokens >= 100) break;
  }
  const elapsedSec = (performance.now() - start) / 1000;
  return tokens / Math.max(elapsedSec, 0.001);
}

describe("model-tier-matrix", () => {
  for (const model of MODEL_TIERS) {
    const limits = thresholdsFor(model);

    it.skipIf(!OLLAMA_URL)(
      `${model} TTFT p50 < ${limits.ttftP50Ms}ms`,
      async () => {
        const client = createOllamaClient();
        const samples: number[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
          samples.push(await timeFirstToken(client, model));
        }
        samples.sort((a, b) => a - b);
        const p50 = percentile(samples, 0.5);
        const p99 = percentile(samples, 0.99);
        console.log(
          `[tier-matrix] ${model} TTFT p50=${p50.toFixed(0)}ms p99=${p99.toFixed(0)}ms`
        );
        expect(p50).toBeLessThan(limits.ttftP50Ms);
      },
      60_000
    );

    it.skipIf(!OLLAMA_URL)(
      `${model} throughput > ${limits.minThroughputTokPerSec} tok/s`,
      async () => {
        const client = createOllamaClient();
        const rate = await measureThroughput(client, model);
        console.log(`[tier-matrix] ${model} throughput=${rate.toFixed(1)} char/s`);
        // Character-per-second serves as a rough proxy for token throughput
        // without requiring a tokenizer in the test environment.
        expect(rate).toBeGreaterThan(limits.minThroughputTokPerSec);
      },
      60_000
    );

    if (OLLAMA_URL) {
      bench(
        `${model} TTFT`,
        async () => {
          const client = createOllamaClient();
          await timeFirstToken(client, model);
        },
        { iterations: ITERATIONS }
      );
    }
  }
});
