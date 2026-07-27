"""v1.11.0 Phase 7 (T703/T704/T705) -- crash detection, resume, startup plan."""

from __future__ import annotations

import os
from pathlib import Path

from nexus_installer.background import resume as bg_resume
from nexus_installer.background.process import pid_alive
from nexus_installer.background.resume import (
    DECISION_FORWARD,
    DECISION_FRESH,
    DECISION_RESUME,
    DECISION_SHOW_COMPLETE,
    interpret_startup,
    reconcile_liveness,
    resume_plan,
)
from nexus_installer.background.startup import plan_startup
from nexus_installer.background.state_store import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_INTERRUPTED,
    STATUS_RUNNING,
    STEP_DONE,
    STEP_PENDING,
    STEP_SKIPPED,
    InstallState,
    clear_state,
    load_state,
    save_state,
)


class TestPidAlive:
    def test_current_process_is_alive(self) -> None:
        assert pid_alive(os.getpid()) is True

    def test_zero_and_negative_are_dead(self) -> None:
        assert pid_alive(0) is False
        assert pid_alive(-1) is False

    def test_absent_pid_is_dead(self) -> None:
        # A pid far above any real one on a normal machine.
        assert pid_alive(2_000_000_000) is False


class TestReconcileLiveness:
    def test_running_with_dead_pid_becomes_interrupted(self) -> None:
        state = InstallState(status=STATUS_RUNNING, pid=2_000_000_000)
        reconcile_liveness(state)
        assert state.status == STATUS_INTERRUPTED

    def test_running_with_live_pid_stays_running(self) -> None:
        state = InstallState(status=STATUS_RUNNING, pid=os.getpid())
        reconcile_liveness(state)
        assert state.status == STATUS_RUNNING

    def test_terminal_status_untouched(self) -> None:
        state = InstallState(status=STATUS_COMPLETED, pid=2_000_000_000)
        reconcile_liveness(state)
        assert state.status == STATUS_COMPLETED


class TestInterpretStartup:
    def test_live_primary_forwards(self) -> None:
        state = InstallState(status=STATUS_RUNNING)
        assert interpret_startup(state, primary_alive=True) == DECISION_FORWARD

    def test_no_state_is_fresh(self) -> None:
        assert interpret_startup(None, primary_alive=False) == DECISION_FRESH

    def test_completed_is_fresh_on_cold_launch(self) -> None:
        # v1.15.0 Phase 2 (Issue 1): a normally-completed run must NOT redirect
        # a later cold launch to the Complete page; it starts at Welcome.
        state = InstallState(status=STATUS_COMPLETED)
        got = interpret_startup(state, primary_alive=False)
        assert got == DECISION_FRESH

    def test_failed_is_fresh_on_cold_launch(self) -> None:
        state = InstallState(status=STATUS_FAILED)
        got = interpret_startup(state, primary_alive=False)
        assert got == DECISION_FRESH

    def test_cancelled_is_fresh(self) -> None:
        state = InstallState(status=STATUS_CANCELLED)
        assert interpret_startup(state, primary_alive=False) == DECISION_FRESH

    def test_interrupted_resumes(self) -> None:
        state = InstallState(status=STATUS_INTERRUPTED)
        assert interpret_startup(state, primary_alive=False) == DECISION_RESUME


class TestResumePlan:
    def test_partitions_done_from_remaining(self) -> None:
        state = InstallState(
            components=["ollama", "venv", "model", "desktop"],
            steps={
                "ollama": STEP_DONE,
                "venv": STEP_SKIPPED,
                "model": "running",
                "desktop": STEP_PENDING,
            },
        )
        plan = resume_plan(state)
        assert plan.completed_steps == ["ollama", "venv"]
        assert plan.remaining_steps == ["model", "desktop"]
        assert plan.is_complete is False

    def test_all_done_is_complete(self) -> None:
        state = InstallState(
            components=["ollama"], steps={"ollama": STEP_DONE}
        )
        assert resume_plan(state).is_complete is True


class TestPlanStartup:
    def test_forward_when_primary_alive(self) -> None:
        state = InstallState(status=STATUS_RUNNING)
        plan = plan_startup(loaded_state=state, primary_alive=True)
        assert plan.decision == DECISION_FORWARD

    def test_fresh_when_no_state(self) -> None:
        plan = plan_startup(loaded_state=None, primary_alive=False)
        assert plan.decision == DECISION_FRESH
        assert plan.resume is None

    def test_crashed_running_resumes_with_plan(self) -> None:
        # status running but the owning pid is gone -> crash -> resume.
        state = InstallState(
            status=STATUS_RUNNING,
            pid=2_000_000_000,
            components=["ollama", "model"],
            steps={"ollama": STEP_DONE, "model": STEP_PENDING},
        )
        plan = plan_startup(loaded_state=state, primary_alive=False)
        assert plan.decision == DECISION_RESUME
        assert plan.resume is not None
        assert plan.resume.completed_steps == ["ollama"]
        assert plan.resume.remaining_steps == ["model"]
        assert state.status == STATUS_INTERRUPTED  # reconciled

    def test_interrupted_but_all_done_becomes_show_complete(self) -> None:
        state = InstallState(
            status=STATUS_INTERRUPTED,
            components=["ollama"],
            steps={"ollama": STEP_DONE},
        )
        plan = plan_startup(loaded_state=state, primary_alive=False)
        assert plan.decision == DECISION_SHOW_COMPLETE

    def test_completed_is_fresh_on_cold_launch(self) -> None:
        # v1.15.0 Phase 2 (Issue 1): a cold relaunch after a completed run
        # starts fresh at Welcome, not the Complete page.
        state = InstallState(status=STATUS_COMPLETED)
        plan = plan_startup(loaded_state=state, primary_alive=False)
        assert plan.decision == DECISION_FRESH
        assert plan.state is state


class TestClearState:
    """v1.15.0 Phase 2 (Issue 1): acknowledging a run drops its state file."""

    def test_removes_an_existing_state_file(self, tmp_path: Path) -> None:
        path = tmp_path / "state.json"
        save_state(path, InstallState(status=STATUS_COMPLETED))
        assert path.is_file()
        clear_state(path)
        assert not path.exists()
        assert load_state(path) is None

    def test_absent_file_is_a_noop(self, tmp_path: Path) -> None:
        # Must never raise when there is nothing to delete.
        clear_state(tmp_path / "missing.json")
        assert not (tmp_path / "missing.json").exists()

    def test_cold_relaunch_after_acknowledge_is_fresh(self, tmp_path: Path) -> None:
        # End-to-end at the pure-logic level: a completed run is acknowledged
        # (CompletePage.on_finish / uninstaller clears state), so the next cold
        # launch loads no state and the decision is FRESH (Welcome).
        path = tmp_path / "state.json"
        save_state(path, InstallState(status=STATUS_COMPLETED))
        clear_state(path)
        reloaded = load_state(path)
        assert reloaded is None
        assert interpret_startup(reloaded, primary_alive=False) == DECISION_FRESH


def test_decisions_are_distinct() -> None:
    decisions = {
        bg_resume.DECISION_FRESH,
        bg_resume.DECISION_FORWARD,
        bg_resume.DECISION_SHOW_COMPLETE,
        bg_resume.DECISION_RESUME,
    }
    assert len(decisions) == 4
