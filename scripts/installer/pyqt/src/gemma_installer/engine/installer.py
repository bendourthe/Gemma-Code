"""Main InstallEngine orchestrator running in a QThread."""

from __future__ import annotations

from PyQt5.QtCore import QObject, QThread, pyqtSignal

from gemma_installer.engine.extension_installer import ExtensionInstaller
from gemma_installer.engine.model_puller import ModelPuller
from gemma_installer.engine.ollama_installer import OllamaInstaller
from gemma_installer.engine.venv_installer import VenvInstaller
from gemma_installer.installer_state import InstallerState


class InstallEngine(QObject):
    """Orchestrates all installation steps, emitting signals for UI updates."""

    log_message = pyqtSignal(str, str)  # (message, level)
    progress_update = pyqtSignal(float)  # 0.0 to 1.0
    step_completed = pyqtSignal(str)  # component name
    install_finished = pyqtSignal(bool, str)  # (success, error_message)

    def __init__(self) -> None:
        super().__init__()
        self._model_puller: ModelPuller | None = None

    def run(self, state: InstallerState) -> None:
        """Execute all installation steps in sequence. Call from a QThread."""
        steps_done = 0
        steps_failed: list[str] = []
        total_steps = len(state.components_to_install)

        def log(msg: str, level: str = "info") -> None:
            state.install_log.append(f"[{level.upper()}] {msg}")
            self.log_message.emit(msg, level)

        def advance(step_name: str, success: bool) -> None:
            nonlocal steps_done
            steps_done += 1
            if success:
                self.step_completed.emit(step_name)
            else:
                steps_failed.append(step_name)
                state.failed_steps.append(step_name)
            base = steps_done / max(total_steps, 1)
            self.progress_update.emit(min(base, 1.0))

        # 1. Ollama
        if "ollama" in state.components_to_install:
            log("--- Installing Ollama ---", "info")
            ok = OllamaInstaller().install(state, log)
            advance("ollama", ok)

        # 2. VS Code extension
        if "extension" in state.components_to_install:
            log("--- Installing VS Code Extension ---", "info")
            ok = ExtensionInstaller().install(state, log)
            advance("extension", ok)

        # 3. Python venv
        if "venv" in state.components_to_install:
            log("--- Creating Python Environment ---", "info")
            ok = VenvInstaller().install(state, log)
            advance("venv", ok)

        # 4. Model pull (longest step, has its own progress)
        if "model" in state.components_to_install:
            log("--- Pulling Gemma Model ---", "info")
            self._model_puller = ModelPuller()

            def on_model_progress(pct: float) -> None:
                # Model pull is the final step; scale its progress into the remaining range
                base = (total_steps - 1) / max(total_steps, 1)
                self.progress_update.emit(base + pct / max(total_steps, 1))

            ok = self._model_puller.pull(state, log, on_model_progress)
            advance("model", ok)

        # Final report
        if steps_failed:
            msg = f"Installation completed with failures: {', '.join(steps_failed)}"
            log(msg, "warn")
            self.install_finished.emit(False, msg)
        else:
            log("All components installed successfully.", "success")
            self.progress_update.emit(1.0)
            self.install_finished.emit(True, "")

    def cancel(self) -> None:
        """Request cancellation of the current operation."""
        if self._model_puller:
            self._model_puller.cancel()


class _InstallThread(QThread):
    """Thread wrapper for InstallEngine.run."""

    def __init__(self, engine: InstallEngine, state: InstallerState) -> None:
        super().__init__()
        self._engine = engine
        self._state = state

    def run(self) -> None:
        self._engine.run(self._state)


def start_install(engine: InstallEngine, state: InstallerState) -> _InstallThread:
    """Start the installation in a background thread. Returns the thread."""
    thread = _InstallThread(engine, state)
    thread.start()
    return thread
