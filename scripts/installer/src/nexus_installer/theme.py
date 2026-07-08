"""QSS stylesheet generation from design-token constants."""

from __future__ import annotations

from nexus_installer.constants import (
    ACCENT,
    ACCENT_BRIGHT,
    ACCENT_DIM,
    ACCENT_FOCUS,
    BG_CARD,
    BG_ELEVATED,
    BG_HEADER,
    BG_INPUT,
    BG_WINDOW,
    BORDER,
    BORDER_STRONG,
    BUTTON_HEIGHT,
    BUTTON_RADIUS,
    ERROR,
    FONT_MONO,
    FONT_PRIMARY,
    FS_BODY,
    FS_CAPTION,
    FS_H1,
    FS_H2,
    FW_BOLD,
    FW_SEMIBOLD,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)


def generate_stylesheet() -> str:
    """Return the complete QSS stylesheet for the installer UI."""
    return f"""
/* -- Global ---------------------------------------------------------- */
QMainWindow, QWidget {{
    background-color: {BG_WINDOW};
    color: {TEXT_PRIMARY};
    font-family: "{FONT_PRIMARY}";
    font-size: {FS_BODY}px;
}}

/* -- Frameless title bar (v1.9.0 T301) -------------------------------- */
QWidget#titleBar {{
    background-color: {BG_HEADER};
    border-bottom: 1px solid {BORDER};
}}
QLabel#titleBarTitle {{
    color: {TEXT_PRIMARY};
    font-size: {FS_BODY}px;
    font-weight: 600;
    background: transparent;
}}
QPushButton#titleBarButton, QPushButton#titleBarCloseButton {{
    background-color: transparent;
    color: {TEXT_SECONDARY};
    border: none;
    border-radius: 5px;
    font-size: {FS_BODY}px;
}}
QPushButton#titleBarButton:hover {{
    background-color: {BG_ELEVATED};
    color: {TEXT_PRIMARY};
}}
QPushButton#titleBarCloseButton:hover {{
    background-color: {ERROR};
    color: {TEXT_PRIMARY};
}}

/* -- Header band ------------------------------------------------------ */
QWidget#headerBand {{
    background-color: {BG_HEADER};
}}

/* -- Constellation body: keep the content band transparent so the
   BackgroundWidget (radial glow + constellation, T302) shows through.
   Chrome bands (title bar, header, footer) keep their solid fills. --- */
QScrollArea#contentScroll,
QWidget#scrollViewport,
QWidget#contentWrapper,
QWidget#contentWrapper > QWidget {{
    background: transparent;
}}

/* -- Labels ------------------------------------------------------------ */
QLabel {{
    color: {TEXT_PRIMARY};
    background: transparent;
}}
QLabel#secondaryLabel {{
    color: {TEXT_SECONDARY};
    font-size: {FS_CAPTION}px;
}}
QLabel#mutedLabel {{
    color: {TEXT_MUTED};
    font-size: {FS_CAPTION}px;
}}
QLabel#errorLabel {{
    color: {ERROR};
    font-size: {FS_CAPTION}px;
}}

/* -- Type-scale classes (v1.9.0 T008): the Phase-1 scale, centralized.
   Uniform roles use these object names; varied / dynamic-color labels set the
   size inline from the same FS_* tokens. ---------------------------------- */
QLabel#pageTitle {{
    font-size: {FS_H1}px;
    font-weight: {FW_BOLD};
    color: {TEXT_PRIMARY};
    background: transparent;
}}
QLabel#sectionHead {{
    font-size: {FS_H2}px;
    font-weight: {FW_SEMIBOLD};
    color: {TEXT_PRIMARY};
    background: transparent;
}}

/* -- Cards ------------------------------------------------------------- */
QFrame#card {{
    background-color: {BG_CARD};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 16px;
}}

/* -- Primary button (cyan gradient) ---------------------------------- */
QPushButton#primaryButton {{
    background-color: qlineargradient(
        x1:0, y1:0, x2:0, y2:1,
        stop:0 {ACCENT}, stop:1 {ACCENT_DIM}
    );
    color: {BG_WINDOW};
    font-weight: bold;
    font-size: {FS_BODY}px;
    border: none;
    border-radius: {BUTTON_RADIUS}px;
    min-height: {BUTTON_HEIGHT}px;
    padding: 0 24px;
}}
QPushButton#primaryButton:hover {{
    background-color: qlineargradient(
        x1:0, y1:0, x2:0, y2:1,
        stop:0 {ACCENT_BRIGHT}, stop:1 {ACCENT}
    );
}}
QPushButton#primaryButton:pressed {{
    background-color: {ACCENT_DIM};
}}
QPushButton#primaryButton:disabled {{
    background-color: {BG_ELEVATED};
    color: {TEXT_MUTED};
}}

/* -- Secondary button (transparent border) --------------------------- */
QPushButton#secondaryButton {{
    background-color: transparent;
    color: {TEXT_SECONDARY};
    font-size: {FS_BODY}px;
    border: 1px solid {BORDER_STRONG};
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

/* -- Text input fields ------------------------------------------------- */
QLineEdit {{
    background-color: {BG_INPUT};
    color: {TEXT_PRIMARY};
    border: 1px solid {BORDER_STRONG};
    border-radius: 8px;
    padding: 8px 12px;
    font-size: {FS_BODY}px;
    min-height: 36px;
}}
QLineEdit:focus {{
    border-color: {ACCENT_FOCUS};
}}

/* -- Text area / Log panel --------------------------------------------- */
QTextEdit {{
    background-color: {BG_INPUT};
    color: {TEXT_SECONDARY};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 8px;
    font-family: "{FONT_MONO}";
    font-size: {FS_CAPTION}px;
    selection-background-color: {ACCENT_DIM};
}}

/* -- Scroll area -------------------------------------------------------- */
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
    background: {BORDER_STRONG};
    border-radius: 4px;
    min-height: 30px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}

/* -- Progress bar ------------------------------------------------------- */
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

/* -- Tabs (typed model catalog) ---------------------------------------- */
QTabWidget::pane {{
    border: 1px solid {BORDER};
    border-radius: 8px;
    background-color: transparent;
    top: -1px;
}}
QTabBar::tab {{
    background-color: {BG_HEADER};
    color: {TEXT_SECONDARY};
    border: 1px solid {BORDER};
    border-bottom: none;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    padding: 6px 14px;
    margin-right: 2px;
}}
QTabBar::tab:hover {{
    color: {TEXT_PRIMARY};
}}
QTabBar::tab:selected {{
    background-color: {BG_CARD};
    color: {TEXT_PRIMARY};
    border-color: {BORDER_STRONG};
}}

/* -- Checkbox (toggle base) -------------------------------------------- */
QCheckBox {{
    color: {TEXT_PRIMARY};
    spacing: 8px;
    font-size: {FS_BODY}px;
}}
QCheckBox::indicator {{
    width: 18px;
    height: 18px;
    border: 2px solid {BORDER_STRONG};
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

/* -- Phase group card (installing page) --------------------------------- */
QFrame#phaseGroup {{
    background-color: {BG_CARD};
    border: 1px solid {BORDER};
    border-radius: 8px;
}}

/* -- Callout box --------------------------------------------------------- */
QFrame#calloutBox {{
    background-color: {BG_CARD};
    border: none;
    border-left: 3px solid {ACCENT};
    border-radius: 0px;
    padding: 12px 16px;
}}
"""
