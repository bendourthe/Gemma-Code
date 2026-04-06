/**
 * Vitest benchmark suite for the MarkdownRenderer.
 * Run separately with: npx vitest bench --config configs/vitest.config.ts
 *
 * This file is EXCLUDED from the regular test run (which uses `npm run test`).
 * It contains both bench() declarations and assertion-based latency gates.
 */
import { bench, describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/utils/MarkdownRenderer.js";

// ---------------------------------------------------------------------------
// Input fixtures
// Token count approximations (4 chars/token):
//   100 tokens  ≈  400 chars
//   500 tokens  ≈ 2000 chars
//   2000 tokens ≈ 8000 chars
// ---------------------------------------------------------------------------

function paragraph(words: number): string {
  return ("lorem ipsum ").repeat(Math.ceil(words / 2)).slice(0, words * 6) + "\n\n";
}

function codeBlock(lines: number, lang = "typescript"): string {
  const line = 'const value = "some long line of code here";\n';
  return `\`\`\`${lang}\n` + line.repeat(lines) + "```\n\n";
}

const msg100 = paragraph(50) + codeBlock(5);
const msg500 = paragraph(250) + codeBlock(25);
const msg2000 = paragraph(1000) + codeBlock(100);

const P99_LIMIT_MS = 50;

// -------------------------------------------------------------------------
// Benchmark declarations (benchmark mode only)
// -------------------------------------------------------------------------

describe("MarkdownRenderer throughput", () => {
  bench("render ~100-token message", () => {
    renderMarkdown(msg100);
  });

  bench("render ~500-token message", () => {
    renderMarkdown(msg500);
  });

  bench("render ~2000-token message", () => {
    renderMarkdown(msg2000);
  });
});

// -------------------------------------------------------------------------
// Latency gates (also run in normal test mode)
// -------------------------------------------------------------------------

const ITERATIONS = 50;

function measureRenders(input: string, iterations: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    renderMarkdown(input);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b);
}

function p99(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

describe("MarkdownRenderer p99 latency gate", () => {
  it(`renders a 100-token message in under ${P99_LIMIT_MS}ms at p99`, () => {
    const times = measureRenders(msg100, ITERATIONS);
    expect(p99(times)).toBeLessThan(P99_LIMIT_MS);
  });

  it(`renders a 500-token message in under ${P99_LIMIT_MS}ms at p99`, () => {
    const times = measureRenders(msg500, ITERATIONS);
    expect(p99(times)).toBeLessThan(P99_LIMIT_MS);
  });

  it(`renders a 2000-token message in under ${P99_LIMIT_MS}ms at p99`, () => {
    const times = measureRenders(msg2000, ITERATIONS);
    expect(p99(times)).toBeLessThan(P99_LIMIT_MS);
  });
});
