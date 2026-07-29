"""Post-install outcome summary + retry preparation (v1.15.0 Phase 3 / Issue 2).

Turns the raw install bookkeeping on :class:`InstallerState` into a plain-language,
per-model summary the Complete page can render for a non-technical user, and
prepares a model-only retry of just the failed downloads.

Three outcome buckets:

* **succeeded** -- attempted and finished.
* **skipped (needs token)** -- an access-gated model the user declined at the
  guided Hugging Face step, so it was removed from the queue (never a failure).
* **failed** -- attempted but errored; the raw engine reason (``Error: 400``,
  ``401``, a network blip) is mapped to one plain sentence.

Only failed downloads are *retryable*: a gated skip needs a token, not a retry.
:func:`prepare_model_retry` reuses the engine's resume mechanism -- it marks the
non-model steps ``completed`` so a re-run executes only the model step, for just
the failed ids. Pure and Qt-free so it is fully unit-testable.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


def humanize_reason(raw: str) -> str:
    """Map a raw engine failure reason to one plain-language sentence."""
    text = (raw or "").lower()
    if not text.strip():
        return "The download did not complete."
    if "401" in text or "403" in text:
        return (
            "Access is gated - it needs a free Hugging Face account and token "
            "(you can add it and retry, or skip this model)."
        )
    if "404" in text:
        return "The model could not be found at its source."
    if "400" in text:
        return "The model server rejected the model (bad request)."
    if any(
        token in text
        for token in ("timeout", "timed out", "connection", "network", "temporarily")
    ):
        return "A network problem interrupted the download - retrying often fixes it."
    return raw.strip()


@dataclass(frozen=True)
class ModelOutcome:
    """One model's outcome for the summary (id, display name, plain reason)."""

    model_id: str
    display_name: str
    reason: str = ""


@dataclass
class InstallSummary:
    """Categorized per-model install outcome for the Complete page."""

    succeeded: list[ModelOutcome] = field(default_factory=list)
    skipped: list[ModelOutcome] = field(default_factory=list)
    failed: list[ModelOutcome] = field(default_factory=list)
    retryable_ids: list[str] = field(default_factory=list)

    @property
    def has_failures(self) -> bool:
        return bool(self.failed)


def _display_name(catalog: Mapping[str, Any] | None, model_id: str) -> str:
    if catalog:
        entry = catalog.get(model_id) or {}
        name = entry.get("displayName")
        if name:
            return str(name)
    return model_id


def summarize_install(
    state: InstallerState, catalog: Mapping[str, Any] | None = None
) -> InstallSummary:
    """Build the per-model outcome summary from the install state.

    ``catalog`` (id -> entry) supplies display names; without it the model id is
    shown. Gated declines were already removed from ``selected_model_ids`` and
    recorded in ``gated_skipped``, so the models still in the selection are the
    ones that were attempted.
    """
    failed_set = set(state.failed_models)
    succeeded = [
        ModelOutcome(mid, _display_name(catalog, mid))
        for mid in state.selected_model_ids
        if mid not in failed_set
    ]
    failed = [
        ModelOutcome(
            mid,
            _display_name(catalog, mid),
            humanize_reason(state.model_failures.get(mid, "")),
        )
        for mid in state.failed_models
    ]
    skipped = [
        ModelOutcome(
            mid,
            _display_name(catalog, mid),
            "Skipped - needs a free Hugging Face token.",
        )
        for mid in state.gated_skipped
    ]
    return InstallSummary(
        succeeded=succeeded,
        skipped=skipped,
        failed=failed,
        retryable_ids=list(state.failed_models),
    )


def prepare_model_retry(state: InstallerState) -> list[str]:
    """Mutate ``state`` to re-run only the failed model downloads; return the ids.

    Returns [] (and changes nothing) when there is nothing retryable. Otherwise
    it narrows the selection to the failed ids, marks every non-model component
    ``completed`` so the engine's resume path skips them, ensures the model step
    is pending again, and clears the prior model-failure bookkeeping so the
    re-run starts clean. Already-present models re-verify and skip idempotently.
    """
    retry_ids = list(state.failed_models)
    if not retry_ids:
        return []

    state.selected_model_ids = list(retry_ids)
    for step in state.components_to_install:
        if step != "model" and step not in state.completed_steps:
            state.completed_steps.append(step)
    while "model" in state.completed_steps:
        state.completed_steps.remove("model")

    state.failed_models = []
    state.failed_steps = [step for step in state.failed_steps if step != "model"]
    for mid in retry_ids:
        state.model_failures.pop(mid, None)
    return retry_ids


__all__ = [
    "InstallSummary",
    "ModelOutcome",
    "humanize_reason",
    "prepare_model_retry",
    "summarize_install",
]
