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
    with patch("nexus_installer.engine.installer.RuntimeProvisioner") as mock_rt:
        mock_rt.return_value.install.return_value = True
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
            MockOllama.return_value.install.side_effect = lambda s, l: (
                call_order.append("ollama"),
                True,
            )[1]
            MockExt.return_value.install.side_effect = lambda s, l: (
                call_order.append("extension"),
                True,
            )[1]
            MockVenv.return_value.install.side_effect = lambda s, l: (
                call_order.append("venv"),
                True,
            )[1]
            MockRouter.return_value.install.side_effect = lambda s, l, p, e=None: (
                call_order.append("model"),
                True,
            )[1]
            MockDesktop.return_value.install.side_effect = lambda s, l, p: (
                call_order.append("desktop"),
                True,
            )[1]

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
        assert completed == ["extension", "runtime"]

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


class TestRuntimeWiringStep:
    """v2.2.0 Phase 1 (1.3): the runtime step always runs and routes failure."""

    def test_runtime_failure_emits_step_failed(
        self, _stub_runtime_provisioner
    ) -> None:
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
