"""Entry point for the Gemma Code installer wizard."""

from __future__ import annotations

import argparse
import sys

from gemma_installer import __version__


def main() -> None:
    """Parse arguments, create the QApplication, and launch the wizard."""
    parser = argparse.ArgumentParser(description="Gemma Code Installer")
    parser.add_argument(
        "--step",
        type=int,
        default=0,
        help="Jump to a specific step (0-indexed) for dev testing",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable verbose logging to stdout",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"gemma-code-installer {__version__}",
    )
    args = parser.parse_args()

    # Import PyQt5 after argument parsing so --version/--help work without Qt
    import os

    from PyQt5.QtCore import Qt
    from PyQt5.QtGui import QIcon
    from PyQt5.QtWidgets import QApplication

    from gemma_installer.installer_state import InstallerState
    from gemma_installer.pages.complete import CompletePage
    from gemma_installer.pages.configuration import ConfigurationPage
    from gemma_installer.pages.gpu_detection import GpuDetectionPage
    from gemma_installer.pages.install_path import InstallPathPage
    from gemma_installer.pages.installing import InstallingPage
    from gemma_installer.pages.model_selection import ModelSelectionPage
    from gemma_installer.pages.prerequisites import PrerequisitesPage
    from gemma_installer.pages.review import ReviewPage
    from gemma_installer.pages.welcome import WelcomePage
    from gemma_installer.window import InstallerWindow

    app = QApplication(sys.argv)
    app.setApplicationName("Gemma Code Installer")
    app.setApplicationVersion(__version__)

    # Set window icon from repo assets
    icon_candidates = [
        os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "..", "assets", "icon.ico"
        ),
        os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "..", "assets", "icon.png"
        ),
    ]
    for icon_path in icon_candidates:
        icon_path = os.path.normpath(icon_path)
        if os.path.isfile(icon_path):
            app.setWindowIcon(QIcon(icon_path))
            break

    # macOS Retina support
    if sys.platform == "darwin":
        app.setAttribute(Qt.ApplicationAttribute.AA_UseHighDpiPixmaps, True)

    state = InstallerState()
    window = InstallerWindow()

    # Register all 9 wizard pages
    window.add_page(WelcomePage(state))  # 0: Welcome
    window.add_page(PrerequisitesPage(state))  # 1: Prerequisites
    window.add_page(GpuDetectionPage(state))  # 2: GPU Detection
    window.add_page(InstallPathPage(state))  # 3: Install Path
    window.add_page(ModelSelectionPage(state))  # 4: Model Selection
    window.add_page(ConfigurationPage(state))  # 5: Configuration
    window.add_page(ReviewPage(state))  # 6: Review
    window.add_page(InstallingPage(state))  # 7: Installing
    window.add_page(CompletePage(state))  # 8: Complete

    if 0 <= args.step < len(window._pages):
        window.switch_page(args.step)
    else:
        window.show_first_page()

    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
