"""Tests for InstallEngine orchestration."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from nexus_installer.engine.installer import InstallEngine
from nexus_installer.installer_state import InstallerState


@pytest.fixture(autouse=True)
def _stub_runtime_provisioner():
    """v2.2.0 Phase 1 (1.3): the engine always runs the runtime-wiring step.

    Stub it for every engine test so no test provisions Node or writes the
    real ~/.nexus/runtime.json; its own behavior is covered in
    test_runtime_provisioner.py.
    """
    with (
        patch("nexus_installer.engine.installer.RuntimeProvisioner") as mock_rt,
        patch("nexus_installer.engine.installer.HubCatalogProvisioner") as mock_hub,
    ):
        mock_rt.return_value.install.return_value = True
        # v2.2.0 Phase 3 (3.1): the hub step always runs too; stub it so no
        # engine test touches the real ~/.nexus-ai catalog or the network.
        mock_hub.return_value.install.return_value = True
        yield mock_rt


class TestInstallEngineOrder:
    def test_runs_all_steps_in_order(self) -> None:
        state = InstallerState(
            vscode_path="/usr/bin/code",
            python_path="/usr/bin/python3",
            components_to_install=["ollama", "extension", "venv", "model", "desktop"],
        )
        call_order: list[str] = []

        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch("nexus_installer.engine.installer.VenvInstaller") as MockVenv,
            patch("nexus_installer.engine.installer.ModelStepRouter") as MockRouter,
            patch("nexus_installer.engine.installer.DesktopProvisioner") as MockDesktop,
        ):
            MockOllama.return_value.install.side_effect = lambda _state, _log: (
                call_order.append("ollama"),
                True,
            )[1]
            MockExt.return_value.install.side_effect = lambda _state, _log: (
                call_order.append("extension"),
                True,
            )[1]
            MockVenv.return_value.install.side_effect = lambda _state, _log: (
                call_order.append("venv"),
                True,
            )[1]
            MockRouter.return_value.install.side_effect = (
                lambda _state, _log, _progress, _event=None: (
                    call_order.append("model"),
                    True,
                )[1]
            )
            MockDesktop.return_value.install.side_effect = (
                lambda _state, _log, _progress: (
                    call_order.append("desktop"),
                    True,
                )[1]
            )

            engine = InstallEngine()
            # Connect signals to prevent errors
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            assert call_order == ["ollama", "extension", "venv", "model", "desktop"]


class TestInstallEngineSkips:
    def test_skips_ollama_when_not_in_components(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
        )

        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
        ):
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            MockOllama.return_value.install.assert_not_called()
            MockExt.return_value.install.assert_called_once()

    def test_skips_model_when_removed(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
        )

        with (
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch("nexus_installer.engine.installer.ModelStepRouter") as MockRouter,
        ):
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            MockRouter.return_value.install.assert_not_called()

    def test_skips_desktop_when_removed(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
        )

        with (
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch("nexus_installer.engine.installer.DesktopProvisioner") as MockDesktop,
        ):
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            MockDesktop.return_value.install.assert_not_called()


class TestInstallEnginePartialFailure:
    def test_continues_after_failure(self) -> None:
        state = InstallerState(
            components_to_install=["ollama", "extension"],
            vscode_path="/usr/bin/code",
        )
        finished_args: list[tuple[bool, str]] = []

        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
        ):
            MockOllama.return_value.install.return_value = False  # Fails
            MockExt.return_value.install.return_value = True  # Succeeds

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(
                lambda ok, msg: finished_args.append((ok, msg))
            )

            engine.run(state)

            # Both were called despite ollama failure
            MockOllama.return_value.install.assert_called_once()
            MockExt.return_value.install.assert_called_once()
            # Reports partial failure
            assert len(finished_args) == 1
            assert finished_args[0][0] is False
            assert "ollama" in finished_args[0][1]

    def test_desktop_failure_reported_but_run_completes(self) -> None:
        state = InstallerState(
            components_to_install=["extension", "desktop"],
            vscode_path="/usr/bin/code",
        )
        finished_args: list[tuple[bool, str]] = []

        with (
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch("nexus_installer.engine.installer.DesktopProvisioner") as MockDesktop,
        ):
            MockExt.return_value.install.return_value = True
            MockDesktop.return_value.install.return_value = False

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(
                lambda ok, msg: finished_args.append((ok, msg))
            )

            engine.run(state)

            assert finished_args[0][0] is False
            assert "desktop" in finished_args[0][1]
            assert "desktop" in state.failed_steps


class TestInstallEngineStepSignals:
    """v1.8.0 Phase 5 -- step-level signals feeding the grouped-progress UI."""

    def test_step_started_precedes_completion(self) -> None:
        state = InstallerState(
            components_to_install=["ollama", "extension"],
            vscode_path="/usr/bin/code",
        )
        events: list[tuple[str, str]] = []

        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
        ):
            MockOllama.return_value.install.return_value = True
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.step_started.connect(lambda n: events.append(("started", n)))
            engine.step_completed.connect(lambda n: events.append(("completed", n)))
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

        assert events == [
            ("started", "ollama"),
            ("completed", "ollama"),
            ("started", "extension"),
            ("completed", "extension"),
            # v2.2.0 Phase 1: the always-on runtime-wiring step.
            ("started", "runtime"),
            ("completed", "runtime"),
            # v2.2.0 Phase 3: the always-on Nexus-Hub harness step.
            ("started", "hub-catalog"),
            ("completed", "hub-catalog"),
        ]

    def test_step_failed_emitted_on_failure(self) -> None:
        state = InstallerState(
            components_to_install=["ollama", "extension"],
            vscode_path="/usr/bin/code",
        )
        failed: list[str] = []
        completed: list[str] = []

        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
        ):
            MockOllama.return_value.install.return_value = False
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.step_failed.connect(failed.append)
            engine.step_completed.connect(completed.append)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

        assert failed == ["ollama"]
        assert completed == ["extension", "runtime", "hub-catalog"]

    def test_step_progress_forwarded_from_model_and_desktop(self) -> None:
        state = InstallerState(
            components_to_install=["model", "desktop"],
            vscode_path="/usr/bin/code",
        )
        progress: list[tuple[str, float]] = []

        with (
            patch("nexus_installer.engine.installer.ModelStepRouter") as MockRouter,
            patch("nexus_installer.engine.installer.DesktopProvisioner") as MockDesktop,
        ):

            def run_model(
                s: object, log: object, cb: object, events: object = None
            ) -> bool:
                cb(0.25)  # type: ignore[operator]
                cb(0.75)  # type: ignore[operator]
                return True

            def run_desktop(s: object, log: object, cb: object) -> bool:
                cb(0.5)  # type: ignore[operator]
                return True

            MockRouter.return_value.install.side_effect = run_model
            MockDesktop.return_value.install.side_effect = run_desktop

            engine = InstallEngine()
            engine.step_progress.connect(lambda n, pct: progress.append((n, pct)))
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

        assert progress == [
            ("model", 0.25),
            ("model", 0.75),
            ("desktop", 0.5),
        ]


class TestInstallEngineResume:
    """v1.11.0 Phase 7 (T704) -- completed steps are skipped, not re-run."""

    def test_completed_steps_skipped_and_marked_done(self) -> None:
        state = InstallerState(
            components_to_install=["ollama", "extension"],
            completed_steps=["ollama"],
            vscode_path="/usr/bin/code",
        )
        completed: list[str] = []
        finished: list[tuple[bool, str]] = []

        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
        ):
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(completed.append)
            engine.install_finished.connect(lambda ok, msg: finished.append((ok, msg)))

            engine.run(state)

            # The already-done step is never re-executed...
            MockOllama.return_value.install.assert_not_called()
            # ...but is reported done so the reopened view shows it complete.
            assert "ollama" in completed
            # The remaining step runs normally.
            MockExt.return_value.install.assert_called_once()
            assert "extension" in completed
            # No failures -> a clean finish.
            assert finished == [(True, "")]

    def test_all_completed_skips_everything(self) -> None:
        state = InstallerState(
            components_to_install=["ollama", "extension"],
            completed_steps=["ollama", "extension"],
            vscode_path="/usr/bin/code",
        )
        with (
            patch("nexus_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
        ):
            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            MockOllama.return_value.install.assert_not_called()
            MockExt.return_value.install.assert_not_called()


class TestInstallEngineCancel:
    def test_cancel_propagates_to_desktop_provisioner(self) -> None:
        with patch(
            "nexus_installer.engine.installer.DesktopProvisioner"
        ) as MockDesktop:
            engine = InstallEngine()
            engine._desktop_provisioner = MockDesktop.return_value
            engine.cancel()
            MockDesktop.return_value.cancel.assert_called_once()

    def test_cancel_propagates_to_model_router(self) -> None:
        with patch("nexus_installer.engine.installer.ModelStepRouter") as MockRouter:
            engine = InstallEngine()
            engine._model_router = MockRouter.return_value
            engine.cancel()
            MockRouter.return_value.cancel.assert_called_once()


class TestInstallEngineUnsloth:
    def test_unsloth_skipped_by_default(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
        )
        with (
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch(
                "nexus_installer.engine.unsloth_venv_provisioner.UnslothVenvProvisioner"
            ) as MockUnsloth,
        ):
            MockExt.return_value.install.return_value = True
            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.step_started.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)
            engine.run(state)
            MockUnsloth.assert_not_called()

    def test_unsloth_runs_when_opted_in(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
            install_unsloth=True,
            gpu_vendor="nvidia",
            vram_mb=16384,
        )
        with (
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch(
                "nexus_installer.engine.unsloth_venv_provisioner.UnslothVenvProvisioner"
            ) as MockUnsloth,
        ):
            MockExt.return_value.install.return_value = True
            MockUnsloth.return_value.install.return_value = True
            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.step_started.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)
            engine.run(state)
            MockUnsloth.assert_called_once()
            assert MockUnsloth.call_args.kwargs.get("opt_in") is True
            MockUnsloth.return_value.install.assert_called_once()

    def test_unsloth_exception_is_optional_warning(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
            install_unsloth=True,
            gpu_vendor="nvidia",
            vram_mb=16384,
        )
        finished: list[tuple[bool, str]] = []
        failed: list[str] = []
        with (
            patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch(
                "nexus_installer.engine.unsloth_venv_provisioner.UnslothVenvProvisioner"
            ) as MockUnsloth,
        ):
            MockExt.return_value.install.return_value = True
            MockUnsloth.return_value.install.side_effect = FileNotFoundError(
                "core/tuning/unsloth-pins.json"
            )
            engine = InstallEngine()
            engine.step_failed.connect(failed.append)
            engine.install_finished.connect(lambda ok, msg: finished.append((ok, msg)))
            engine.run(state)

        assert finished and finished[0][0] is True
        assert "optional components" in finished[0][1]
        assert failed == ["unsloth"]
        assert "unsloth" in state.optional_failed_steps
        assert "unsloth" not in state.failed_steps
        result = next(f for f in state.step_results if f["step"] == "unsloth")
        assert result["required"] is False
        assert result["retryable"] is True


class TestRuntimeWiringStep:
    """v2.2.0 Phase 1 (1.3): the runtime step always runs and routes failure."""

    def test_runtime_failure_emits_step_failed(self, _stub_runtime_provisioner) -> None:
        _stub_runtime_provisioner.return_value.install.return_value = False
        state = InstallerState(
            components_to_install=["extension"], vscode_path="/usr/bin/code"
        )
        failed: list[str] = []
        finished: list[tuple[bool, str]] = []
        with patch("nexus_installer.engine.installer.ExtensionInstaller") as MockExt:
            MockExt.return_value.install.return_value = True
            engine = InstallEngine()
            engine.step_failed.connect(failed.append)
            engine.install_finished.connect(lambda ok, msg: finished.append((ok, msg)))
            engine.run(state)
        assert failed == ["runtime"]
        assert "runtime" in state.failed_steps
        assert finished and finished[0][0] is False

    def test_runtime_step_runs_even_with_no_components(
        self, _stub_runtime_provisioner
    ) -> None:
        state = InstallerState(components_to_install=[])
        engine = InstallEngine()
        engine.install_finished.connect(lambda *a: None)
        engine.run(state)
        _stub_runtime_provisioner.return_value.install.assert_called_once()


class TestInstallThreadCrashContainment:
    """v2.3.1 Phase 2: a model-step exception must not kill a windowed wizard."""

    _TOKEN = "hf_secret_token_xyz"

    def _pump(self, qt_app: object, until: list, timeout_s: float = 3.0) -> None:
        import time

        deadline = time.time() + timeout_s
        while not until and time.time() < deadline:
            qt_app.processEvents()
            time.sleep(0.01)
        qt_app.processEvents()

    def test_required_step_runtimeerror_is_contained_without_sys_exit(
        self, qt_app: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import sys

        from nexus_installer.engine.installer import _InstallThread

        exits: list[object] = []
        monkeypatch.setattr(sys, "exit", lambda *a, **k: exits.append(a))

        state = InstallerState(
            components_to_install=["model"],
            hf_token=self._TOKEN,
        )
        finished: list[tuple[bool, str]] = []

        with patch("nexus_installer.engine.installer.ModelStepRouter") as mock_router:
            mock_router.return_value.install.side_effect = RuntimeError(
                f"pull exploded {self._TOKEN}"
            )
            engine = InstallEngine()
            engine.install_finished.connect(lambda ok, msg: finished.append((ok, msg)))
            thread = _InstallThread(engine, state)
            thread.start()
            assert thread.wait(10_000)
            self._pump(qt_app, finished)

        assert exits == []
        assert finished, "install_finished must fire after a worker exception"
        ok, message = finished[0]
        assert ok is False
        assert message == "Installation completed with failures: model"
        assert self._TOKEN not in message
        assert "model" in state.failed_steps
        assert "engine" not in state.failed_steps
        assert any("RuntimeError" in line for line in state.install_log)

    def test_keyboard_interrupt_is_reraised_after_signal(self, qt_app: object) -> None:
        from nexus_installer.engine.installer import _InstallThread

        engine = InstallEngine()
        finished: list[tuple[bool, str]] = []
        engine.install_finished.connect(lambda ok, msg: finished.append((ok, msg)))

        def boom(_state: InstallerState) -> None:
            raise KeyboardInterrupt

        engine.run = boom  # type: ignore[method-assign]
        thread = _InstallThread(engine, InstallerState())
        with pytest.raises(KeyboardInterrupt):
            thread.run()
        self._pump(qt_app, finished)
        assert finished and finished[0][0] is False

    def test_marshal_model_started_runs_on_gui_thread(self, qt_app: object) -> None:
        import threading
        import time

        from PyQt5.QtCore import QThread
        from PyQt5.QtWidgets import QApplication

        from nexus_installer.engine.installer import InstallEngine

        engine = InstallEngine()
        seen: list[QThread] = []
        engine.model_started.connect(lambda _mid: seen.append(QThread.currentThread()))
        worker_ident: list[int] = []

        def worker() -> None:
            worker_ident.append(threading.get_ident())
            engine.marshal_model_started("gemma4:e2b")

        t = threading.Thread(target=worker)
        t.start()
        t.join(5)
        deadline = time.time() + 3
        while not seen and time.time() < deadline:
            qt_app.processEvents()
            time.sleep(0.01)
        qt_app.processEvents()

        assert worker_ident, "dummy thread must have run"
        assert seen, "queued model_started must reach the GUI after processEvents"
        assert seen[0] is QApplication.instance().thread()
        assert threading.get_ident() != worker_ident[0] or seen[0] is qt_app.thread()

    def test_marshal_failure_records_state_without_worker_emit(
        self, qt_app: object
    ) -> None:
        engine = InstallEngine()
        state = InstallerState()
        engine._active_state = state
        engine._invoke_slot = lambda *_a, **_k: False  # type: ignore[method-assign]
        seen: list[str] = []
        engine.model_started.connect(seen.append)
        engine.marshal_model_started("m1")
        qt_app.processEvents()
        assert seen == []
        assert "m1" in state.model_failures
