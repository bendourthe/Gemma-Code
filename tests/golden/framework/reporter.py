"""Generate JSON and Markdown reports from a list of TaskResults."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from .types import TaskResult


def to_json(results: list[TaskResult], indent: int = 2) -> str:
    """Serialize results to a JSON string."""
    payload = [_result_dict(r) for r in results]
    return json.dumps(payload, indent=indent, sort_keys=True)


def _result_dict(r: TaskResult) -> dict:
    d = asdict(r)
    # Tuples in criteria_results aren't JSON-native; flatten to dicts.
    d["criteria_results"] = [
        {
            "type": c.type,
            "target": c.target,
            "pattern": c.pattern,
            "description": c.description,
            "passed": passed,
            "detail": detail,
        }
        for (c, passed, detail) in r.criteria_results
    ]
    return d


def to_markdown(results: list[TaskResult]) -> str:
    """Render a compact human-readable report."""
    if not results:
        return "# Golden Task Report\n\n_No results._\n"

    total = len(results)
    passed = sum(1 for r in results if r.success)
    pass_rate = passed / total if total else 0.0

    lines: list[str] = [
        "# Golden Task Report",
        "",
        f"**Pass rate:** {passed}/{total} ({pass_rate:.0%})",
        "",
        "## Summary by category",
        "",
        "| Category | Passed | Total |",
        "| --- | --- | --- |",
    ]

    # Group by prefix before the first hyphen (e.g. "multi-file-rename-01" -> "multi")
    # but we don't know category from the id alone; rely on callers to pass
    # tasks when they want category breakdown. Keep this report simple.
    by_id_prefix: Counter[str] = Counter()
    pass_by_prefix: Counter[str] = Counter()
    for r in results:
        prefix = r.task_id.split("-")[0] if "-" in r.task_id else r.task_id
        by_id_prefix[prefix] += 1
        if r.success:
            pass_by_prefix[prefix] += 1

    for prefix, count in sorted(by_id_prefix.items()):
        lines.append(f"| {prefix} | {pass_by_prefix[prefix]} | {count} |")

    lines += ["", "## Per-task results", ""]
    for r in results:
        mark = "PASS" if r.success else "FAIL"
        lines.append(f"### {mark} {r.task_id}")
        lines.append("")
        lines.append(
            f"- iterations: {r.iterations_used}   "
            f"time_ms: {r.time_elapsed_ms:.0f}   "
            f"tokens: {r.tokens_consumed}   "
            f"model: {r.model_used}"
        )
        if r.error:
            lines.append(f"- error: {r.error}")
        if r.criteria_results:
            lines.append("- criteria:")
            for c, ok, detail in r.criteria_results:
                mark2 = "PASS" if ok else "FAIL"
                lines.append(f"    - {mark2} {c.type}/{c.target} ({detail})")
        lines.append("")
    return "\n".join(lines)


def write_reports(
    results: list[TaskResult],
    output_dir: str | Path,
    basename: str = "golden-tasks",
) -> tuple[Path, Path]:
    """Write both JSON and Markdown reports; return (json_path, md_path)."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / f"{basename}.json"
    md_path = out / f"{basename}.md"
    json_path.write_text(to_json(results), encoding="utf-8")
    md_path.write_text(to_markdown(results), encoding="utf-8")
    return json_path, md_path
