"""QSS stylesheet generation from design-token constants."""

from __future__ import annotations

from nexus_installer.constants import (
    ACCENT,
    ACCENT_DIM,
    ACCENT_FOCUS,
    BG_CARD,
    BG_HEADER,
    BG_INPUT,
    BG_WINDOW,
    BORDER,
    BUTTON_HEIGHT,
    BUTTON_RADIUS,
    FONT_MONO,
    FONT_PRIMARY,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)


def generate_stylesheet() -> str:
    """Return the complete QSS stylesheet for the installer UI."""
    return f"""
/* â”€â”€ Global â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QMainWindow, QWidget {{
    background-color: {BG_WINDOW};
    color: {TEXT_PRIMARY};
    font-family: "{FONT_PRIMARY}";
    font-size: 13px;
}}

/* â”€â”€ Header band â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QWidget#headerBand {{
    background-color: {BG_HEADER};
}}

/* â”€â”€ Labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QLabel {{
    color: {TEXT_PRIMARY};
    background: transparent;
}}
QLabel#secondaryLabel {{
    color: {TEXT_SECONDARY};
}}
QLabel#mutedLabel {{
    color: {TEXT_MUTED};
}}
QLabel#errorLabel {{
    color: #ef4444;
    font-size: 12px;
}}

/* â”€â”€ Cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QFrame#card {{
    background-color: {BG_CARD};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 16px;
}}

/* â”€â”€ Primary button (cyan gradient) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QPushButton#primaryButton {{
    background-color: qlineargradient(
        x1:0, y1:0, x2:0, y2:1,
        stop:0 {ACCENT}, stop:1 {ACCENT_DIM}
    );
    color: #000000;
    font-weight: bold;
    font-size: 13px;
    border: none;
    border-radius: {BUTTON_RADIUS}px;
    min-height: {BUTTON_HEIGHT}px;
    padding: 0 24px;
}}
QPushButton#primaryButton:hover {{
    background-color: qlineargradient(
        x1:0, y1:0, x2:0, y2:1,
        stop:0 #0cd4d4, stop:1 {ACCENT}
    );
}}
QPushButton#primaryButton:pressed {{
    background-color: {ACCENT_DIM};
}}
QPushButton#primaryButton:disabled {{
    background-color: #2a3a4a;
    color: {TEXT_MUTED};
}}

/* â”€â”€ Secondary button (transparent border) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QPushButton#secondaryButton {{
    background-color: transparent;
    color: {TEXT_SECONDARY};
    font-size: 13px;
    border: 1px solid {BORDER};
    border-radius: {BUTTON_RADIUS}px;
    min-height: {BUTTON_HEIGHT}px;
    padding: 0 24px;
}}
QPushButton#secondaryButton:hover {{
    border-color: {ACCENT};
    color: {TEXT_PRIMARY};
}}
QPushButton#secondaryButton:pressed {{
    background-color: {BG_CARD};
}}
QPushButton#secondaryButton:disabled {{
    border-color: {BG_CARD};
    color: {TEXT_MUTED};
}}

/* â”€â”€ Text input fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QLineEdit {{
    background-color: {BG_INPUT};
    color: {TEXT_PRIMARY};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    min-height: 36px;
}}
QLineEdit:focus {{
    border-color: {ACCENT_FOCUS};
}}

/* â”€â”€ Text area / Log panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QTextEdit {{
    background-color: {BG_INPUT};
    color: #8bb4cc;
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 8px;
    font-family: "{FONT_MONO}";
    font-size: 9pt;
    selection-background-color: {ACCENT_DIM};
}}

/* â”€â”€ Scroll area â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QScrollArea {{
    background-color: transparent;
    border: none;
}}
QScrollArea > QWidget > QWidget {{
    background-color: transparent;
}}
QScrollBar:vertical {{
    background: {BG_WINDOW};
    width: 8px;
    border: none;
}}
QScrollBar::handle:vertical {{
    background: {BORDER};
    border-radius: 4px;
    min-height: 30px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}

/* â”€â”€ Progress bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QProgressBar {{
    background-color: {BG_CARD};
    border: none;
    border-radius: 4px;
    text-align: center;
    color: {TEXT_SECONDARY};
    min-height: 8px;
    max-height: 8px;
}}
QProgressBar::chunk {{
    background-color: qlineargradient(
        x1:0, y1:0, x2:1, y2:0,
        stop:0 {ACCENT}, stop:1 {ACCENT_DIM}
    );
    border-radius: 4px;
}}

/* â”€â”€ Checkbox (toggle base) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QCheckBox {{
    color: {TEXT_PRIMARY};
    spacing: 8px;
    font-size: 13px;
}}
QCheckBox::indicator {{
    width: 18px;
    height: 18px;
    border: 2px solid {BORDER};
    border-radius: 4px;
    background-color: {BG_INPUT};
}}
QCheckBox::indicator:checked {{
    background-color: {ACCENT};
    border-color: {ACCENT};
}}
QCheckBox::indicator:disabled {{
    background-color: {BG_CARD};
    border-color: {BG_CARD};
}}

/* â”€â”€ Callout box â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
QFrame#calloutBox {{
    background-color: {BG_CARD};
    border: none;
    border-left: 3px solid {ACCENT};
    border-radius: 0px;
    padding: 12px 16px;
}}
"""
