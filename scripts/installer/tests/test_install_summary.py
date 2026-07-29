"""v1.15.0 Phase 3 (Issue 2) -- post-install summary + model-only retry."""

from __future__ import annotations

import pytest

from nexus_installer.engine.install_summary import (
    humanize_reason,
    prepare_model_retry,
    summarize_install,
)
from nexus_installer.installer_state import InstallerState


class TestHumanizeReason:
    @pytest.mark.parametrize(
        ("raw", "needle"),
        [
            ("", "did not complete"),
            ("   ", "did not complete"),
            ("Error: 400:", "rejected"),
            ("Client error '401 Unauthorized'", "gated"),
            ("403 Forbidden", "gated"),
            ("HTTP 404 not found", "could not be found"),
            ("Connection timed out", "network"),
            ("temporarily unavailable", "network"),
        ],
    )
    def test_maps_known_reasons(self, raw: str, needle: str) -> None:
        assert needle in humanize_reason(raw).lower()

    def test_unknown_reason_passes_through(self) -> None:
        assert humanize_reason("disk is full") == "disk is full"


class TestSummarizeInstall:
    def test_categorizes_succeeded_failed_skipped(self) -> None:
        # a succeeded, b failed, c was gated-declined (already off the selection).
        state = InstallerState()
        state.selected_model_ids = ["a", "b"]
        state.failed_models = ["b"]
        state.model_failures = {"b": "Error: 400:"}
        state.gated_skipped = ["c"]
        catalog = {"a": {"displayName": "Model A"}, "b": {"displayName": "Model B"}}

        summary = summarize_install(state, catalog)

        assert [o.model_id for o in summary.succeeded] == ["a"]
        assert [o.model_id for o in summary.failed] == ["b"]
        assert "rejected" in summary.failed[0].reason.lower()
        assert [o.model_id for o in summary.skipped] == ["c"]
        assert summary.retryable_ids == ["b"]
        assert summary.has_failures is True

    def test_display_name_falls_back_to_id(self) -> None:
        state = InstallerState()
        state.selected_model_ids = ["only-id"]
        summary = summarize_install(state, catalog=None)
        assert summary.succeeded[0].display_name == "only-id"

    def test_clean_run_has_no_failures_or_retry(self) -> None:
        state = InstallerState()
        state.selected_model_ids = ["a"]
        summary = summarize_install(state, {"a": {"displayName": "A"}})
        assert summary.failed == []
        assert summary.skipped == []
        assert summary.retryable_ids == []
        assert summary.has_failures is False


class TestPrepareModelRetry:
    def test_narrows_selection_and_marks_other_steps_done(self) -> None:
        state = InstallerState()
        state.components_to_install = [
            "extension",
            "ollama",
            "venv",
            "model",
            "desktop",
        ]
        state.selected_model_ids = ["a", "b"]
        state.failed_models = ["b"]
        state.failed_steps = ["model"]
        state.model_failures = {"b": "Error: 400:"}

        retry_ids = prepare_model_retry(state)

        assert retry_ids == ["b"]
        assert state.selected_model_ids == ["b"]
        # Only the model step should be pending on the re-run.
        assert "model" not in state.completed_steps
        assert {"extension", "ollama", "venv", "desktop"} <= set(state.completed_steps)
        # Prior failure bookkeeping is cleared for a clean re-run.
        assert state.failed_models == []
        assert "model" not in state.failed_steps
        assert "b" not in state.model_failures

    def test_noop_when_nothing_failed(self) -> None:
        state = InstallerState()
        state.selected_model_ids = ["a"]
        state.failed_models = []

        assert prepare_model_retry(state) == []
        assert state.selected_model_ids == ["a"]  # unchanged
        assert state.completed_steps == []
