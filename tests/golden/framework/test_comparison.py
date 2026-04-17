"""Tests for the version-comparison utility."""

from __future__ import annotations

from .comparison import compare_versions, generate_comparison_markdown


def _baseline(
    version: str,
    tasks: dict[str, dict],
    pass_rate: float,
    categories: dict[str, dict] | None = None,
    total_tokens: int = 0,
) -> dict:
    return {
        "version": version,
        "tasks": tasks,
        "aggregates": {
            "pass_rate": pass_rate,
            "total_tokens": total_tokens,
            "by_category": categories or {},
        },
    }


def test_compare_overall_metrics() -> None:
    v2 = _baseline("0.2.0", {}, 0.8, total_tokens=1000)
    v3 = _baseline("0.3.0", {}, 0.9, total_tokens=900)
    report = compare_versions(v2, v3)
    assert report.baseline_version == "0.2.0"
    assert report.current_version == "0.3.0"
    assert report.overall_v2 == 0.8
    assert report.overall_v3 == 0.9
    assert report.tokens_v2 == 1000
    assert report.tokens_v3 == 900


def test_improvements_and_regressions() -> None:
    v2 = _baseline(
        "0.2.0",
        {
            "t-1": {"passed": False, "time_ms": 100},
            "t-2": {"passed": True, "time_ms": 100},
            "t-3": {"passed": True, "time_ms": 100},
        },
        pass_rate=2 / 3,
    )
    v3 = _baseline(
        "0.3.0",
        {
            "t-1": {"passed": True, "time_ms": 80},
            "t-2": {"passed": False, "time_ms": 120},
            "t-3": {"passed": True, "time_ms": 100},
            "t-4": {"passed": True, "time_ms": 50},  # new task
        },
        pass_rate=3 / 4,
    )
    report = compare_versions(v2, v3)
    imp_ids = [t.task_id for t in report.improvements]
    reg_ids = [t.task_id for t in report.regressions]
    assert imp_ids == ["t-1"]
    assert reg_ids == ["t-2"]
    assert report.new_tasks == ["t-4"]


def test_markdown_contains_sections() -> None:
    v2 = _baseline(
        "0.2.0",
        {"t-1": {"passed": True, "time_ms": 100}},
        pass_rate=1.0,
        categories={"multi": {"pass_rate": 1.0, "mean_time_ms": 100}},
    )
    v3 = _baseline(
        "0.3.0",
        {
            "t-1": {"passed": False, "time_ms": 100},
            "t-2": {"passed": True, "time_ms": 80},
        },
        pass_rate=0.5,
        categories={"multi": {"pass_rate": 0.5, "mean_time_ms": 90}},
    )
    report = compare_versions(v2, v3)
    md = generate_comparison_markdown(report)
    assert "0.2.0 vs 0.3.0" in md
    assert "Executive summary" in md
    assert "Per-category breakdown" in md
    assert "Regressions" in md
    assert "t-1" in md


def test_markdown_clean_baseline() -> None:
    v2 = _baseline("0.2.0", {}, 0.9)
    v3 = _baseline("0.3.0", {}, 0.95)
    md = generate_comparison_markdown(compare_versions(v2, v3))
    assert "held or improved" in md
