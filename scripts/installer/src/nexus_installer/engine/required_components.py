"""v2.4.7 Phase 2 -- derive the components a model selection actually requires.

The Configuration step used to ask eight questions. Three of them were
load-bearing: unchecking Ollama, the Python environment, or the desktop app
silently broke models the user had chosen two steps earlier, and the wizard
said nothing about it. Two more were not install decisions at all -- thinking
mode and persistent memory set config values, gate no install step, and are
changeable in Settings afterwards.

This module resolves the load-bearing three from the selection so they can be
shown as a "will be installed" list with a reason, rather than asked. The
engine contract is untouched: `components_to_install` is still the list the
installer executes; it is now populated from here plus the user's genuinely
optional choices (VS Code extension, Start Menu shortcut, Unsloth).

Pure logic: no Qt import, so it is unit-testable without an event loop.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from nexus_installer.engine.model_router import CatalogEntry, protocol_for

#: Always installed. The desktop app is the product; an install without it is
#: a VS Code extension install, which is a different intent entirely and is
#: already expressed by the extension checkbox.
DESKTOP_REASON = "Runs the Nexus AI Studio application."

OLLAMA_REASON = "Serves the chat and embedding models you selected."

VENV_REASON = "Runs the image, video, audio, and document models you selected."


@dataclass(frozen=True)
class RequiredComponent:
    """One component the selection requires, with the reason it is required."""

    component: str
    label: str
    reason: str


@dataclass(frozen=True)
class RequiredComponents:
    """The components a selection requires, in install order."""

    items: tuple[RequiredComponent, ...] = ()

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(item.component for item in self.items)

    def requires(self, component: str) -> bool:
        return component in self.ids


def _needs_ollama(
    selection: Iterable[str], catalog: Mapping[str, CatalogEntry]
) -> bool:
    """True when any selected model is served by Ollama.

    An id absent from the catalog counts: unknown ids route to `ollama pull`
    verbatim (the `--model` override contract), so they need the daemon just
    as much as a catalogued chat model does.
    """
    return any(protocol_for(catalog.get(mid)) == "ollama" for mid in selection)


def _needs_python_env(
    selection: Iterable[str], catalog: Mapping[str, CatalogEntry]
) -> bool:
    """True when any selected model runs through the diffusion runtime.

    Every `huggingface`-protocol model -- image, video, audio, document -- is
    executed by the Python runtime the venv provides. Chat-only selections do
    not need it.
    """
    return any(
        protocol_for(catalog.get(mid)) == "huggingface"
        for mid in selection
        if mid in catalog
    )


def required_components(
    selection: Iterable[str],
    catalog: Mapping[str, CatalogEntry],
) -> RequiredComponents:
    """Components this selection cannot work without, each with its reason."""
    ids = list(selection)
    items: list[RequiredComponent] = [
        RequiredComponent("desktop", "Nexus AI Studio desktop app", DESKTOP_REASON)
    ]
    if _needs_python_env(ids, catalog):
        items.append(RequiredComponent("venv", "Python environment", VENV_REASON))
    if _needs_ollama(ids, catalog):
        items.append(RequiredComponent("ollama", "Ollama", OLLAMA_REASON))
    return RequiredComponents(items=tuple(items))


def apply_required_components(
    state: object,
    catalog: Mapping[str, CatalogEntry],
) -> RequiredComponents:
    """Fold the derived components into `state.components_to_install`.

    Additive by design: the optional choices the user made (extension,
    shortcut, Unsloth) already live in that list and must survive. Order is
    preserved so the installer's step sequence does not change.
    """
    resolved = required_components(
        getattr(state, "selected_model_ids", None) or [], catalog
    )
    components = list(getattr(state, "components_to_install", None) or [])
    for component in resolved.ids:
        if component not in components:
            components.append(component)
    state.components_to_install = components  # type: ignore[attr-defined]
    return resolved


__all__ = [
    "DESKTOP_REASON",
    "OLLAMA_REASON",
    "RequiredComponent",
    "RequiredComponents",
    "VENV_REASON",
    "apply_required_components",
    "required_components",
]
