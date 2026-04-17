"""Tests for regression detection."""

from __future__ import annotations

from .regression import detect_regressions, generate_regression_report
from .types import TaskResult


def _baseline(tasks: dict[str, dict], pass_rate: float) -> dict:
    return {
        "version": "0.3.0",
        "model": "gemma4:e4b",
        "tasks": tasks,
        "aggregates": {"pass_rate": pass_rate},
    }


def _result(
    task_id: str,
    *,
    success: bool = True,
    time_ms: float = 100.0,
    tokens: int = 100,
    iterations: int = 5,
) -> TaskResult:
    return TaskResult(
        task_id=task_id,
        success=success,
        iterations_used=iterations,
        time_elapsed_ms=time_ms,
        tokens_consumed=tokens,
    )


def test_no_regressions_when_equal() -> None:
    baseline = _baseline(
        {"t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5}},
        pass_rate=1.0,
    )
    current = [_result("t-1")]
    regs = detect_regressions(current, baseline)
    assert regs == []


def test_pass_to_fail_is_error() -> None:
    baseline = _baseline(
        {"t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5}},
        pass_rate=1.0,
    )
    current = [_result("t-1", success=False)]
    regs = detect_regressions(current, baseline)
    metrics = {r.metric for r in regs}
    assert "pass_fail" in metrics
    assert any(r.severity == "error" for r in regs)


def test_time_regression() -> None:
    baseline = _baseline(
        {"t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5}},
        pass_rate=1.0,
    )
    current = [_result("t-1", time_ms=200.0)]  # 2x => well above 1.5x threshold
    regs = detect_regressions(current, baseline)
    assert any(r.metric == "time_ms" for r in regs)


def test_token_regression() -> None:
    baseline = _baseline(
        {"t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5}},
        pass_rate=1.0,
    )
    current = [_result("t-1", tokens=200)]  # 2x => above 1.3x
    regs = detect_regressions(current, baseline)
    assert any(r.metric == "tokens" for r in regs)


def test_iterations_regression() -> None:
    baseline = _baseline(
        {"t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 4}},
        pass_rate=1.0,
    )
    current = [_result("t-1", iterations=8)]  # 2x => above 1.5x
    regs = detect_regressions(current, baseline)
    assert any(r.metric == "iterations" for r in regs)


def test_pass_rate_drop() -> None:
    baseline = _baseline(
        {
            "t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5},
            "t-2": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5},
        },
        pass_rate=1.0,
    )
    current = [_result("t-1", success=False), _result("t-2")]
    regs = detect_regressions(current, baseline)
    overall = [r for r in regs if r.task_id == "_overall"]
    assert overall and overall[0].metric == "pass_rate"


def test_unknown_task_skipped() -> None:
    baseline = _baseline({}, pass_rate=0.0)
    regs = detect_regressions([_result("t-new")], baseline)
    assert regs == []


def test_report_when_clean() -> None:
    md = generate_regression_report([])
    assert "No regressions" in md


def test_report_contains_rows() -> None:
    baseline = _baseline(
        {"t-1": {"passed": True, "time_ms": 100, "tokens": 100, "iterations": 5}},
        pass_rate=1.0,
    )
    regs = detect_regressions([_result("t-1", success=False)], baseline)
    md = generate_regression_report(regs)
    assert "t-1" in md
    assert "pass_fail" in md
