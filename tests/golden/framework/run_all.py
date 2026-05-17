#!/usr/bin/env python
"""Run every golden task against live Ollama and regress against a baseline.

Designed for CI: `tests/golden/framework/run_all.py --model gemma4:e2b` loads
every YAML task under `tests/golden/tasks/`, runs it in ``live`` mode against
the OLLAMA_URL environment endpoint, writes a JSON results file, and compares
the aggregate against `tests/golden/baselines/v0.3.0-<tier>.json`.

Exit codes:
    0 - all tasks passed and no regressions exceed thresholds
    1 - one or more regressions exceed thresholds
    2 - framework / environment error (no tasks found, Ollama unreachable, etc.)

The script is framework-scoped on purpose: it reuses `task_loader`,
`task_runner`, `regression`, and `reporter` so CI parity with the local dev
loop is automatic.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

# Allow running this file directly (python tests/golden/framework/run_all.py)
# by adding the project root to sys.path so relative imports work.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent  # repo root
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.golden.framework.regression import detect_regressions  # noqa: E402
from tests.golden.framework.reporter import render_markdown_report  # noqa: E402
from tests.golden.framework.task_loader import load_all_tasks  # noqa: E402
from tests.golden.framework.task_runner import run_task  # noqa: E402
from tests.golden.framework.models import TaskResult  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", required=True, help="Ollama model tag, e.g. gemma4:e2b")
    ap.add_argument("--tier", default="e2b", help="Baseline tier label (e2b/e4b/...)")
    ap.add_argument(
        "--tasks-dir",
        default=str(ROOT / "tests" / "golden" / "tasks"),
        help="Directory containing YAML task definitions",
    )
    ap.add_argument(
        "--snapshots-dir",
        default=str(ROOT / "tests" / "golden" / "snapshots"),
        help="Scaffolded snapshot root",
    )
    ap.add_argument(
        "--baseline",
        default=None,
        help="Baseline JSON path (default: tests/golden/baselines/v0.3.0-<tier>.json)",
    )
    ap.add_argument(
        "--output",
        default="golden-task-results.json",
        help="Output JSON path for the live run",
    )
    ap.add_argument(
        "--report",
        default="golden-task-report.md",
        help="Output Markdown regression report path",
    )
    ap.add_argument(
        "--mode",
        default="live",
        choices=["live", "dry"],
        help="live = hit Ollama; dry = skip agent loop (smoke test only)",
    )
    args = ap.parse_args()

    tasks_dir = Path(args.tasks_dir)
    if not tasks_dir.is_dir():
        print(f"[run_all] Tasks directory not found: {tasks_dir}", file=sys.stderr)
        return 2

    tasks = load_all_tasks(tasks_dir)
    if not tasks:
        print(f"[run_all] No tasks found under {tasks_dir}", file=sys.stderr)
        return 2
    print(f"[run_all] Loaded {len(tasks)} tasks. Mode: {args.mode}. Model: {args.model}")

    ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434")
    results: list[TaskResult] = []
    for task in tasks:
        print(f"[run_all] Running {task.id} ({task.category})...", flush=True)
        result = run_task(
            task,
            snapshot_root=args.snapshots_dir,
            mode=args.mode,
            ollama_url=ollama_url,
            model=args.model,
        )
        results.append(result)

    # Write raw results.
    Path(args.output).write_text(
        json.dumps({"model": args.model, "tier": args.tier, "results": [asdict(r) for r in results]}, indent=2)
    )
    print(f"[run_all] Wrote {args.output}")

    # Load baseline and detect regressions.
    baseline_path = Path(
        args.baseline or (ROOT / "tests" / "golden" / "baselines" / f"v0.3.0-{args.tier}.json")
    )
    if not baseline_path.is_file():
        print(f"[run_all] Baseline not found at {baseline_path}. Nothing to compare.", file=sys.stderr)
        return 2
    baseline = json.loads(baseline_path.read_text())

    regressions = detect_regressions(results, baseline)

    report = render_markdown_report(results, baseline, regressions)
    Path(args.report).write_text(report)
    print(f"[run_all] Wrote {args.report}")

    error_regressions = [r for r in regressions if r.severity == "error"]
    if error_regressions:
        print(f"[run_all] {len(error_regressions)} error-level regressions detected.", file=sys.stderr)
        return 1

    print("[run_all] No regressions exceed error thresholds.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
