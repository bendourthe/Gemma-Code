"""Crash detection + resume/restart decision (v1.11.0 Phase 7, T704).

Pure, Qt-free logic. On the next launch we hold a (possibly stale) persisted
:class:`InstallState` and a single fact from the reattach layer: is a primary
process still alive? From those two inputs this module decides what the launch
should do, and -- when a crashed run is resumable -- which steps are already
satisfied and can be skipped.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from nexus_installer.background.process import pid_alive
from nexus_installer.background.state_store import (
    DONE_STEP_STATUSES,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_INTERRUPTED,
    STATUS_RUNNING,
    InstallState,
)

# -- launch decisions --------------------------------------------------------
#: No prior run (or an aborted one): run the wizard from the start.
DECISION_FRESH = "fresh"
#: A live primary already owns this install: hand off and exit (T703).
DECISION_FORWARD = "forward"
#: A prior run finished in the background: reopen the Complete view (T703).
DECISION_SHOW_COMPLETE = "show_complete"
#: A prior run was cut short (crash / kill): offer resume-or-restart (T704).
DECISION_RESUME = "resume_prompt"


def reconcile_liveness(state: InstallState) -> InstallState:
    """Flip a 'running' state whose owning process is gone to 'interrupted'.

    A file left at ``running`` with no live ``pid`` is the signature of a crash
    or a hard kill -- the engine never got to write a terminal status. Mutates
    and returns `state` for convenience.
    """
    if state.status == STATUS_RUNNING and not pid_alive(state.pid):
        state.status = STATUS_INTERRUPTED
    return state


def interpret_startup(state: InstallState | None, *, primary_alive: bool) -> str:
    """Map (persisted state, live-primary?) to a launch decision."""
    if primary_alive:
        return DECISION_FORWARD
    if state is None:
        return DECISION_FRESH
    if state.status in (STATUS_COMPLETED, STATUS_FAILED):
        # A normally-finished run, seen on a *cold* relaunch, must start fresh
        # at Welcome -- NOT reopen the outcome view forever (v1.15.0 Phase 2 /
        # Issue 1). A leftover terminal state.json used to route every future
        # launch to the Complete page. The in-session "show me the result"
        # reattach is a different path (a live primary is signalled ->
        # DECISION_FORWARD, or the tray reopens the window), and a crash whose
        # steps all finished is still surfaced via plan_startup's
        # resume->show-complete promotion. CompletePage.on_finish() and the
        # uninstaller also clear the file, so it never lingers.
        return DECISION_FRESH
    if state.status == STATUS_CANCELLED:
        # The user aborted; start clean rather than resurrecting the run.
        return DECISION_FRESH
    # running (owner gone) / interrupted -> the run was cut short.
    return DECISION_RESUME


@dataclass
class ResumePlan:
    """Which steps a resumed run can skip vs. must still execute (T704)."""

    completed_steps: list[str] = field(default_factory=list)
    remaining_steps: list[str] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        """True when nothing remains -- a resume would be a no-op."""
        return not self.remaining_steps


def resume_plan(state: InstallState) -> ResumePlan:
    """Partition the run's components into already-satisfied vs. still-to-do.

    A step counts as satisfied only when the persisted per-step status is
    ``done`` or ``skipped``; anything mid-flight (``running``) or never reached
    is re-run. The engine additionally re-verifies idempotently at execution
    time (extension present, model files hash-verified), so a step marked done
    that is actually missing is still re-done safely.
    """
    completed = [
        step
        for step in state.components
        if state.steps.get(step) in DONE_STEP_STATUSES
    ]
    completed_set = set(completed)
    remaining = [step for step in state.components if step not in completed_set]
    return ResumePlan(completed_steps=completed, remaining_steps=remaining)
