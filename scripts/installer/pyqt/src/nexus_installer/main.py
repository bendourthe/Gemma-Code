"""Entry point for the Gemma Code installer wizard.

Supports two modes:

- Interactive GUI (default): launches the PyQt5 wizard with all 9 pages.
- ``--headless``: runs the full install engine without a GUI. Useful for
  CI smoke tests and scripted installs. In headless mode, `--json-output`
  emits a machine-parseable JSON summary on stdout. Exit code is 0 on
  success and 1 on any failure.
"""

from __future__ import annotations

import argparse
import json
import sys

from nexus_installer import __version__


def _build_arg_parser() -> argparse.ArgumentParser:
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
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run the install engine without a GUI (exits 0 on success, 1 on failure)",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Override model selection (e.g. 'gemma4:e2b')",
    )
    parser.add_argument(
        "--install-path",
        default=None,
        help="Override the install path",
    )
    parser.add_argument(
        "--skip-model",
        action="store_true",
        help="Skip model download (fast smoke test)",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Emit results as JSON to stdout (headless only)",
    )
    return parser


def _run_headless(args: argparse.Namespace) -> int:
    """Run the install engine without the GUI.

    Returns the process exit code. When ``--json-output`` is set, emits a
    single JSON object to stdout summarizing the result.
    """
    # Import inside the function so non-headless invocations never touch the
    # engine imports (useful for `--help`, `--version`).
    from nexus_installer.engine.extension_installer import ExtensionInstaller
    from nexus_installer.engine.model_puller import ModelPuller
    from nexus_installer.engine.ollama_installer import OllamaInstaller
    from nexus_installer.engine.venv_installer import VenvInstaller
    from nexus_installer.installer_state import InstallerState

    state = InstallerState()
    if args.install_path:
        state.install_path = args.install_path
    if args.model:
        state.selected_model = args.model
    else:
        state.selected_model = "gemma4:e2b"
    if args.skip_model and "model" in state.components_to_install:
        state.components_to_install = [
            c for c in state.components_to_install if c != "model"
        ]

    steps_done: list[str] = []
    steps_failed: list[str] = []
    log_entries: list[dict] = []

    def log(msg: str, level: str = "info") -> None:
        log_entries.append({"level": level, "message": msg})
        if args.debug or not args.json_output:
            print(f"[{level.upper()}] {msg}", file=sys.stderr)

    # Headless mode runs in CI smoke tests where Ollama is pre-installed and
    # serving (via brew / winget / curl install.sh). Probe the local API first
    # so the install step short-circuits instead of re-downloading. The same
    # detection runs at GUI launch via the PrerequisitesPage probe.
    try:
        import httpx as _httpx_probe

        _probe = _httpx_probe.get(f"{state.ollama_url}/api/tags", timeout=2)
        if _probe.status_code == 200:
            state.ollama_installed = True
            log(
                f"Detected running Ollama at {state.ollama_url}; "
                "skipping the install step.",
                "info",
            )
    except Exception:  # noqa: BLE001  -- probe is best-effort
        pass

    def run_step(name: str, fn: callable) -> bool:  # type: ignore[valid-type]
        log(f"--- {name} ---")
        try:
            ok = fn()
        except Exception as exc:  # noqa: BLE001
            log(f"{name} failed: {exc}", "error")
            return False
        return bool(ok)

    if "ollama" in state.components_to_install:
        ok = run_step(
            "Installing Ollama",
            lambda: OllamaInstaller().install(state, log),
        )
        (steps_done if ok else steps_failed).append("ollama")
    if "extension" in state.components_to_install:
        ok = run_step(
            "Installing VS Code Extension",
            lambda: ExtensionInstaller().install(state, log),
        )
        (steps_done if ok else steps_failed).append("extension")
    if "venv" in state.components_to_install:
        ok = run_step(
            "Creating Python Environment",
            lambda: VenvInstaller().install(state, log),
        )
        (steps_done if ok else steps_failed).append("venv")
    if "model" in state.components_to_install:
        puller = ModelPuller()
        ok = run_step(
            "Pulling Gemma Model",
            lambda: puller.pull(state, log, lambda _pct: None),
        )
        (steps_done if ok else steps_failed).append("model")

    success = not steps_failed
    summary = {
        "success": success,
        "install_path": state.install_path,
        "model": state.selected_model,
        "steps_done": steps_done,
        "steps_failed": steps_failed,
        "logs": log_entries,
    }

    if args.json_output:
        print(json.dumps(summary))
    else:
        status = "OK" if success else "FAIL"
        print(f"Install {status}: done={steps_done} failed={steps_failed}")

    return 0 if success else 1


def main() -> None:
    """Parse arguments and dispatch to GUI or headless mode."""
    args = _build_arg_parser().parse_args()

    if args.headless:
        sys.exit(_run_headless(args))

    # Import PyQt5 lazily so --version/--help/--headless don't require Qt.
    import os

    from PyQt5.QtCore import Qt
    from PyQt5.QtGui import QIcon
    from PyQt5.QtWidgets import QApplication

    from nexus_installer.installer_state import InstallerState
    from nexus_installer.pages.complete import CompletePage
    from nexus_installer.pages.configuration import ConfigurationPage
    from nexus_installer.pages.gpu_detection import GpuDetectionPage
    from nexus_installer.pages.install_path import InstallPathPage
    from nexus_installer.pages.installing import InstallingPage
    from nexus_installer.pages.model_selection import ModelSelectionPage
    from nexus_installer.pages.prerequisites import PrerequisitesPage
    from nexus_installer.pages.review import ReviewPage
    from nexus_installer.pages.welcome import WelcomePage
    from nexus_installer.window import InstallerWindow

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
    if args.install_path:
        state.install_path = args.install_path
    if args.model:
        state.selected_model = args.model

    window = InstallerWindow()

    window.add_page(WelcomePage(state))
    window.add_page(PrerequisitesPage(state))
    window.add_page(GpuDetectionPage(state))
    window.add_page(InstallPathPage(state))
    window.add_page(ModelSelectionPage(state))
    window.add_page(ConfigurationPage(state))
    window.add_page(ReviewPage(state))
    window.add_page(InstallingPage(state))
    window.add_page(CompletePage(state))

    if 0 <= args.step < len(window._pages):
        window.switch_page(args.step)
    else:
        window.show_first_page()

    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
