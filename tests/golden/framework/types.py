"""Typed data model for golden tasks."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SuccessCriteria:
    """A single pass/fail criterion for a golden task.

    type: One of "file_contains", "file_exists", "file_deleted",
          "test_passes", "lint_passes", "diff_matches",
          "output_contains", "no_errors".
    target: File path (for file_*) or command (for *_passes, output_contains).
    pattern: Regex or literal string to match (for file_contains, output_contains,
             diff_matches). Ignored for file_exists/file_deleted.
    description: Human-readable description.
    """

    type: str
    target: str
    pattern: str = ""
    description: str = ""


@dataclass
class GoldenTask:
    """Declarative definition of a golden evaluation task.

    Loaded from YAML via framework.task_loader.load_task.
    """

    id: str
    name: str
    category: str
    description: str
    initial_state: str
    expected_files_changed: list[str]
    success_criteria: list[SuccessCriteria]
    max_iterations: int = 20
    timeout_seconds: int = 300
    model_tier: str = "any"
    tags: list[str] = field(default_factory=list)


@dataclass
class TaskResult:
    """Outcome of running a golden task."""

    task_id: str
    success: bool
    criteria_results: list[tuple[SuccessCriteria, bool, str]] = field(
        default_factory=list
    )
    iterations_used: int = 0
    time_elapsed_ms: float = 0.0
    tokens_consumed: int = 0
    model_used: str = ""
    error: str | None = None
    agent_trace: list[dict] = field(default_factory=list)
