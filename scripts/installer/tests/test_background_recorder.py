"""v1.11.0 Phase 7 (T701/T705) -- StateRecorder persistence + bridges."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from nexus_installer.background import state_store
from nexus_installer.background.recorder import (
    StateRecorder,
    apply_resume_to_installer_state,
    apply_state_to_installer_state,
    snapshot_results,
)
from nexus_installer.background.resume import ResumePlan
from nexus_installer.background.state_store import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    STEP_DONE,
    STEP_FAILED,
    STEP_RUNNING,
    InstallState,
)
from nexus_installer.installer_state import InstallerState


def _recorder(tmp_path: Path) -> StateRecorder:
    return StateRecorder(str(tmp_path / "state.json"), str(tmp_path / "install.log"))


def _load(tmp_path: Path) -> InstallState:
    loaded = state_store.load_state(tmp_path / "state.json")
    assert loaded is not None
    return loaded


class TestBegin:
    def test_begin_seeds_running_state(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        state = InstallerState(components_to_install=["ollama", "model"])
        rec.begin(state, ["m1", "m2"])
        loaded = _load(tmp_path)
        assert loaded.status == STATUS_RUNNING
        assert loaded.pid > 0
        assert loaded.components == ["ollama", "model"]
        assert set(loaded.models) == {"m1", "m2"}
        assert loaded.steps["ollama"] == "pending"


class TestSignalHandlers:
    def test_step_transitions_persist(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["ollama"]), [])
        rec.on_step_started("ollama")
        assert _load(tmp_path).steps["ollama"] == STEP_RUNNING
        rec.on_step_completed("ollama")
        assert _load(tmp_path).steps["ollama"] == STEP_DONE

    def test_step_failure_recorded(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["desktop"]), [])
        rec.on_step_failed("desktop")
        loaded = _load(tmp_path)
        assert loaded.steps["desktop"] == STEP_FAILED
        assert "desktop" in loaded.failed_steps

    def test_model_events_persist(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["model"]), ["m1"])
        rec.on_model_started("m1")
        sample = SimpleNamespace(
            model_id="m1", fraction=0.5, bytes_done=50, bytes_total=100
        )
        rec.on_model_progress(sample)
        rec.on_step_started("model")  # force a write past the throttle
        loaded = _load(tmp_path)
        assert loaded.models["m1"].fraction == pytest.approx(0.5)
        rec.on_model_completed("m1")
        assert _load(tmp_path).models["m1"].status == STEP_DONE

    def test_model_failure_recorded(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["model"]), ["m1"])
        rec.on_model_failed("m1", "401 Unauthorized")
        loaded = _load(tmp_path)
        assert loaded.models["m1"].status == STEP_FAILED
        assert loaded.models["m1"].reason == "401 Unauthorized"
        assert "m1" in loaded.failed_models

    def test_progress_is_throttled_but_forced_writes_flush(
        self, tmp_path: Path
    ) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["ollama"]), [])
        # begin() just forced a write, so this tick is inside the throttle
        # window and must not reach disk yet...
        rec.on_progress(0.3)
        assert _load(tmp_path).overall_progress == pytest.approx(0.0)
        # ...but the next forced transition flushes the accumulated progress.
        rec.on_step_started("ollama")
        assert _load(tmp_path).overall_progress == pytest.approx(0.3)


class TestFinishStatus:
    def test_success_completed(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["ollama"]), [])
        rec.on_finished(True, "")
        assert _load(tmp_path).status == STATUS_COMPLETED

    def test_failure_failed(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["ollama"]), [])
        rec.on_finished(False, "ollama failed")
        loaded = _load(tmp_path)
        assert loaded.status == STATUS_FAILED
        assert loaded.error_message == "ollama failed"

    def test_cancel_wins_over_failure(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["ollama"]), [])
        rec.mark_cancelled()
        assert _load(tmp_path).status == STATUS_CANCELLED
        # A later engine finish (reported as failure) stays cancelled.
        rec.on_finished(False, "cancelled mid-step")
        assert _load(tmp_path).status == STATUS_CANCELLED

    def test_engine_exception_redacts_hf_token(self, tmp_path: Path) -> None:
        token = "hf_secret_token_xyz"
        rec = _recorder(tmp_path)
        rec.begin(InstallerState(hf_token=token, components_to_install=["model"]), [])
        rec.on_finished(False, f"Engine exception: RuntimeError: pull exploded {token}")
        loaded = _load(tmp_path)
        assert loaded.status == STATUS_FAILED
        assert "Engine exception" in loaded.error_message
        assert token not in loaded.error_message
        raw = (tmp_path / "state.json").read_text(encoding="utf-8")
        assert token not in raw
        log = (tmp_path / "install.log").read_text(encoding="utf-8")
        assert token not in log
        assert "Engine exception" in log

    def test_engine_crash_copies_failed_steps(self, tmp_path: Path) -> None:
        rec = _recorder(tmp_path)
        state = InstallerState(components_to_install=["model"])
        state.failed_steps.append("engine")
        state.record_step_failure(
            "engine",
            "The installer hit an unexpected error and stopped.",
            "Open the log on the Complete page, then retry the install.",
        )
        rec.begin(state, [])
        rec.on_finished(False, "Engine exception: RuntimeError: boom")
        loaded = _load(tmp_path)
        assert "engine" in loaded.failed_steps
        assert any(f.get("step") == "engine" for f in loaded.step_failures)


class TestAttachAndEmit:
    def test_engine_signals_reach_disk(self, tmp_path: Path) -> None:
        from nexus_installer.engine.installer import InstallEngine

        rec = _recorder(tmp_path)
        rec.begin(InstallerState(components_to_install=["ollama"]), [])
        engine = InstallEngine()
        rec.attach(engine)
        engine.step_started.emit("ollama")
        engine.step_completed.emit("ollama")
        engine.log_message.emit("hello", "info")
        loaded = _load(tmp_path)
        assert loaded.steps["ollama"] == STEP_DONE
        assert any(
            "hello" in line
            for line in state_store.read_log_lines(tmp_path / "install.log")
        )


class TestResultBridges:
    def test_snapshot_and_apply_round_trip(self, tmp_path: Path) -> None:
        source = InstallerState()
        source.desktop_installed = True
        source.desktop_health_ok = True
        source.ollama_installed = True
        rec = _recorder(tmp_path)
        rec.begin(source, [])
        rec.on_finished(True, "")
        loaded = _load(tmp_path)
        assert loaded.results["desktop_installed"] is True

        restored = InstallerState()
        restored.desktop_installed = False
        apply_state_to_installer_state(loaded, restored)
        assert restored.desktop_installed is True
        assert restored.ollama_installed is True

    def test_snapshot_results_only_result_fields(self) -> None:
        state = InstallerState()
        state.desktop_exe_path = "/x/nexus"
        snap = snapshot_results(state)
        assert snap["desktop_exe_path"] == "/x/nexus"
        assert "install_path" not in snap
        assert "hf_token" not in snap

    def test_apply_restores_failures_and_log(self, tmp_path: Path) -> None:
        log = tmp_path / "install.log"
        state_store.append_log(log, "[INFO] recorded line")
        install_state = InstallState(
            failed_steps=["desktop"],
            failed_models=["m1"],
            step_failures=[{"step": "desktop", "summary": "s", "suggestion": "a"}],
            log_path=str(log),
        )
        restored = InstallerState()
        apply_state_to_installer_state(install_state, restored)
        assert restored.failed_steps == ["desktop"]
        assert restored.failed_models == ["m1"]
        assert any("recorded line" in line for line in restored.install_log)

    def test_apply_resume_marks_completed_steps(self) -> None:
        install_state = InstallState(
            components=["ollama", "venv", "model"],
            models={"m1": state_store.ModelState(model_id="m1")},
        )
        plan = ResumePlan(completed_steps=["ollama", "venv"], remaining_steps=["model"])
        target = InstallerState()
        apply_resume_to_installer_state(install_state, plan, target)
        assert target.components_to_install == ["ollama", "venv", "model"]
        assert target.completed_steps == ["ollama", "venv"]
        assert target.selected_model_ids == ["m1"]
