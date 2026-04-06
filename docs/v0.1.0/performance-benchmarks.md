# Performance Benchmarks — Gemma Code v0.1.0

This document defines the performance targets for Gemma Code and describes how to run each benchmark suite.

---

## Benchmark Overview

| Benchmark | Target | Requires Ollama |
|---|---|---|
| Time to first token | p50 < 2000ms, p99 < 5000ms | Yes |
| Context compaction (`estimateTokens`) | p99 < 500ms for 200-message conversation | No |
| `ReadFileTool` — 10 000-line file | p99 < 50ms | No |
| `GrepCodebaseTool` — 500 files | p99 < 2000ms | No |
| Markdown rendering — 2000-token message | p99 < 100ms | No |
| Skill loading — 100 skills | p99 < 200ms | No |

---

## Running Benchmarks

### Full benchmark suite (all suites, no Ollama)

```bash
npm run bench
```

### Single suite

```bash
npx vitest bench --config configs/vitest.config.ts tests/benchmarks/<file>.bench.ts
```

### Live Ollama benchmarks

```bash
OLLAMA_URL=http://localhost:11434 TEST_MODEL=gemma3:27b npm run bench
```

---

## Benchmark Files

### `tests/benchmarks/time-to-first-token.bench.ts`

Measures wall-clock time from `streamChat()` call start to the first non-empty token. Runs against a live Ollama instance and is skipped when `OLLAMA_URL` is not set.

**Thresholds:** p50 < 2000ms, p99 < 5000ms (on local hardware with Ollama running).

### `tests/benchmarks/context-compaction.bench.ts`

Benchmarks `ContextCompactor.estimateTokens()` across conversation sizes of 50, 100, and 200 messages. No Ollama connection required.

**Threshold:** p99 < 500ms for 200-message conversations.

### `tests/benchmarks/tool-execution.bench.ts`

Benchmarks `ReadFileTool` on files of 100, 1000, and 10 000 lines using real file I/O against a temporary directory. `GrepCodebaseTool` benchmarks are included in the extended nightly run.

**Thresholds:** `ReadFileTool` p99 < 50ms for 10 000-line files.

### `tests/benchmarks/rendering.bench.ts`

Benchmarks `MarkdownRenderer.renderMarkdown()` using jsdom at message sizes of approximately 100, 500, and 2000 tokens.

**Threshold:** p99 < 100ms for 2000-token responses.

### `tests/benchmarks/skill-loading.bench.ts`

Benchmarks `SkillLoader` loading 10, 50, and 100 skills from a temporary directory on disk.

**Threshold:** p99 < 200ms for 100 skills.

---

## CI Integration

Benchmarks run nightly via the [`nightly.yml`](../../.github/workflows/nightly.yml) workflow (`benchmarks` job). Results are uploaded as a `benchmark-results` artifact with a 30-day retention period.

To manually trigger the nightly workflow: **Actions → Nightly → Run workflow**.

---

## Interpreting Results

- All latency gates are asserted as `vitest` `it()` tests. A failing gate is a CI failure.
- Benchmark `bench()` declarations produce throughput statistics (iterations/second, p50/p95/p99 latency) in the nightly artifact.
- If a threshold is consistently exceeded, profile first with `--inspect` before relaxing the gate.
