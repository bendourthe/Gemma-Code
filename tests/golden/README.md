# Golden Task Suite

Evaluation harness for Gemma Code. Each task is a YAML file in [tasks/](tasks/) paired with a self-contained git snapshot in [snapshots/](snapshots/). A task runs the full agent loop against a fresh copy of its snapshot, then evaluates the result against declarative success criteria.

## Layout

```
tests/golden/
  framework/           Python framework (loader, runner, evaluator, reporter)
  tasks/               24 YAML task definitions
  snapshots/           Initial state for every task (mini git repos)
  baselines/           Per-model-tier regression baselines
  .worktrees/          Ephemeral copies used during runs (auto-cleaned)
```

## Task categories

| Category | Count | IDs |
| --- | --- | --- |
| multi-file-edit | 5 | `multi-file-*` |
| bug-fix | 5 | `bugfix-*` |
| refactor | 5 | `refactor-*` |
| test-gen | 5 | `testgen-*` |
| code-review | 4 | `review-*` |

Each category spans easy to hard difficulty.

## Writing a task

A task YAML must declare:

```yaml
id: my-task-01
name: Human-readable name
category: multi-file-edit        # or bug-fix / refactor / test-gen / code-review
description: |
  The natural-language prompt a user would type into Gemma Code.
initial_state: snapshots/my-task-01
expected_files_changed:
  - src/foo.ts
success_criteria:
  - type: file_contains
    target: src/foo.ts
    pattern: "transformPayload"
    description: function renamed
  - type: output_contains
    target: npx tsc --noEmit
    pattern: ""        # empty pattern → just requires exit 0
    description: typecheck passes
max_iterations: 20
timeout_seconds: 300
model_tier: e4b         # or e2b / 26b / 31b / any
tags: [fast, typescript]
```

Supported `type` values:

| Type | Meaning |
| --- | --- |
| `file_contains` | File at `target` matches regex `pattern` |
| `file_exists` | File at `target` exists |
| `file_deleted` | File at `target` does not exist |
| `test_passes` | Shell command in `target` exits zero |
| `lint_passes` | Shell command in `target` exits zero |
| `diff_matches` | `git diff` output contains regex `pattern` |
| `output_contains` | Shell command in `target` produces output matching `pattern` |
| `no_errors` | Shell command in `target` exits zero |

## Running locally

Install deps (from `tests/golden/`):

```bash
uv sync --group dev
```

Dry run (no Ollama required — just exercises snapshot setup + evaluation):

```bash
python -m pytest framework/
```

Full run (requires Ollama + Gemma Code backend):

```bash
OLLAMA_URL=http://localhost:11434 TEST_MODEL=gemma4:e4b \
  python -m pytest -m live_ollama
```

## Running a single task programmatically

```python
from framework.task_loader import load_task
from framework.task_runner import run_task
task = load_task("tasks/multi-file-rename-01.yaml")
result = run_task(task, snapshot_root="snapshots", mode="live")
print(result.success, result.iterations_used)
```

## Baselines and regressions

`framework/baseline.py` saves a full run's aggregate as JSON under `baselines/v<version>-<tier>.json`. `framework/regression.py` compares a fresh run against a stored baseline and reports pass-rate drops, time regressions, and token-efficiency regressions.

See [docs/v0.3.0/performance-benchmarks.md](../../docs/v0.3.0/performance-benchmarks.md) for thresholds.
