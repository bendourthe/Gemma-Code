"""Launch-time orchestration for background continuation (Phase 7, T703/T704).

:func:`plan_startup` is the pure decision: given the persisted state and whether
a primary is alive, it returns a :class:`StartupPlan` the GUI entry point acts
on. Keeping it pure lets the whole branch matrix (fresh / forward / show-complete
/ resume) be unit-tested without Qt or a real second process.
"""

from __future__ import annotations

from dataclasses import dataclass

from nexus_installer.background.resume import (
    DECISION_FORWARD,
    DECISION_RESUME,
    ResumePlan,
    interpret_startup,
    reconcile_liveness,
    resume_plan,
)
from nexus_installer.background.state_store import InstallState


@dataclass
class StartupPlan:
    """The decision plus any data the entry point needs to act on it."""

    decision: str
    state: InstallState | None = None
    resume: ResumePlan | None = None


def plan_startup(
    *, loaded_state: InstallState | None, primary_alive: bool
) -> StartupPlan:
    """Decide what a launch should do (see :mod:`resume` for the decisions)."""
    if primary_alive:
        return StartupPlan(DECISION_FORWARD, loaded_state)

    state = loaded_state
    if state is not None:
        # No live primary: a 'running' file means the owner died -> interrupted.
        reconcile_liveness(state)

    decision = interpret_startup(state, primary_alive=False)
    plan = None
    if decision == DECISION_RESUME and state is not None:
        plan = resume_plan(state)
        # A "resume" with nothing left to do is really a completed run whose
        # terminal write was lost; treat it as show-complete instead.
        if plan.is_complete:
            from nexus_installer.background.resume import DECISION_SHOW_COMPLETE

            return StartupPlan(DECISION_SHOW_COMPLETE, state)
    return StartupPlan(decision, state, plan)
