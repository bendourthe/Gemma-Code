"""Evaluate a task run against its SuccessCriteria."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .models import SuccessCriteria, TaskResult


def _eval_file_exists(workdir: Path, criteria: SuccessCriteria) -> tuple[bool, str]:
    p = workdir / criteria.target
    return p.exists(), f"path {p}"


def _eval_file_deleted(workdir: Path, criteria: SuccessCriteria) -> tuple[bool, str]:
    p = workdir / criteria.target
    return (not p.exists()), f"path {p}"


def _eval_file_contains(workdir: Path, criteria: SuccessCriteria) -> tuple[bool, str]:
    p = workdir / criteria.target
    if not p.is_file():
        return False, f"file missing: {p}"
    content = p.read_text(encoding="utf-8", errors="replace")
    pattern = criteria.pattern or ""
    try:
        match = re.search(pattern, content, flags=re.MULTILINE)
    except re.error:
        match = pattern in content
    return bool(match), f"pattern {pattern!r} in {p.name}"


def _eval_output_contains(workdir: Path, criteria: SuccessCriteria) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            criteria.target,
            cwd=workdir,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        return False, "command timed out"
    combined = (result.stdout or "") + (result.stderr or "")
    pattern = criteria.pattern or ""
    try:
        match = bool(re.search(pattern, combined, flags=re.MULTILINE))
    except re.error:
        match = pattern in combined
    return match, f"command exit={result.returncode}"


def _eval_command(
    workdir: Path, criteria: SuccessCriteria, expect_success: bool
) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            criteria.target,
            cwd=workdir,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        return False, "command timed out"
    success = (result.returncode == 0) if expect_success else True
    detail = f"exit={result.returncode}"
    return success, detail


_HANDLERS = {
    "file_exists": _eval_file_exists,
    "file_deleted": _eval_file_deleted,
    "file_contains": _eval_file_contains,
    "output_contains": _eval_output_contains,
}


def evaluate(
    workdir: str | Path,
    criteria_list: list[SuccessCriteria],
) -> list[tuple[SuccessCriteria, bool, str]]:
    """Run each criterion against the given working directory."""
    wd = Path(workdir)
    out: list[tuple[SuccessCriteria, bool, str]] = []
    for c in criteria_list:
        handler = _HANDLERS.get(c.type)
        if handler is not None:
            passed, detail = handler(wd, c)
        elif c.type in ("test_passes", "lint_passes", "no_errors"):
            passed, detail = _eval_command(wd, c, expect_success=True)
        elif c.type == "diff_matches":
            # Diff matching is approximate: run git diff and regex-match.
            passed, detail = _eval_output_contains(
                wd,
                SuccessCriteria(
                    type="output_contains",
                    target="git diff",
                    pattern=c.pattern,
                ),
            )
        else:
            passed, detail = False, f"unknown criteria type: {c.type}"
        out.append((c, passed, detail))
    return out


def all_passed(results: list[tuple[SuccessCriteria, bool, str]]) -> bool:
    return all(ok for _, ok, _ in results)


def result_from(
    task_id: str,
    workdir: str | Path,
    criteria_list: list[SuccessCriteria],
    **kwargs: object,
) -> TaskResult:
    """Convenience factory that runs evaluation and returns a TaskResult."""
    criteria_results = evaluate(workdir, criteria_list)
    return TaskResult(
        task_id=task_id,
        success=all_passed(criteria_results),
        criteria_results=criteria_results,
        iterations_used=int(kwargs.get("iterations_used", 0) or 0),
        time_elapsed_ms=float(kwargs.get("time_elapsed_ms", 0.0) or 0.0),
        tokens_consumed=int(kwargs.get("tokens_consumed", 0) or 0),
        model_used=str(kwargs.get("model_used", "") or ""),
        error=kwargs.get("error"),  # type: ignore[arg-type]
        agent_trace=list(kwargs.get("agent_trace", []) or []),  # type: ignore[arg-type]
    )
