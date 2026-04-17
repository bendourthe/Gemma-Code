"""Pytest fixtures for the golden task suite."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

TESTS_GOLDEN = Path(__file__).resolve().parent


@pytest.fixture(scope="session")
def golden_root() -> Path:
    """Path to tests/golden/ — the framework's root directory."""
    return TESTS_GOLDEN


@pytest.fixture(scope="session")
def tasks_dir(golden_root: Path) -> Path:
    return golden_root / "tasks"


@pytest.fixture(scope="session")
def snapshots_dir(golden_root: Path) -> Path:
    return golden_root / "snapshots"


@pytest.fixture(scope="session")
def baselines_dir(golden_root: Path) -> Path:
    return golden_root / "baselines"


@pytest.fixture
def tmp_worktree_root(tmp_path: Path) -> Path:
    d = tmp_path / "worktrees"
    d.mkdir(parents=True, exist_ok=True)
    return d


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip live-only tests when OLLAMA_URL isn't set, with a clean reason."""
    has_ollama = bool(os.environ.get("OLLAMA_URL"))
    marker = pytest.mark.skip(reason="Live Ollama required (set OLLAMA_URL)")
    for item in items:
        if "live_ollama" in item.keywords and not has_ollama:
            item.add_marker(marker)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "live_ollama: requires a running Ollama server at OLLAMA_URL",
    )
