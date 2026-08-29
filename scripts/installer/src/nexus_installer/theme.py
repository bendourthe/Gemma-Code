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
QMainWindow {{
    background-color: {BG_WINDOW};
    color: {TEXT_PRIMARY};
    font-family: "{FONT_PRIMARY}";
    font-size: {FS_BODY}px;
}}
QWidget {{
    background: transparent;
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

/* -- Navigation sidebar (v1.11.0 Phase 6, T601) ----------------------- */
QWidget#sidebar {{
    background-color: {BG_HEADER};
    border-right: 1px solid {BORDER};
}}
/* Keep the sidebar interior transparent so the column fill shows through;
   id-selector rules below (nav rows, help box) still win over this. */
QWidget#sidebar QWidget {{
    background: transparent;
}}
QPushButton#sidebarNavRow {{
    background: transparent;
    color: {TEXT_SECONDARY};
    border: none;
    border-left: 3px solid transparent;
    border-radius: 0px;
    text-align: left;
    padding: 6px 10px;
    font-size: {FS_BODY}px;
}}
QPushButton#sidebarNavRow:hover {{
    color: {TEXT_PRIMARY};
}}
QPushButton#sidebarNavRow[navState="done"] {{
    color: {TEXT_PRIMARY};
}}
QPushButton#sidebarNavRow[navState="current"] {{
    color: {ACCENT};
    font-weight: {FW_SEMIBOLD};
}}
QPushButton#sidebarNavRow[navState="locked"] {{
    color: {TEXT_MUTED};
}}
QPushButton#sidebarNavRow[selected="true"] {{
    border-left: 3px solid {ACCENT};
    background: {BG_CARD};
    color: {TEXT_PRIMARY};
}}
QFrame#helpBox {{
    background-color: {BG_CARD};
    border: 1px solid {BORDER_STRONG};
    border-radius: 8px;
    margin: 12px;
}}
QFrame#helpBox:hover {{
    border-color: {ACCENT};
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
/* Modern pill scrollbars (v1.9.0 T020): transparent track, slim rounded
   handle brightening on hover, no arrow buttons; horizontal mirrors vertical.
   Nested catalog scroll areas inherit this app-level rule. */
QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 2px 2px 2px 0;
    border: none;
}}
QScrollBar::handle:vertical {{
    background: {TEXT_MUTED};
    border-radius: 4px;
    min-height: 36px;
}}
QScrollBar::handle:vertical:hover {{
    background: {TEXT_SECONDARY};
}}
QScrollBar:horizontal {{
    background: transparent;
    height: 10px;
    margin: 0 2px 2px 2px;
    border: none;
}}
QScrollBar::handle:horizontal {{
    background: {TEXT_MUTED};
    border-radius: 4px;
    min-width: 36px;
}}
QScrollBar::handle:horizontal:hover {{
    background: {TEXT_SECONDARY};
}}
QScrollBar::add-line, QScrollBar::sub-line {{
    width: 0px;
    height: 0px;
    border: none;
    background: none;
}}
QScrollBar::add-page, QScrollBar::sub-page {{
    background: transparent;
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
QProgressBar#overallProgress {{
    background-color: transparent;
    min-height: 20px;
    max-height: 20px;
    border: none;
    color: {TEXT_PRIMARY};
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

/* -- Checkbox (toggle base, v1.9.0 T021) --------------------------------
   Modern control: comfortable 20px hit target, rounded box, accent fill when
   checked, and distinct hover / checked-hover / disabled / locked (checked +
   disabled) states. The per-model card checkbox is the custom-painted
   ModelCheckBox (with a crisp glyph); these base rules cover the plain
   toggles (configuration page). */
QCheckBox {{
    color: {TEXT_PRIMARY};
    spacing: 10px;
    font-size: {FS_BODY}px;
}}
QCheckBox::indicator {{
    width: 20px;
    height: 20px;
    border: 2px solid {BORDER_STRONG};
    border-radius: 6px;
    background-color: {BG_INPUT};
}}
QCheckBox::indicator:hover {{
    border-color: {ACCENT};
}}
QCheckBox::indicator:checked {{
    background-color: {ACCENT};
    border-color: {ACCENT};
}}
QCheckBox::indicator:checked:hover {{
    background-color: {ACCENT_BRIGHT};
    border-color: {ACCENT_BRIGHT};
}}
QCheckBox::indicator:disabled {{
    background-color: {BG_INPUT};
    border-color: {BORDER_STRONG};
}}
QCheckBox::indicator:checked:disabled {{
    background-color: {ACCENT_DIM};
    border-color: {ACCENT_DIM};
}}

/* -- Phase group card (installing page) --------------------------------- */
QFrame#phaseGroup {{
    background-color: {BG_CARD};
    border: 1px solid {BORDER};
    border-radius: 8px;
}}
QWidget#cardHeaderRow {{
    background: transparent;
}}
QWidget#phaseGroupDetails {{
    background: transparent;
}}
QWidget#modelCard QWidget {{
    background: transparent;
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
