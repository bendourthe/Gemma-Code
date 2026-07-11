# Performance Benchmarks (v0.3.0)

This document describes the benchmark suite, target thresholds, and the process for generating and comparing regression baselines.

## Benchmark suites

| File | Purpose |
| --- | --- |
| [tests/benchmarks/time-to-first-token.bench.ts](../../../tests/benchmarks/time-to-first-token.bench.ts) | Single-model TTFT smoke benchmark |
| [tests/benchmarks/model-tier-matrix.bench.ts](../../../tests/benchmarks/model-tier-matrix.bench.ts) | Per-tier TTFT and throughput matrix |
| [tests/benchmarks/memory-recall.bench.ts](../../../tests/benchmarks/memory-recall.bench.ts) | `MemoryStore` recall and latency |
| [tests/benchmarks/golden-task-perf.bench.ts](../../../tests/benchmarks/golden-task-perf.bench.ts) | Golden task completion time, iterations, and token cost |
| [tests/benchmarks/context-compaction.bench.ts](../../../tests/benchmarks/context-compaction.bench.ts) | Context compactor throughput |
| [tests/benchmarks/tool-execution.bench.ts](../../../tests/benchmarks/tool-execution.bench.ts) | Tool execution latency |
| [tests/benchmarks/skill-loading.bench.ts](../../../tests/benchmarks/skill-loading.bench.ts) | Skill loader cold/warm cost |
| [tests/benchmarks/rendering.bench.ts](../../../tests/benchmarks/rendering.bench.ts) | Webview markdown rendering |

## Model-tier matrix

| Tier | Model | p50 TTFT | Throughput | Context load (10K tokens) |
| --- | --- | --- | --- | --- |
| E2B | `gemma4:e2b` | < 1000 ms | > 30 tok/s | < 2 s |
| E4B | `gemma4:e4b` | < 2000 ms | > 20 tok/s | < 4 s |
| 26B | `gemma4:26b` | < 3000 ms | > 10 tok/s | < 8 s |
| 31B | `gemma4:31b` | < 5000 ms | > 5 tok/s | < 12 s |

Set `TEST_MODEL_TIERS` to a comma-separated list to run against multiple tiers in a single invocation:

```bash
OLLAMA_URL=http://localhost:11434 \
TEST_MODEL_TIERS=gemma4:e2b,gemma4:e4b \
  npm run bench -- tests/benchmarks/model-tier-matrix.bench.ts
```

## Memory recall targets

| Metric | Target |
| --- | --- |
| Keyword recall@5 | >= 0.8 on 20 known terms |
| Semantic recall@5 | >= 0.7 on 20 paraphrased queries |
| Keyword p99 latency (500 entries) | < 100 ms |
| Semantic p99 latency (500 entries) | < 500 ms |

Semantic benchmarks are automatically skipped when `OLLAMA_URL` is not set (there is no local embedding service available).

## Golden task targets per category

| Category | E2B pass rate | E4B pass rate | Mean iterations (E4B) |
| --- | --- | --- | --- |
| multi-file-edit | >= 0.6 | >= 0.8 | <= 12 |
| bug-fix | >= 0.8 | >= 0.9 | <= 8 |
| refactor | >= 0.5 | >= 0.7 | <= 14 |
| test-gen | >= 0.6 | >= 0.8 | <= 10 |
| code-review | >= 0.5 | >= 0.7 | <= 12 |

## Regression detection

`tests/golden/framework/regression.py` compares a current run against a stored baseline and reports regressions when any of the following triggers fire:

| Metric | Threshold | Severity |
| --- | --- | --- |
| `pass_fail` (task went from pass to fail) | any | error |
| Overall pass rate drop | > 5 percentage points | error |
| Task completion time | > 1.5x baseline | warn |
| Token consumption | > 1.3x baseline | warn |
| Iterations | > 1.5x baseline | warn |

## Generating and comparing baselines

1. Run the golden task suite in live mode:

   ```bash
   cd tests/golden
   OLLAMA_URL=http://localhost:11434 TEST_MODEL=gemma4:e4b \
     python -m pytest -m live_ollama
   ```

2. Save the baseline:

   ```bash
   python -c "
   from framework.baseline import save_baseline
   # results: list[TaskResult] from the run
   save_baseline(results, 'gemma4:e4b', '0.3.0', 'baselines')
   "
   ```

3. Compare a subsequent run against the stored baseline:

   ```bash
   python -c "
   from framework.baseline import load_baseline
   from framework.regression import detect_regressions, generate_regression_report
   baseline = load_baseline('baselines/0.3.0-e4b.json')
   regressions = detect_regressions(current_results, baseline)
   print(generate_regression_report(regressions))
   "
   ```

4. In CI, [.github/workflows/golden-tasks.yml](../../../.github/workflows/golden-tasks.yml) orchestrates save + compare on a weekly schedule.

## Running benchmarks locally

```bash
# Fast benchmarks (no Ollama required)
npm run bench -- tests/benchmarks/context-compaction.bench.ts

# Full model-tier matrix (requires Ollama)
OLLAMA_URL=http://localhost:11434 TEST_MODEL_TIERS=gemma4:e2b,gemma4:e4b \
  npm run bench -- tests/benchmarks/model-tier-matrix.bench.ts

# Memory recall (no Ollama required, keyword-only)
npm run bench -- tests/benchmarks/memory-recall.bench.ts

# Full golden task performance (requires Ollama + Python)
OLLAMA_URL=http://localhost:11434 TEST_MODEL=gemma4:e4b \
  npm run bench -- tests/benchmarks/golden-task-perf.bench.ts
```
