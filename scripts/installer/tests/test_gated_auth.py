"""v1.14.0 Phase 2 -- gated-model auth coordination (no Qt)."""

from __future__ import annotations

from pathlib import Path

import pytest

from nexus_installer.engine.gated_auth import (
    ensure_gated_auth,
    pending_gated_ids,
)
from nexus_installer.installer_state import InstallerState

_CATALOG = {
    "pub": {"gated": False},
    "gated-a": {"gated": True, "source": {"repo": "org/a"}},
    "gated-b": {"gated": True, "source": {"repo": "org/b"}},
}


@pytest.fixture(autouse=True)
def _isolate_hf_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """No ambient token: state.hf_token alone drives discovery in these tests."""
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGING_FACE_HUB_TOKEN", raising=False)
    monkeypatch.delenv("HF_TOKEN_PATH", raising=False)
    monkeypatch.setenv("HF_HOME", str(tmp_path))


class TestPendingGatedIds:
    def test_empty_when_token_present(self) -> None:
        state = InstallerState(selected_model_ids=["pub", "gated-a"], hf_token="tok")
        assert pending_gated_ids(state, _CATALOG) == []

    def test_lists_gated_without_token(self) -> None:
        state = InstallerState(selected_model_ids=["pub", "gated-a", "gated-b"])
        assert pending_gated_ids(state, _CATALOG) == ["gated-a", "gated-b"]

    def test_empty_when_no_gated_selected(self) -> None:
        state = InstallerState(selected_model_ids=["pub"])
        assert pending_gated_ids(state, _CATALOG) == []


class TestEnsureGatedAuth:
    def test_no_prompt_when_token_present(self) -> None:
        state = InstallerState(selected_model_ids=["gated-a"], hf_token="pre")

        def prompt(_entry: dict) -> str | None:
            raise AssertionError("prompt must not be called when a token exists")

        outcome = ensure_gated_auth(state, _CATALOG, prompt)
        assert outcome.unlocked == [] and outcome.skipped == []
        assert state.selected_model_ids == ["gated-a"]

    def test_decline_deselects_and_records(self) -> None:
        state = InstallerState(selected_model_ids=["pub", "gated-a"])
        outcome = ensure_gated_auth(state, _CATALOG, lambda _e: None)
        assert outcome.skipped == ["gated-a"]
        assert state.selected_model_ids == ["pub"]
        assert "gated-a" in state.skipped_steps

    def test_token_unlocks_and_covers_rest(self) -> None:
        state = InstallerState(selected_model_ids=["gated-a", "gated-b"])
        calls: list[str] = []

        def prompt(entry: dict) -> str | None:
            calls.append(entry["source"]["repo"])
            return "entered-tok"

        outcome = ensure_gated_auth(state, _CATALOG, prompt)
        # One prompt: the entered token covers the second gated model too.
        assert len(calls) == 1
        assert outcome.unlocked == ["gated-a"]
        assert state.hf_token == "entered-tok"
        assert state.selected_model_ids == ["gated-a", "gated-b"]

    def test_ignores_non_gated(self) -> None:
        state = InstallerState(selected_model_ids=["pub"])
        outcome = ensure_gated_auth(
            state, _CATALOG, lambda _e: pytest.fail("no prompt for public models")
        )
        assert outcome.unlocked == [] and outcome.skipped == []
