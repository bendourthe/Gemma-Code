"""Model selection page: choose from four Gemma 4 model variants."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QButtonGroup,
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QRadioButton,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    TEXT_SECONDARY,
    WARNING,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

# (model_name, label, params, download_size, vram_required_mb, description)
MODEL_OPTIONS: list[tuple[str, str, str, str, int, str]] = [
    (
        "gemma4:e2b",
        "E2B",
        "2.3B params",
        "5.1 GB download, 4 GB VRAM",
        4096,
        "Fast, lightweight",
    ),
    (
        "gemma4:e4b",
        "E4B",
        "4.5B params",
        "8 GB download, 6 GB VRAM",
        6144,
        "Recommended for most GPUs",
    ),
    (
        "gemma4:26b",
        "26B MoE",
        "3.8B active params",
        "18 GB download, 8 GB VRAM",
        8192,
        "High quality, efficient",
    ),
    (
        "gemma4:31b",
        "31B Dense",
        "30.7B params",
        "20 GB download, 20 GB VRAM",
        20480,
        "Maximum quality",
    ),
]


class _ModelCard(QWidget):
    """Clickable card representing a model option."""

    def __init__(
        self,
        model_name: str,
        label: str,
        params: str,
        size_info: str,
        vram_required: int,
        description: str,
        is_recommended: bool,
        vram_available: int,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.model_name = model_name
        self._vram_required = vram_required

        self.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 12px;"
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(12)

        self._radio = QRadioButton()
        layout.addWidget(self._radio, alignment=Qt.AlignmentFlag.AlignTop)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(4)

        # Title row with optional badge
        title_row = QHBoxLayout()
        title_label = QLabel(f"{model_name}  --  {label} ({params})")
        title_label.setStyleSheet(
            "font-size: 13px; font-weight: bold; background: transparent;"
        )
        title_row.addWidget(title_label)

        if is_recommended:
            badge = QLabel("Recommended")
            badge.setStyleSheet(
                f"color: {ACCENT}; font-size: 10px; font-weight: bold; "
                f"border: 1px solid {ACCENT}; border-radius: 3px; "
                f"padding: 1px 6px; background: transparent;"
            )
            title_row.addWidget(badge)

        title_row.addStretch()
        info_layout.addLayout(title_row)

        detail = QLabel(f"{size_info}  |  {description}")
        detail.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
        )
        info_layout.addWidget(detail)

        # VRAM warning
        if vram_available > 0 and vram_required > vram_available:
            warn = QLabel("May exceed your GPU memory")
            warn.setStyleSheet(
                f"color: {WARNING}; font-size: 11px; background: transparent;"
            )
            info_layout.addWidget(warn)

        layout.addLayout(info_layout, stretch=1)

    @property
    def radio(self) -> QRadioButton:
        return self._radio


class ModelSelectionPage(QWidget):
    """Page for selecting a Gemma 4 model variant."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Model Selection")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        # Subtitle with GPU info
        gpu_text = (
            f"Detected: {state.gpu_name} ({state.vram_mb} MB VRAM)"
            if state.gpu_name
            else "No GPU detected"
        )
        subtitle = QLabel(gpu_text)
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        layout.addWidget(subtitle)

        # Model cards
        self._button_group = QButtonGroup(self)
        self._cards: list[_ModelCard] = []

        for model_name, label, params, size_info, vram_req, desc in MODEL_OPTIONS:
            is_recommended = model_name == state.recommended_model
            card = _ModelCard(
                model_name=model_name,
                label=label,
                params=params,
                size_info=size_info,
                vram_required=vram_req,
                description=desc,
                is_recommended=is_recommended,
                vram_available=state.vram_mb,
            )
            self._button_group.addButton(card.radio)
            self._cards.append(card)
            layout.addWidget(card)

            if model_name == state.selected_model or (
                not state.selected_model and is_recommended
            ):
                card.radio.setChecked(True)

        self._button_group.buttonClicked.connect(self._on_selection_changed)

        # Skip checkbox
        self._skip_checkbox = QCheckBox(
            "Skip model download (I'll pull the model later with `ollama pull <model>`)"
        )
        self._skip_checkbox.stateChanged.connect(self._on_skip_changed)
        layout.addWidget(self._skip_checkbox)

        layout.addStretch()

    def _on_selection_changed(self) -> None:
        for card in self._cards:
            if card.radio.isChecked():
                self._state.selected_model = card.model_name
                # Highlight selected card
                card.setStyleSheet(
                    f"background-color: {BG_CARD}; border: 2px solid {ACCENT}; "
                    f"border-radius: 8px; padding: 12px;"
                )
            else:
                card.setStyleSheet(
                    f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
                    f"border-radius: 8px; padding: 12px;"
                )

    def _on_skip_changed(self, state: int) -> None:
        if state == Qt.CheckState.Checked.value:
            if "model" in self._state.components_to_install:
                self._state.components_to_install.remove("model")
        else:
            if "model" not in self._state.components_to_install:
                self._state.components_to_install.append("model")
