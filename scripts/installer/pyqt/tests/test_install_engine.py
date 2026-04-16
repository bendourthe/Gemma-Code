"""Tests for InstallEngine orchestration."""

from __future__ import annotations

from unittest.mock import patch

from gemma_installer.engine.installer import InstallEngine
from gemma_installer.installer_state import InstallerState


class TestInstallEngineOrder:
    def test_runs_all_steps_in_order(self) -> None:
        state = InstallerState(
            vscode_path="/usr/bin/code",
            python_path="/usr/bin/python3",
            components_to_install=["ollama", "extension", "venv", "model"],
        )
        call_order: list[str] = []

        with (
            patch("gemma_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("gemma_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch("gemma_installer.engine.installer.VenvInstaller") as MockVenv,
            patch("gemma_installer.engine.installer.ModelPuller") as MockPuller,
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
            MockPuller.return_value.pull.side_effect = lambda s, l, p: (
                call_order.append("model"),
                True,
            )[1]

            engine = InstallEngine()
            # Connect signals to prevent errors
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            assert call_order == ["ollama", "extension", "venv", "model"]


class TestInstallEngineSkips:
    def test_skips_ollama_when_not_in_components(self) -> None:
        state = InstallerState(
            components_to_install=["extension"],
            vscode_path="/usr/bin/code",
        )

        with (
            patch("gemma_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("gemma_installer.engine.installer.ExtensionInstaller") as MockExt,
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
            patch("gemma_installer.engine.installer.ExtensionInstaller") as MockExt,
            patch("gemma_installer.engine.installer.ModelPuller") as MockPuller,
        ):
            MockExt.return_value.install.return_value = True

            engine = InstallEngine()
            engine.log_message.connect(lambda *a: None)
            engine.progress_update.connect(lambda *a: None)
            engine.step_completed.connect(lambda *a: None)
            engine.install_finished.connect(lambda *a: None)

            engine.run(state)

            MockPuller.return_value.pull.assert_not_called()


class TestInstallEnginePartialFailure:
    def test_continues_after_failure(self) -> None:
        state = InstallerState(
            components_to_install=["ollama", "extension"],
            vscode_path="/usr/bin/code",
        )
        finished_args: list[tuple[bool, str]] = []

        with (
            patch("gemma_installer.engine.installer.OllamaInstaller") as MockOllama,
            patch("gemma_installer.engine.installer.ExtensionInstaller") as MockExt,
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
