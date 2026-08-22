"""Main InstallEngine orchestrator running in a QThread."""

from __future__ import annotations

from pathlib import Path

from PyQt5.QtCore import QObject, QThread, pyqtSignal

from nexus_installer.engine.desktop_provisioner import DesktopProvisioner
from nexus_installer.engine.extension_installer import ExtensionInstaller
from nexus_installer.engine.model_router import ModelStepEvents, ModelStepRouter
from nexus_installer.engine.ollama_installer import OllamaInstaller
from nexus_installer.engine.runtime_provisioner import RuntimeProvisioner
from nexus_installer.engine.venv_installer import VenvInstaller
from nexus_installer.installer_state import InstallerState


class InstallEngine(QObject):
    """Orchestrates all installation steps, emitting signals for UI updates."""

    log_message = pyqtSignal(str, str)  # (message, level)
    progress_update = pyqtSignal(float)  # 0.0 to 1.0
    step_completed = pyqtSignal(str)  # component name
    install_finished = pyqtSignal(bool, str)  # (success, error_message)

    # v1.8.0 Phase 5 -- step-level signals for the grouped-progress UI.
    step_started = pyqtSignal(str)  # component name
    step_progress = pyqtSignal(str, float)  # (component, 0.0-1.0 within step)
    step_failed = pyqtSignal(str)  # component name

    # v1.11.0 Phase 1 (T105) -- per-model telemetry for the per-model progress
    # rows (P5 UI). model_progress carries a `ModelProgress` dataclass.
    model_started = pyqtSignal(str)  # model id
    model_progress = pyqtSignal(object)  # ModelProgress
    model_completed = pyqtSignal(str)  # model id
    model_failed = pyqtSignal(str, str)  # (model id, plain-language reason)

    def __init__(self) -> None:
        super().__init__()
        self._model_router: ModelStepRouter | None = None
        self._desktop_provisioner: DesktopProvisioner | None = None

    def run(self, state: InstallerState) -> None:
        """Execute all installation steps in sequence. Call from a QThread."""
        steps_done = 0
        steps_failed: list[str] = []
        total_steps = len(state.components_to_install)
        # v1.11.0 Phase 7 (T704): a resumed run treats these steps as already
        # satisfied -- they are marked done up front and never re-executed.
        completed = set(state.completed_steps)

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
                self.step_failed.emit(step_name)
            base = steps_done / max(total_steps, 1)
            self.progress_update.emit(min(base, 1.0))

        # Resume (T704): fold every already-satisfied step to "done" before the
        # real work, so the reopened Installing view shows them complete and the
        # progress accounting stays correct, without re-running them.
        for step in state.components_to_install:
            if step in completed:
                self.step_started.emit(step)
                log(f"{step}: already installed; skipping (resume).", "info")
                advance(step, True)

        def pending(step: str) -> bool:
            return step in state.components_to_install and step not in completed

        # 1. Ollama
        if pending("ollama"):
            self.step_started.emit("ollama")
            log("--- Installing Ollama ---", "info")
            ok = OllamaInstaller().install(state, log)
            advance("ollama", ok)

        # 2. VS Code extension
        if pending("extension"):
            self.step_started.emit("extension")
            log("--- Installing VS Code Extension ---", "info")
            ok = ExtensionInstaller().install(state, log)
            advance("extension", ok)

        # 3. Python venv
        if pending("venv"):
            self.step_started.emit("venv")
            log("--- Creating Python Environment ---", "info")
            ok = VenvInstaller().install(state, log)
            advance("venv", ok)

        # 4. Model downloads (longest step, has its own progress).
        # v1.8.0 Phase 3: routed by catalog protocol (ollama pull vs
        # Hugging Face weights) with per-model failure isolation.
        if pending("model"):
            self.step_started.emit("model")
            log("--- Downloading Models ---", "info")
            self._model_router = ModelStepRouter()
            model_base = steps_done / max(total_steps, 1)

            def on_model_progress(pct: float) -> None:
                # Scale this step's own progress into its band of the total.
                self.step_progress.emit("model", pct)
                self.progress_update.emit(model_base + pct / max(total_steps, 1))

            events = ModelStepEvents(
                started=self.model_started.emit,
                progress=self.model_progress.emit,
                completed=self.model_completed.emit,
                failed=self.model_failed.emit,
            )
            ok = self._model_router.install(state, log, on_model_progress, events)
            advance("model", ok)

        # 5. Nexus desktop app (v1.8.0 Phase 2; has its own download progress)
        if pending("desktop"):
            self.step_started.emit("desktop")
            log("--- Installing Nexus Desktop ---", "info")
            self._desktop_provisioner = DesktopProvisioner()
            desktop_base = steps_done / max(total_steps, 1)

            def on_desktop_progress(pct: float) -> None:
                self.step_progress.emit("desktop", pct)
                self.progress_update.emit(desktop_base + pct / max(total_steps, 1))

            ok = self._desktop_provisioner.install(state, log, on_desktop_progress)
            advance("desktop", ok)

        # 6. Runtime wiring (v2.2.0 Phase 1, 1.3) -- always runs after the
        # component steps: guarantees a per-user Node runtime (the shell never
        # depends on PATH `node`), installs the diffusion runtime sources, and
        # writes the ~/.nexus/runtime.json contract the desktop shell and
        # sidecar read at boot. Not part of components_to_install so resume
        # accounting is untouched; idempotent on re-run.
        self.step_started.emit("runtime")
        log("--- Wiring Desktop Runtime (Node + runtime.json) ---", "info")
        import sys as _sys

        _payload_root = (
            Path(getattr(_sys, "_MEIPASS", "")) / "payload"
            if getattr(_sys, "frozen", False)
            else None
        )
        runtime_ok = RuntimeProvisioner(
            _payload_root if _payload_root and _payload_root.is_dir() else None
        ).install(state, log)
        if runtime_ok:
            self.step_completed.emit("runtime")
        else:
            steps_failed.append("runtime")
            state.failed_steps.append("runtime")
            self.step_failed.emit("runtime")

        # v2.1 DF-15 -- opt-in Unsloth Core. Off the default chain; checkbox
        # on the extras page sets state.install_unsloth. LGPL zoo is copied
        # next to that checkbox. Unsupported hosts record provision.json and
        # still count as success so the rest of the install is not rolled back.
        if state.install_unsloth:
            self.step_started.emit("unsloth")
            log("--- Installing Unsloth Core (opt-in, LGPL zoo) ---", "info")
            from nexus_installer.engine.host_detect import HostProfile
            from nexus_installer.engine.unsloth_venv_provisioner import (
                UnslothVenvProvisioner,
            )

            platform = state.platform
            os_family = (
                "windows"
                if platform == "win32"
                else "macos"
                if platform == "darwin"
                else "linux"
                if platform.startswith("linux")
                else "unknown"
            )
            profile = HostProfile(
                os_family=os_family,
                gpu_vendor=(state.gpu_vendor or "none").lower(),
                gpu_model=state.gpu_name or "unknown",
                total_vram_gb=max(0, int(state.vram_mb) // 1024),
                free_disk_gb=int(state.free_disk_gb or 0),
                target_install_path=state.install_path,
            )
            ok = UnslothVenvProvisioner(opt_in=True).install(profile, log)
            if ok:
                self.step_completed.emit("unsloth")
            else:
                steps_failed.append("unsloth")
                state.failed_steps.append("unsloth")
                self.step_failed.emit("unsloth")

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
        if self._model_router:
            self._model_router.cancel()
        if self._desktop_provisioner:
            self._desktop_provisioner.cancel()


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
