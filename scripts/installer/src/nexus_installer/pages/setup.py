"""Compact Setup step: prerequisites, GPU detection, and install path.

The wizard used to spend three sidebar/stepper rows on this machine-local
work. Operators skipped past it as quickly as Next allowed, so the three
panels now share one step and stay on one screen.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtWidgets import QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import FS_BODY, TEXT_BODY
from nexus_installer.pages.gpu_detection import GpuDetectionPage
from nexus_installer.pages.install_path import InstallPathPage
from nexus_installer.pages.prerequisites import PrerequisitesPage

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


class SetupPage(QWidget):
    """One compact tab wrapping the three machine-setup panels."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        title = QLabel("Set up this machine")
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        subtitle = QLabel(
            "Prerequisites, GPU detection, and install location on one screen."
        )
        subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: {FS_BODY}px; background: transparent;"
        )
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        self._prereq = PrerequisitesPage(state, compact=True)
        self._gpu = GpuDetectionPage(state, compact=True)
        self._path = InstallPathPage(state, compact=True)
        layout.addWidget(self._prereq)
        layout.addWidget(self._gpu)
        layout.addWidget(self._path)
        layout.addStretch()

    def validate(self) -> tuple[bool, str]:
        """Next requires every nested panel to accept the current state."""
        for page in (self._prereq, self._gpu, self._path):
            checker = getattr(page, "validate", None)
            if not callable(checker):
                continue
            ok, msg = checker()
            if not ok:
                return ok, msg
        return True, ""
