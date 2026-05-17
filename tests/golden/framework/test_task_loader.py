"""Tests for the YAML task loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from .task_loader import (
    by_category,
    by_model_tier,
    by_tag,
    load_all_tasks,
    load_task,
)
from .models import GoldenTask


def _write_yaml(tmp_path: Path, name: str, body: str) -> Path:
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return p


def test_load_task_minimal(tmp_path: Path) -> None:
    path = _write_yaml(
        tmp_path,
        "min.yaml",
        """
id: x-1
name: X
category: multi-file-edit
description: do the thing
initial_state: snapshots/x-1
""",
    )
    task = load_task(path)
    assert isinstance(task, GoldenTask)
    assert task.id == "x-1"
    assert task.max_iterations == 20
    assert task.timeout_seconds == 300
    assert task.model_tier == "any"
    assert task.tags == []
    assert task.success_criteria == []


def test_load_task_full(tmp_path: Path) -> None:
    path = _write_yaml(
        tmp_path,
        "full.yaml",
        """
id: x-2
name: X Two
category: bug-fix
description: fix the thing
initial_state: snapshots/x-2
expected_files_changed:
  - src/a.ts
success_criteria:
  - type: file_contains
    target: src/a.ts
    pattern: foo
    description: has foo
max_iterations: 10
timeout_seconds: 120
model_tier: e4b
tags: [fast, typescript]
""",
    )
    task = load_task(path)
    assert task.model_tier == "e4b"
    assert task.tags == ["fast", "typescript"]
    assert task.max_iterations == 10
    assert len(task.success_criteria) == 1
    assert task.success_criteria[0].pattern == "foo"


def test_load_task_missing_required(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, "bad.yaml", "id: x\nname: x\n")
    with pytest.raises(ValueError, match="missing required fields"):
        load_task(path)


def test_load_all_tasks(tmp_path: Path) -> None:
    _write_yaml(
        tmp_path,
        "a.yaml",
        "id: a\nname: a\ncategory: bug-fix\ndescription: x\ninitial_state: s/a\n",
    )
    _write_yaml(
        tmp_path,
        "b.yml",
        "id: b\nname: b\ncategory: refactor\ndescription: x\ninitial_state: s/b\n",
    )
    _write_yaml(
        tmp_path,
        "_template.yaml",  # starts with underscore — should be skipped
        "id: ignore\nname: _\ncategory: x\ndescription: x\ninitial_state: x\n",
    )
    tasks = load_all_tasks(tmp_path)
    ids = {t.id for t in tasks}
    assert ids == {"a", "b"}


def test_filter_helpers(tmp_path: Path) -> None:
    t_a = GoldenTask(
        id="a",
        name="a",
        category="bug-fix",
        description="x",
        initial_state="s",
        expected_files_changed=[],
        success_criteria=[],
        model_tier="e2b",
        tags=["fast"],
    )
    t_b = GoldenTask(
        id="b",
        name="b",
        category="refactor",
        description="x",
        initial_state="s",
        expected_files_changed=[],
        success_criteria=[],
        model_tier="any",
        tags=["slow"],
    )
    t_c = GoldenTask(
        id="c",
        name="c",
        category="bug-fix",
        description="x",
        initial_state="s",
        expected_files_changed=[],
        success_criteria=[],
        model_tier="e4b",
        tags=["fast", "python"],
    )
    tasks = [t_a, t_b, t_c]
    assert [t.id for t in by_category(tasks, "bug-fix")] == ["a", "c"]
    # tier "e2b" should match both e2b and any
    assert {t.id for t in by_model_tier(tasks, "e2b")} == {"a", "b"}
    assert [t.id for t in by_tag(tasks, "python")] == ["c"]


def test_load_all_tasks_missing_dir(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_all_tasks(tmp_path / "nope")
