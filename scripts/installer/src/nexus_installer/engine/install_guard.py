"""v1.1.0 Phase 14.8 -- Final disk + hardware guard at "Begin Installation".

The wizard re-runs host detection right before kicking off the download so
the OS reserve is honored even if the user freed (or filled) disk space in
another app while the wizard sat open. The guard is pure logic so it can be
unit-tested without a Qt event loop.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GuardResult:
    """Result of the pre-install disk guard."""

    ok: bool
    needed_gb: float
    free_gb: float
    reserve_gb: float
    message: str


def evaluate_install_guard(
    *,
    free_disk_gb: float,
    selection_gb: float,
    reserve_gb: float,
) -> GuardResult:
    """Verify the selection still fits with the OS reserve.

    Returns `ok=True` when `selection + reserve <= free`. Otherwise `ok=False`
    with a user-facing `message` describing the gap.
    """
    needed = float(selection_gb) + float(reserve_gb)
    free = float(free_disk_gb)
    if free <= 0:
        return GuardResult(
            ok=False,
            needed_gb=needed,
            free_gb=free,
            reserve_gb=float(reserve_gb),
            message=(
                "Could not read free disk space on the install volume. "
                "Free up disk and retry the detection step."
            ),
        )
    if selection_gb + reserve_gb > free:
        return GuardResult(
            ok=False,
            needed_gb=needed,
            free_gb=free,
            reserve_gb=float(reserve_gb),
            message=(
                f"Insufficient disk space (need {needed:.1f} GB free, "
                f"have {free:.1f} GB). Return to the model picker and reduce "
                f"the selection, or free up disk space."
            ),
        )
    return GuardResult(
        ok=True,
        needed_gb=needed,
        free_gb=free,
        reserve_gb=float(reserve_gb),
        message="ok",
    )


__all__ = ["GuardResult", "evaluate_install_guard"]
