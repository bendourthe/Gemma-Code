"""v1.14.0 Phase 2 -- gated-model auth coordination (UI-independent).

The catalog offers a few open-weight models behind a Hugging Face license
click-through (``gated: true`` + ``requiresLicense``). The install must never
silently fail on one, so before the download step this coordinator resolves a
token for every selected gated model:

* If a token is already available (env / HF cache / a token entered earlier in
  this run), every gated selection is covered -- zero user action.
* Otherwise the caller's ``prompt`` (the guided dialog) is shown once; the
  entered+validated token unlocks the rest. If the user declines, that model
  is removed from the install queue so nothing that would 401 is ever queued.

The ``prompt`` callable is injected so this logic is fully testable without Qt.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from nexus_installer.engine.hf_auth import discover_hf_token
from nexus_installer.installer_state import InstallerState

# prompt(entry) -> a validated token string, or None when the user declines.
PromptFn = Callable[[dict], "str | None"]


@dataclass
class GatedAuthOutcome:
    """What the gated-auth pass did to the install queue."""

    unlocked: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def pending_gated_ids(state: InstallerState, catalog: dict[str, dict]) -> list[str]:
    """Selected gated model ids that still need a token.

    Empty when a token is already discoverable (it covers every gated repo the
    account has accepted the license for) or nothing gated is selected.
    """
    if discover_hf_token(state):
        return []
    return [
        mid for mid in state.selected_model_ids if (catalog.get(mid) or {}).get("gated")
    ]


def deselect_model(state: InstallerState, model_id: str) -> None:
    """Remove a model from the install queue and record it as skipped."""
    while model_id in state.selected_model_ids:
        state.selected_model_ids.remove(model_id)
    state.record_skipped_step(model_id)


def ensure_gated_auth(
    state: InstallerState,
    catalog: dict[str, dict],
    prompt: PromptFn,
) -> GatedAuthOutcome:
    """Resolve auth for every selected gated model before the download step.

    Returns the ids unlocked by an entered token and the ids the user declined
    (removed from the queue). A token found in the environment / HF cache short-
    circuits the whole pass with no prompt.
    """
    outcome = GatedAuthOutcome()
    for mid in list(state.selected_model_ids):
        entry = catalog.get(mid) or {}
        if not entry.get("gated"):
            continue
        if discover_hf_token(state):
            # A token (env / cache / just entered) already covers this repo.
            continue
        token = prompt(entry)
        if token and token.strip():
            state.hf_token = token.strip()
            outcome.unlocked.append(mid)
        else:
            deselect_model(state, mid)
            outcome.skipped.append(mid)
    return outcome
