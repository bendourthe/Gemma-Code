# Performance comparison: v0.2.0 vs v0.3.0

_This document is a template. Once the v0.3.0 baseline is generated on reference hardware (per [performance-benchmarks.md](performance-benchmarks.md)), fill in the tables below by running `framework.comparison.compare_versions`._

## Methodology

All benchmarks are executed against the golden-task suite defined in [tests/golden/](../../tests/golden/). For each run:

1. Install a clean reference environment via the PyQt5 installer.
2. Pull the target model (`gemma4:e2b` or `gemma4:e4b`).
3. Execute every task in the suite via `python -m pytest -m live_ollama`.
4. Save the baseline with `framework.baseline.save_baseline(results, <model>, <version>, <dir>)`.

Tasks use `worktree`-based isolation, so each run starts from an identical snapshot.

## Hardware requirements for reproducible results

- Nvidia GPU with at least 12 GB VRAM (Tier 2) for E4B
- Nvidia GPU with at least 8 GB VRAM (Tier 1) for E2B
- 32 GB system RAM
- SSD-backed disk for snapshot worktrees
- Same `gemma4` model version across both runs (pinned digest recommended)

## Overall metrics

| Metric | v0.2.0 | v0.3.0 | Delta |
| --- | --- | --- | --- |
| Overall pass rate | _pending_ | _pending_ | _pending_ |
| Mean iterations per task | _pending_ | _pending_ | _pending_ |
| Mean wall-clock time per task | _pending_ | _pending_ | _pending_ |
| Total tokens across suite | _pending_ | _pending_ | _pending_ |

## Per-category breakdown

| Category | v0.2.0 pass rate | v0.3.0 pass rate | Delta |
| --- | --- | --- | --- |
| multi-file-edit | _pending_ | _pending_ | _pending_ |
| bug-fix | _pending_ | _pending_ | _pending_ |
| refactor | _pending_ | _pending_ | _pending_ |
| test-gen | _pending_ | _pending_ | _pending_ |
| code-review | _pending_ | _pending_ | _pending_ |

## Notable improvements

_To be filled in by `generate_comparison_markdown`._

## Regressions

_To be filled in by `generate_comparison_markdown`._

## Generating this comparison

```bash
python -c "
from tests.golden.framework.baseline import load_baseline
from tests.golden.framework.comparison import compare_versions, generate_comparison_markdown
v2 = load_baseline('tests/golden/baselines/v0.2.0-e4b.json')
v3 = load_baseline('tests/golden/baselines/v0.3.0-e4b.json')
print(generate_comparison_markdown(compare_versions(v2, v3)))
"
```
