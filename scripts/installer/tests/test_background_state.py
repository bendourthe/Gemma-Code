"""v1.11.0 Phase 7 (T701/T705) -- persistent install-state round-trip + log."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from nexus_installer.background import paths, state_store
from nexus_installer.background.state_store import (
    SCHEMA,
    STATUS_RUNNING,
    STEP_DONE,
    InstallState,
    ModelState,
)


class TestModelState:
    def test_round_trip(self) -> None:
        model = ModelState(
            model_id="nomic-embed-text",
            status=STEP_DONE,
            fraction=1.0,
            bytes_done=200,
            bytes_total=200,
        )
        assert ModelState.from_dict(model.to_dict()) == model

    def test_from_dict_tolerates_missing_keys(self) -> None:
        model = ModelState.from_dict({"model_id": "x"})
        assert model.model_id == "x"
        assert model.fraction == 0.0


class TestInstallStateRoundTrip:
    def test_save_then_load_is_lossless(self, tmp_path: Path) -> None:
        state = InstallState(
            status=STATUS_RUNNING,
            pid=4321,
            overall_progress=0.42,
            components=["ollama", "model"],
            steps={"ollama": STEP_DONE, "model": "running"},
            models={"m1": ModelState(model_id="m1", fraction=0.5, bytes_done=50)},
            failed_steps=["desktop"],
            failed_models=["m2"],
            optional_failed_steps=["unsloth"],
            step_failures=[{"step": "desktop", "summary": "s", "suggestion": "a"}],
            step_results=[{"step": "desktop", "status": "failed"}],
            results={"desktop_installed": True},
        )
        target = tmp_path / "state.json"
        state_store.save_state(target, state)
        loaded = state_store.load_state(target)
        assert loaded is not None
        assert loaded.schema == SCHEMA
        assert loaded.pid == 4321
        assert loaded.overall_progress == pytest.approx(0.42)
        assert loaded.components == ["ollama", "model"]
        assert loaded.steps == {"ollama": STEP_DONE, "model": "running"}
        assert loaded.models["m1"].fraction == pytest.approx(0.5)
        assert loaded.failed_steps == ["desktop"]
        assert loaded.optional_failed_steps == ["unsloth"]
        assert loaded.step_results == [{"step": "desktop", "status": "failed"}]
        assert loaded.results == {"desktop_installed": True}

    def test_save_stamps_updated_at(self, tmp_path: Path) -> None:
        state = InstallState()
        assert state.updated_at == ""
        state_store.save_state(tmp_path / "s.json", state)
        assert state.updated_at != ""

    def test_save_is_atomic_no_temp_left(self, tmp_path: Path) -> None:
        state_store.save_state(tmp_path / "s.json", InstallState())
        leftovers = [p.name for p in tmp_path.iterdir() if p.name != "s.json"]
        assert leftovers == []


class TestLoadEdgeCases:
    def test_missing_file_returns_none(self, tmp_path: Path) -> None:
        assert state_store.load_state(tmp_path / "nope.json") is None

    def test_malformed_json_returns_none(self, tmp_path: Path) -> None:
        target = tmp_path / "bad.json"
        target.write_text("{not json", encoding="utf-8")
        assert state_store.load_state(target) is None

    def test_non_object_json_returns_none(self, tmp_path: Path) -> None:
        target = tmp_path / "arr.json"
        target.write_text("[1, 2, 3]", encoding="utf-8")
        assert state_store.load_state(target) is None


class TestRollingLog:
    def test_append_and_read(self, tmp_path: Path) -> None:
        log = tmp_path / "install.log"
        state_store.append_log(log, "[INFO] one")
        state_store.append_log(log, "[WARN] two\n")
        assert state_store.read_log_lines(log) == ["[INFO] one", "[WARN] two"]

    def test_read_absent_log_is_empty(self, tmp_path: Path) -> None:
        assert state_store.read_log_lines(tmp_path / "absent.log") == []

    def test_log_rolls_when_oversized(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(state_store, "_MAX_LOG_BYTES", 200)
        log = tmp_path / "install.log"
        for i in range(200):
            state_store.append_log(log, f"[INFO] line {i}")
        assert log.stat().st_size <= 200
        lines = state_store.read_log_lines(log)
        # The tail is kept and the newest line survives; no truncated head line.
        assert lines
        assert lines[-1] == "[INFO] line 199"


class TestStateDir:
    def test_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(paths.STATE_DIR_ENV, os.path.join("X", "custom"))
        assert paths.state_dir() == Path(os.path.join("X", "custom"))
        assert paths.state_file().name == "state.json"
        assert paths.log_file().name == "install.log"

    def test_ensure_creates_dir(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(paths.STATE_DIR_ENV, str(tmp_path / "made"))
        created = paths.ensure_state_dir()
        assert created.is_dir()
