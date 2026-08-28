"""Entry point for the Nexus AI Studio installer wizard.

Supports two modes:

- Interactive GUI (default): launches the PyQt5 wizard with all 10 pages.
- ``--headless``: runs the full install engine without a GUI. Useful for
  CI smoke tests and scripted installs. In headless mode, `--json-output`
  emits a machine-parseable JSON summary on stdout. Exit code is 0 on
  success and 1 on any failure.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from nexus_installer import __version__

if TYPE_CHECKING:
    from nexus_installer.engine.installer import InstallEngine
    from nexus_installer.installer_state import InstallerState
    from nexus_installer.pages.complete import CompletePage
    from nexus_installer.pages.installing import InstallingPage
    from nexus_installer.window import InstallerWindow


def _prompt_resume() -> bool:
    """Ask whether to resume an interrupted run or start over (T704).

    Returns True to resume (skip already-satisfied steps), False to restart.
    """
    from PyQt5.QtWidgets import QMessageBox

    box = QMessageBox()
    box.setWindowTitle("Resume installation?")
    box.setText("A previous installation did not finish.")
    box.setInformativeText(
        "Resume where it left off (already-installed parts are skipped), "
        "or start over from the beginning?"
    )
    resume_btn = box.addButton("Resume", QMessageBox.ButtonRole.AcceptRole)
    box.addButton("Start over", QMessageBox.ButtonRole.RejectRole)
    box.setDefaultButton(resume_btn)
    box.exec()
    return box.clickedButton() is resume_btn


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Nexus AI Studio Installer")
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
        version=f"nexus-ai-studio-installer {__version__}",
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
        "--ollama-url",
        default=None,
        help=(
            "Override the Ollama base URL used for the running-server probe "
            "(e.g. http://127.0.0.1:11434). Use 127.0.0.1 rather than localhost "
            "on Windows, where localhost resolves to IPv6 ::1 first while Ollama "
            "binds IPv4."
        ),
    )
    parser.add_argument(
        "--skip-model",
        action="store_true",
        help="Skip model download (fast smoke test)",
    )
    parser.add_argument(
        "--skip-extension",
        action="store_true",
        help=(
            "Skip the VS Code extension install. Used by the smoke tests, which "
            "run from a source checkout that has no built VSIX to install."
        ),
    )
    parser.add_argument(
        "--skip-desktop",
        action="store_true",
        help=(
            "Skip the Nexus desktop app install. Used by the smoke tests, "
            "which must not fetch release assets or install a GUI app on CI."
        ),
    )
    parser.add_argument(
        "--desktop-bundle",
        default=None,
        help=(
            "Install the Nexus desktop app from a local bundle file instead "
            "of fetching the pinned GitHub release (offline installs and "
            "pre-release rehearsals; checksum verification is skipped)."
        ),
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Emit results as JSON to stdout (headless only)",
    )
    # v1.11.0 Phase 2 (T202) -- the clean-machine harness contract.
    parser.add_argument(
        "--headless-smoke",
        default=None,
        metavar="PROFILE_JSON",
        help=(
            "Run the install engine headlessly, driven by a smoke-profile "
            "JSON file (components, model selection, paths). Implies "
            "--headless. Used by the Windows Sandbox / Docker harnesses."
        ),
    )
    parser.add_argument(
        "--smoke-output",
        default=None,
        metavar="RESULT_JSON",
        help=(
            "Write the machine-readable result JSON (schema "
            "nexus-smoke-result/v1) to this path (headless only)."
        ),
    )
    parser.add_argument(
        "--check-registry",
        action="store_true",
        help=(
            "Diagnostic: resolve the bundled catalog.json / recommended.json "
            "registry files and exit 0 when both are present (used by the "
            "packaging smoke against the frozen exe)."
        ),
    )
    parser.add_argument(
        "--check-desktop-payload",
        action="store_true",
        help=(
            "Diagnostic: verify the embedded desktop-app payload (manifest + "
            "hash) and exit 0 when intact (v1.11.0 Phase 4; used by the "
            "packaging smoke against the frozen exe)."
        ),
    )
    parser.add_argument(
        "--reachability",
        action="store_true",
        help=(
            "Preflight: classify every catalog model's source reachability "
            "(OK/GATED/DEAD/UNKNOWN) without downloading, and exit 1 if any "
            "DEFAULT model is gated or dead (v1.13.0 Phase 2)."
        ),
    )
    parser.add_argument(
        "--preflight",
        nargs="?",
        const="__ALL__",
        metavar="TIER",
        help=(
            "Preflight: pull AND load each default model (optionally for one "
            "hardware tier, e.g. --preflight 16); exit 1 if any default fails. "
            "Downloads multi-GB weights and needs a Gemma-4-capable Ollama "
            "(v1.13.0 Phase 2)."
        ),
    )
    return parser


def _run_headless(args: argparse.Namespace) -> int:
    """Run the install engine without the GUI.

    Returns the process exit code. When ``--json-output`` is set, emits a
    single JSON object to stdout summarizing the result.
    """
    # Import inside the function so non-headless invocations never touch the
    # engine imports (useful for `--help`, `--version`).
    from nexus_installer.engine.desktop_provisioner import DesktopProvisioner
    from nexus_installer.engine.extension_installer import ExtensionInstaller
    from nexus_installer.engine.model_router import ModelStepRouter
    from nexus_installer.engine.ollama_installer import OllamaInstaller
    from nexus_installer.engine.venv_installer import VenvInstaller
    from nexus_installer.installer_state import InstallerState
    from nexus_installer.smoke import (
        SmokeProfileError,
        apply_smoke_profile,
        build_smoke_result,
        load_smoke_profile,
        write_smoke_result,
    )

    state = InstallerState()
    if args.install_path:
        state.install_path = args.install_path
    if args.ollama_url:
        state.ollama_url = args.ollama_url
    if args.model:
        state.selected_model = args.model
    else:
        state.selected_model = "gemma4:e2b"
    if args.skip_model and "model" in state.components_to_install:
        state.components_to_install = [
            c for c in state.components_to_install if c != "model"
        ]
    if args.skip_extension and "extension" in state.components_to_install:
        state.components_to_install = [
            c for c in state.components_to_install if c != "extension"
        ]
    if args.skip_desktop and "desktop" in state.components_to_install:
        state.components_to_install = [
            c for c in state.components_to_install if c != "desktop"
        ]
    if args.desktop_bundle:
        state.desktop_bundle_override = args.desktop_bundle

    # v1.11.0 Phase 2 (T202): a smoke profile overrides the arg-derived state.
    profile_name = "(args)"
    if args.headless_smoke:
        try:
            profile = load_smoke_profile(args.headless_smoke)
        except SmokeProfileError as exc:
            print(f"headless-smoke: {exc}", file=sys.stderr)
            return 2
        apply_smoke_profile(state, profile)
        profile_name = profile["name"]

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
        # v1.8.0 Phase 3: routed by catalog protocol, same as the GUI engine.
        router = ModelStepRouter()
        ok = run_step(
            "Downloading Models",
            lambda: router.install(state, log, lambda _pct: None),
        )
        (steps_done if ok else steps_failed).append("model")
    if "desktop" in state.components_to_install:
        provisioner = DesktopProvisioner()
        ok = run_step(
            "Installing Nexus Desktop",
            lambda: provisioner.install(state, log),
        )
        (steps_done if ok else steps_failed).append("desktop")

    success = not steps_failed
    summary = build_smoke_result(
        profile_name, state, steps_done, steps_failed, log_entries
    )
    summary["model"] = state.selected_model  # legacy key, kept for CI scripts

    if args.smoke_output:
        write_smoke_result(args.smoke_output, summary)
    if args.json_output:
        print(json.dumps(summary))
    else:
        status = "OK" if success else "FAIL"
        print(f"Install {status}: done={steps_done} failed={steps_failed}")

    return 0 if success else 1


def _run_preflight(args: argparse.Namespace) -> int:
    """Reachability probe or pull+load preflight of the default models (Qt-free).

    Returns the process exit code: 0 when everything checked passes, 1 when a
    default model is unreachable (reachability) or fails to pull/load.
    """
    from nexus_installer.engine import model_preflight as mp
    from nexus_installer.engine.model_router import (
        default_catalog_path,
        load_catalog_index,
    )
    from nexus_installer.installer_state import InstallerState

    def log(msg: str, level: str = "info") -> None:
        print(f"[{level}] {msg}")

    catalog = load_catalog_index(default_catalog_path())

    if args.reachability:
        statuses = mp.probe_catalog(catalog)
        groups: dict[mp.Reachability, list[str]] = {}
        for mid, status in statuses.items():
            groups.setdefault(status, []).append(mid)
        for status in mp.Reachability:
            ids = sorted(groups.get(status, []))
            print(f"{status.value.upper()} ({len(ids)}): {', '.join(ids)}")
        default_ids = set(mp.default_model_ids())
        broken = sorted(
            mid
            for mid in default_ids
            if statuses.get(mid) in (mp.Reachability.GATED, mp.Reachability.DEAD)
        )
        if broken:
            print(f"FAIL: default models unreachable: {broken}", file=sys.stderr)
            return 1
        print("OK: all default models are reachable.")
        return 0

    tier = None if args.preflight == "__ALL__" else args.preflight
    model_ids = mp.default_model_ids(tier)
    results = mp.run_preflight(model_ids, InstallerState(), log, catalog)
    for result in results:
        state_label = "OK" if result.ok else f"FAIL ({result.reason})"
        print(f"  {result.model_id} [{result.protocol}]: {state_label}")
    failed = [r for r in results if not r.ok]
    if failed:
        print(
            f"FAIL: {len(failed)} of {len(results)} default model(s) failed.",
            file=sys.stderr,
        )
        return 1
    print(f"OK: all {len(results)} default model(s) pulled and loaded.")
    return 0


def _register_gui_pages(
    window: InstallerWindow,
    state: InstallerState,
    *,
    on_engine_created: Callable[[InstallEngine], None] | None = None,
) -> tuple[InstallingPage, CompletePage]:
    """Register the canonical interactive wizard route in display order."""
    from nexus_installer.pages.complete import CompletePage
    from nexus_installer.pages.configuration import ConfigurationPage
    from nexus_installer.pages.gpu_detection import GpuDetectionPage
    from nexus_installer.pages.install_path import InstallPathPage
    from nexus_installer.pages.installing import InstallingPage
    from nexus_installer.pages.prerequisites import PrerequisitesPage
    from nexus_installer.pages.review import ReviewPage
    from nexus_installer.pages.typed_catalog import TypedCatalogPage
    from nexus_installer.pages.vscode_extension import VsCodeExtensionPage
    from nexus_installer.pages.welcome import WelcomePage

    window.add_page(WelcomePage(state))
    window.add_page(PrerequisitesPage(state))
    window.add_page(GpuDetectionPage(state))
    window.add_page(InstallPathPage(state))
    # The typed catalog produces `state.selected_model_ids` for the
    # protocol-routed install step.
    window.add_page(TypedCatalogPage(state))
    window.add_page(ConfigurationPage(state))
    window.add_page(VsCodeExtensionPage(state))
    window.add_page(ReviewPage(state))
    installing_page = InstallingPage(state, on_engine_created=on_engine_created)
    window.add_page(installing_page)
    complete_page = CompletePage(state)
    window.add_page(complete_page)
    return installing_page, complete_page


def main() -> None:
    """Parse arguments and dispatch to GUI or headless mode."""
    args = _build_arg_parser().parse_args()

    if args.reachability or args.preflight is not None:
        sys.exit(_run_preflight(args))

    if args.check_registry:
        # Qt-free diagnostic for the packaging smoke (v1.8.0 Phase 6, T601):
        # asserts the frozen bundle packaged the registry data files.
        from nexus_installer.registry_paths import check_registry

        sys.exit(check_registry())

    if args.check_desktop_payload:
        # Qt-free diagnostic (v1.11.0 Phase 4, T404): asserts the frozen
        # bundle carries an intact embedded desktop-app payload.
        from nexus_installer.engine.desktop_provisioner import (
            check_desktop_payload,
        )

        sys.exit(check_desktop_payload())

    if args.headless or args.headless_smoke:
        sys.exit(_run_headless(args))

    # Import PyQt5 lazily so --version/--help/--headless don't require Qt.
    from PyQt5.QtCore import Qt
    from PyQt5.QtWidgets import QApplication

    from nexus_installer.installer_state import InstallerState
    from nexus_installer.window import InstallerWindow

    # Windows: set an explicit AppUserModelID before the first window is created
    # so the OS taskbar shows this app's own (transparent, rounded) icon instead
    # of grouping under the generic Python host icon.
    if sys.platform == "win32":
        import ctypes

        with contextlib.suppress(Exception):
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(  # type: ignore[attr-defined]
                "com.nexusai.studio.installer"
            )

    app = QApplication(sys.argv)
    app.setApplicationName("Nexus AI Studio")
    app.setApplicationDisplayName("Nexus AI Studio")
    app.setApplicationVersion(__version__)

    # Window / taskbar icon: PNG + ICO packed together so Qt has a raster
    # Windows will paint (a fully transparent PNG-in-ICO often falls back to
    # the generic application glyph). Bundle-first via asset_file (T018).
    from nexus_installer.widgets.win_titlebar import build_window_icon

    window_icon = build_window_icon()
    if window_icon is not None:
        app.setWindowIcon(window_icon)

    # macOS Retina support
    if sys.platform == "darwin":
        app.setAttribute(Qt.ApplicationAttribute.AA_UseHighDpiPixmaps, True)

    # Dark-mode title bars on all native dialogs/popups (Windows only), so
    # QMessageBox / QFileDialog match the app's dark theme instead of a light OS
    # title bar. No-op off Windows.
    from nexus_installer.widgets.win_titlebar import DarkTitleBarFilter

    dark_titlebar_filter = DarkTitleBarFilter(app)
    app.installEventFilter(dark_titlebar_filter)

    # v1.11.0 Phase 7 (T703): single-instance reattach. If an install is already
    # running in another process, ask that one to surface its window and exit --
    # never start a duplicate. (QLocalSocket needs the QApplication above.)
    from nexus_installer.background import paths as bg_paths
    from nexus_installer.background import recorder as bg_recorder
    from nexus_installer.background import resume as bg_resume
    from nexus_installer.background import state_store
    from nexus_installer.background import tray as bg_tray
    from nexus_installer.background.controller import BackgroundController
    from nexus_installer.background.recorder import StateRecorder
    from nexus_installer.background.single_instance import (
        SingleInstanceServer,
        signal_running_instance,
    )
    from nexus_installer.background.startup import plan_startup

    if signal_running_instance(bg_paths.SINGLE_INSTANCE_KEY):
        return
    single_instance = SingleInstanceServer(bg_paths.SINGLE_INSTANCE_KEY)

    # Decide what this launch should do from any persisted run (T703/T704).
    bg_paths.ensure_state_dir()
    state_path = str(bg_paths.state_file())
    log_path = str(bg_paths.log_file())
    loaded_state = state_store.load_state(state_path)
    plan = plan_startup(loaded_state=loaded_state, primary_alive=False)

    state = InstallerState()
    if args.install_path:
        state.install_path = args.install_path
    if args.model:
        # Seed both selection surfaces: the typed catalog page treats a
        # pre-seeded multi-selection as user intent and will not stomp it
        # with the hardware-tier defaults.
        state.selected_model = args.model
        state.selected_model_ids = [args.model]
    if args.desktop_bundle:
        state.desktop_bundle_override = args.desktop_bundle

    # Apply the launch decision to the fresh state before pages are built.
    resume_now = False
    if plan.decision == bg_resume.DECISION_SHOW_COMPLETE and plan.state is not None:
        bg_recorder.apply_state_to_installer_state(plan.state, state)
        # One-time outcome view: now that the results are copied into
        # InstallerState, drop the persisted state so the next cold launch
        # starts at Welcome rather than reopening Complete (Issue 1).
        state_store.clear_state(state_path)
    elif plan.decision == bg_resume.DECISION_RESUME and plan.state is not None:
        resume_now = _prompt_resume()
        if resume_now and plan.resume is not None:
            bg_recorder.apply_resume_to_installer_state(plan.state, plan.resume, state)
        else:
            # Start over: discard the interrupted run's state file.
            with contextlib.suppress(OSError):
                Path(state_path).unlink()

    window = InstallerWindow(state=state)

    # Background continuation wiring (T701/T702): recorder persists the engine's
    # signal surface; the tray hosts the detached view; the controller ties them
    # to the window.
    recorder = StateRecorder(state_path, log_path)
    tray_controller: bg_tray.TrayController | None = None
    if bg_tray.is_tray_available():
        tray_controller = bg_tray.TrayController(bg_tray.create_tray_icon(window))
    controller = BackgroundController(
        window=window,
        installer_state=state,
        recorder=recorder,
        tray=tray_controller,
    )

    installing_page, complete_page = _register_gui_pages(
        window,
        state,
        on_engine_created=controller.on_engine_created,
    )

    # v1.15.0 Phase 3 (Issue 2): "Retry failed downloads" on the Complete page
    # re-runs just the failed model ids (via the engine's resume path), then
    # reveals the installing page so the user watches the retry live.
    def _retry_failed_models() -> None:
        if installing_page.retry_models():
            window.switch_page(window.installing_page_index)

    complete_page.retry_requested.connect(_retry_failed_models)

    controller.attach_installing_page(installing_page)
    window.background_requested.connect(controller.request_background)
    single_instance.show_requested.connect(controller.open_from_tray)
    if tray_controller is not None:
        tray_controller.open_requested.connect(controller.open_from_tray)
        tray_controller.cancel_requested.connect(controller.cancel_from_tray)

    if plan.decision == bg_resume.DECISION_SHOW_COMPLETE:
        window.switch_page(len(window._pages) - 1)  # Complete page
    elif resume_now:
        window.switch_page(window.installing_page_index)  # auto-starts, skips
    elif 0 <= args.step < len(window._pages):
        window.switch_page(args.step)
    else:
        window.show_first_page()

    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
