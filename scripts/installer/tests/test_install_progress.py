"""Weighted installer progress accounting tests."""

from __future__ import annotations

import pytest

from nexus_installer.engine.install_progress import (
    WeightedInstallProgress,
    planned_steps,
)


def test_plan_includes_post_component_and_optional_steps() -> None:
    assert planned_steps(["model", "desktop"], include_unsloth=True) == (
        "model",
        "desktop",
        "runtime",
        "hub-catalog",
        "unsloth",
    )


def test_weighted_progress_does_not_reach_one_before_post_steps() -> None:
    ledger = WeightedInstallProgress(
        planned_steps(["model", "desktop"], include_unsloth=True)
    )
    ledger.complete("model")
    after_desktop = ledger.complete("desktop")
    assert 0.0 < after_desktop < 1.0
    ledger.complete("runtime")
    ledger.complete("hub-catalog")
    assert ledger.complete("unsloth") == pytest.approx(1.0)


def test_progress_is_monotonic_and_ignores_unknown_steps() -> None:
    ledger = WeightedInstallProgress(("model", "runtime"))
    first = ledger.update("model", 0.8)
    assert ledger.update("model", 0.2) == first
    assert ledger.update("unknown", 1.0) == first
    assert ledger.update("model", float("nan")) == first
