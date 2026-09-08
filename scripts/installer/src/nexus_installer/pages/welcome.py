"""Welcome page: compact hero, prerequisites cards, and the configuration panel.

The former Setup and Configuration steps are folded in here: the prerequisite
cards (VS Code, Python, disk, Ollama, GPU) sit under the hero, and the
configuration cards (install path + Ollama URL, features) follow, so every
machine-level choice is made on one page before the model selection.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    ACCENT_CHAT,
    ACCENT_CODING,
    ACCENT_IMAGE,
    ACCENT_VIDEO,
    FS_CAPTION,
    FS_H1,
    TEXT_BODY,
)
from nexus_installer.pages.configuration import ConfigurationPage
from nexus_installer.pages.prerequisites import PrerequisitesPage
from nexus_installer.widgets.gradient_wordmark import GradientWordmark

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

# (label, module accent) -- the desktop app's four pillars.
_PILLARS: tuple[tuple[str, str], ...] = (
    ("Chat", ACCENT_CHAT),
    ("Agentic Coding", ACCENT_CODING),
    ("Image", ACCENT_IMAGE),
    ("Video", ACCENT_VIDEO),
)


class WelcomePage(QWidget):
    """First wizard page: intro, live prerequisite checks, configuration."""

    def __init__(
        self,
        state: InstallerState,
        parent: QWidget | None = None,
        *,
        detect_fn: Callable[..., Any] | None = None,
        inspect_fn: Callable[..., Any] | None = None,
        list_fn: Callable[..., Any] | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        # Hero title at page-title scale (the display size made the hero alone
        # fill the first screen).
        title = GradientWordmark(
            "Welcome to Nexus",
            " AI Studio",
            FS_H1,
            align=Qt.AlignmentFlag.AlignLeft,
        )
        layout.addWidget(title)

        subtitle = QLabel(
            "Nexus is your fully local AI workstation: chat, agentic coding, "
            "and image and video generation, all running on your own hardware. "
            "This wizard installs everything for you -- the runtime, the models "
            "you pick, the VS Code extension, and the Nexus desktop app -- with "
            "no terminal required. Duration depends on your connection and the "
            "models you select."
        )
        subtitle.setObjectName("secondaryLabel")
        subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        # Pillar chips in the desktop app's module accents.
        chips = QHBoxLayout()
        chips.setSpacing(8)
        for pillar_name, pillar_accent in _PILLARS:
            chip = QLabel(pillar_name)
            chip.setStyleSheet(
                f"color: {pillar_accent}; border: 1px solid {pillar_accent}; "
                f"border-radius: 10px; padding: 2px 10px; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            chips.addWidget(chip)
        chips.addStretch()
        layout.addLayout(chips)

        # The machine checks, including GPU detection, directly under the hero.
        self._prereq = PrerequisitesPage(state)
        layout.addWidget(self._prereq)

        # Configuration: install path + Ollama URL, and the optional features.
        config_head = QLabel("Configuration")
        config_head.setObjectName("cardHead")
        layout.addWidget(config_head)
        self._config = ConfigurationPage(
            state, detect_fn=detect_fn, inspect_fn=inspect_fn, list_fn=list_fn
        )
        layout.addWidget(self._config)
        # Unsloth's compatibility lock depends on the GPU probe that runs on
        # this very page, so re-evaluate it the moment the probe finishes.
        self._prereq.gpu_detected.connect(self._config.refresh_host)

        layout.addStretch()

    def set_interactive(self, enabled: bool) -> None:
        """Lock the configuration choices once installation has started."""
        self._config.set_interactive(enabled)

    def validate(self) -> tuple[bool, str]:
        """Next requires the prerequisites and a usable install path."""
        ok, msg = self._prereq.validate()
        if not ok:
            return ok, msg
        return self._config.validate()
