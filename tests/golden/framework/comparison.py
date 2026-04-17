"""Compare two golden-task baselines (e.g. v0.2.0 vs v0.3.0)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CategoryDelta:
    category: str
    pass_rate_v2: float
    pass_rate_v3: float
    mean_time_v2_ms: float
    mean_time_v3_ms: float


@dataclass
class TaskDelta:
    task_id: str
    v2_passed: bool | None
    v3_passed: bool | None
    time_delta_ms: float | None


@dataclass
class ComparisonReport:
    baseline_version: str
    current_version: str
    overall_v2: float = 0.0
    overall_v3: float = 0.0
    tokens_v2: int = 0
    tokens_v3: int = 0
    categories: list[CategoryDelta] = field(default_factory=list)
    improvements: list[TaskDelta] = field(default_factory=list)
    regressions: list[TaskDelta] = field(default_factory=list)
    new_tasks: list[str] = field(default_factory=list)


def compare_versions(
    baseline_v2: dict,
    baseline_v3: dict,
) -> ComparisonReport:
    """Build a report comparing two baseline payloads."""
    v2_tasks = baseline_v2.get("tasks", {}) or {}
    v3_tasks = baseline_v3.get("tasks", {}) or {}
    v2_agg = baseline_v2.get("aggregates", {}) or {}
    v3_agg = baseline_v3.get("aggregates", {}) or {}

    report = ComparisonReport(
        baseline_version=str(baseline_v2.get("version", "?")),
        current_version=str(baseline_v3.get("version", "?")),
        overall_v2=float(v2_agg.get("pass_rate", 0.0) or 0.0),
        overall_v3=float(v3_agg.get("pass_rate", 0.0) or 0.0),
        tokens_v2=int(v2_agg.get("total_tokens", 0) or 0),
        tokens_v3=int(v3_agg.get("total_tokens", 0) or 0),
    )

    # Per-category deltas
    v2_cats = v2_agg.get("by_category", {}) or {}
    v3_cats = v3_agg.get("by_category", {}) or {}
    for cat in sorted(set(v2_cats) | set(v3_cats)):
        v2c = v2_cats.get(cat, {})
        v3c = v3_cats.get(cat, {})
        report.categories.append(
            CategoryDelta(
                category=cat,
                pass_rate_v2=float(v2c.get("pass_rate", 0.0) or 0.0),
                pass_rate_v3=float(v3c.get("pass_rate", 0.0) or 0.0),
                mean_time_v2_ms=float(v2c.get("mean_time_ms", 0.0) or 0.0),
                mean_time_v3_ms=float(v3c.get("mean_time_ms", 0.0) or 0.0),
            )
        )

    # Per-task deltas
    for task_id in sorted(set(v2_tasks) | set(v3_tasks)):
        v2_t = v2_tasks.get(task_id)
        v3_t = v3_tasks.get(task_id)
        if v2_t is None and v3_t is not None:
            report.new_tasks.append(task_id)
            continue
        if v3_t is None:
            continue
        v2_passed = bool(v2_t.get("passed"))
        v3_passed = bool(v3_t.get("passed"))
        delta_ms = None
        if v2_t.get("time_ms") is not None and v3_t.get("time_ms") is not None:
            delta_ms = float(v3_t["time_ms"]) - float(v2_t["time_ms"])
        td = TaskDelta(task_id, v2_passed, v3_passed, delta_ms)
        if (not v2_passed) and v3_passed:
            report.improvements.append(td)
        elif v2_passed and (not v3_passed):
            report.regressions.append(td)

    return report


def generate_comparison_markdown(report: ComparisonReport) -> str:
    """Render a ComparisonReport as Markdown."""
    lines: list[str] = [
        f"# {report.baseline_version} vs {report.current_version} comparison",
        "",
        "## Executive summary",
        "",
        (
            f"Overall pass rate changed from {report.overall_v2:.1%} to "
            f"{report.overall_v3:.1%}."
        ),
        "",
        "## Overall metrics",
        "",
        f"| Metric | v{report.baseline_version} | v{report.current_version} | Delta |",
        "| --- | --- | --- | --- |",
        f"| Pass rate | {report.overall_v2:.1%} | {report.overall_v3:.1%} | "
        f"{(report.overall_v3 - report.overall_v2) * 100:+.1f} pts |",
        f"| Total tokens | {report.tokens_v2} | {report.tokens_v3} | "
        f"{report.tokens_v3 - report.tokens_v2:+d} |",
        "",
        "## Per-category breakdown",
        "",
        (
            f"| Category | v{report.baseline_version} pass | "
            f"v{report.current_version} pass | "
            f"v{report.baseline_version} mean ms | "
            f"v{report.current_version} mean ms |"
        ),
        "| --- | --- | --- | --- | --- |",
    ]
    for cat in report.categories:
        lines.append(
            f"| {cat.category} | {cat.pass_rate_v2:.1%} | {cat.pass_rate_v3:.1%} | "
            f"{cat.mean_time_v2_ms:.0f} | {cat.mean_time_v3_ms:.0f} |"
        )

    if report.improvements:
        lines += ["", "## Improvements", ""]
        for t in report.improvements:
            lines.append(f"- {t.task_id}: failed before, now passes")
    if report.regressions:
        lines += ["", "## Regressions", ""]
        for t in report.regressions:
            lines.append(f"- {t.task_id}: passed before, now fails")
    if report.new_tasks:
        lines += ["", "## New tasks in current version", ""]
        for tid in report.new_tasks:
            lines.append(f"- {tid}")

    lines += ["", "## Recommendations", ""]
    if report.overall_v3 >= report.overall_v2:
        lines.append(
            "- Overall pass rate held or improved. "
            "Safe to ship pending regression review."
        )
    else:
        lines.append(
            "- Overall pass rate dropped. Investigate each regression before release."
        )

    return "\n".join(lines) + "\n"
