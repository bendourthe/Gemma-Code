"""Detect regressions against a stored baseline."""

from __future__ import annotations

from dataclasses import dataclass

from .types import TaskResult


@dataclass
class Regression:
    task_id: str
    # one of: pass_fail, time_ms, tokens, iterations, pass_rate
    metric: str
    baseline_value: float
    current_value: float
    severity: str            # "warn" or "error"
    description: str = ""


DEFAULT_THRESHOLDS: dict[str, float] = {
    "time_increase_factor": 1.5,       # 50% slower
    "tokens_increase_factor": 1.3,     # 30% more tokens
    "iterations_increase_factor": 1.5,  # 50% more iterations
    "pass_rate_drop": 0.05,            # 5 percentage points drop
}


def detect_regressions(
    current: list[TaskResult],
    baseline: dict,
    thresholds: dict[str, float] | None = None,
) -> list[Regression]:
    """Compare ``current`` TaskResults against a saved ``baseline`` dict.

    Returns a flat list of Regression objects. Empty list means no regressions.
    """
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    regressions: list[Regression] = []
    base_tasks: dict[str, dict] = baseline.get("tasks", {}) or {}

    for r in current:
        prior = base_tasks.get(r.task_id)
        if not prior:
            continue

        # Pass/fail flip
        if prior.get("passed") and not r.success:
            regressions.append(
                Regression(
                    task_id=r.task_id,
                    metric="pass_fail",
                    baseline_value=1.0,
                    current_value=0.0,
                    severity="error",
                    description="task regressed from pass to fail",
                )
            )

        # Time regression
        base_time = float(prior.get("time_ms", 0.0) or 0.0)
        if base_time > 0 and r.time_elapsed_ms > base_time * t["time_increase_factor"]:
            regressions.append(
                Regression(
                    task_id=r.task_id,
                    metric="time_ms",
                    baseline_value=base_time,
                    current_value=r.time_elapsed_ms,
                    severity="warn",
                    description=(
                        f"time increased {r.time_elapsed_ms / base_time:.1f}x"
                    ),
                )
            )

        # Tokens regression
        base_tokens = float(prior.get("tokens", 0) or 0)
        token_threshold = base_tokens * t["tokens_increase_factor"]
        if base_tokens > 0 and r.tokens_consumed > token_threshold:
            regressions.append(
                Regression(
                    task_id=r.task_id,
                    metric="tokens",
                    baseline_value=base_tokens,
                    current_value=r.tokens_consumed,
                    severity="warn",
                    description=(
                        f"tokens increased {r.tokens_consumed / base_tokens:.1f}x"
                    ),
                )
            )

        # Iterations regression
        base_iter = float(prior.get("iterations", 0) or 0)
        iter_threshold = base_iter * t["iterations_increase_factor"]
        if base_iter > 0 and r.iterations_used > iter_threshold:
            regressions.append(
                Regression(
                    task_id=r.task_id,
                    metric="iterations",
                    baseline_value=base_iter,
                    current_value=r.iterations_used,
                    severity="warn",
                    description=(
                        f"iterations increased {r.iterations_used / base_iter:.1f}x"
                    ),
                )
            )

    # Overall pass-rate drop
    agg = baseline.get("aggregates") or {}
    base_rate = float(agg.get("pass_rate", 0.0) or 0.0)
    if current:
        current_rate = sum(1 for r in current if r.success) / len(current)
        if base_rate - current_rate > t["pass_rate_drop"]:
            regressions.append(
                Regression(
                    task_id="_overall",
                    metric="pass_rate",
                    baseline_value=base_rate,
                    current_value=current_rate,
                    severity="error",
                    description=(
                        f"overall pass rate dropped "
                        f"{(base_rate - current_rate) * 100:.1f} pts"
                    ),
                )
            )

    return regressions


def generate_regression_report(regressions: list[Regression]) -> str:
    """Render regressions as a Markdown report."""
    if not regressions:
        return "# Regression Report\n\nNo regressions detected.\n"

    lines = [
        "# Regression Report",
        "",
        f"Detected **{len(regressions)}** regression(s).",
        "",
        "| Severity | Task | Metric | Baseline | Current | Notes |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in regressions:
        lines.append(
            f"| {r.severity} | {r.task_id} | {r.metric} | "
            f"{r.baseline_value:.2f} | {r.current_value:.2f} | {r.description} |"
        )
    lines.append("")
    return "\n".join(lines)
