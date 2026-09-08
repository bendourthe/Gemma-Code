"""Additional tests to push coverage above 80%."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from nexus_installer.installer_state import InstallerState


class TestOllamaInstallerMacos:
    def test_macos_brew_success(self) -> None:
        from nexus_installer.engine.ollama_installer import OllamaInstaller

        state = InstallerState(ollama_installed=False)
        log = MagicMock()
        with (
            patch(
                "nexus_installer.engine.ollama_installer.is_windows", return_value=False
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_macos", return_value=True
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_linux", return_value=False
            ),
            patch(
                "nexus_installer.engine.ollama_installer.run_command",
                return_value=(0, "", ""),
            ),
            patch.object(OllamaInstaller, "_verify_ollama", return_value=True),
        ):
            result = OllamaInstaller().install(state, log)
            assert result is True

    def test_macos_brew_failure(self) -> None:
        from nexus_installer.engine.ollama_installer import OllamaInstaller

        state = InstallerState(ollama_installed=False)
        log = MagicMock()
        with (
            patch(
                "nexus_installer.engine.ollama_installer.is_windows", return_value=False
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_macos", return_value=True
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_linux", return_value=False
            ),
            patch(
                "nexus_installer.engine.ollama_installer.run_command",
                return_value=(1, "", "error"),
            ),
        ):
            result = OllamaInstaller().install(state, log)
            assert result is False


class TestOllamaVerify:
    def test_verify_success(self) -> None:
        from nexus_installer.engine.ollama_installer import OllamaInstaller

        state = InstallerState()
        log = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with (
            patch("nexus_installer.engine.ollama_installer.run_command"),
            patch(
                "nexus_installer.engine.ollama_installer.httpx.get",
                return_value=mock_resp,
            ),
        ):
            result = OllamaInstaller()._verify_ollama(state, log)
            assert result is True
            assert state.ollama_installed is True


class TestOllamaUnsupportedPlatform:
    def test_unsupported(self) -> None:
        from nexus_installer.engine.ollama_installer import OllamaInstaller

        state = InstallerState(ollama_installed=False)
        log = MagicMock()
        with (
            patch(
                "nexus_installer.engine.ollama_installer.is_windows", return_value=False
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_macos", return_value=False
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_linux", return_value=False
            ),
        ):
            result = OllamaInstaller().install(state, log)
            assert result is False


class TestCompletePageRefresh:
    def test_refresh_with_failures(self, qt_app: object) -> None:
        from nexus_installer.pages.complete import CompletePage

        state = InstallerState()
        state.failed_steps = ["ollama", "venv"]
        page = CompletePage(state)
        page._refresh()
        assert "Warnings" in page._title.text()

    def test_refresh_without_failures(self, qt_app: object) -> None:
        from nexus_installer.pages.complete import CompletePage

        state = InstallerState()
        state.failed_steps = []
        state.ollama_installed = True
        state.python_path = "/usr/bin/python3"
        page = CompletePage(state)
        page._refresh()
        assert "Complete" in page._title.text()


class TestReviewPageRebuild:
    def test_rebuild_summary(self, qt_app: object) -> None:
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState(
            install_path="/opt/gemma",
            selected_model="gemma4:e4b",
            gpu_name="RTX 4090",
            vram_mb=24576,
            components_to_install=["extension", "ollama", "venv", "model"],
        )
        page = ReviewPage(state)
        page._rebuild_summary()
        text = page._summary_text()
        assert "/opt/gemma" in text
        assert "gemma4:e4b" in text


class TestGpuPrerequisiteCallback:
    """GPU detection is a prerequisite row on Welcome (no separate page)."""

    def test_detection_complete_with_gpu(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
        ):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._on_gpu("RTX 4090", "nvidia", 24576)
            assert state.gpu_vendor == "nvidia"
            assert state.vram_mb == 24576
            assert state.recommended_model != ""

    def test_detection_complete_no_gpu(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
        ):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._on_gpu("", "none", 0)
            assert state.gpu_vendor == "none"
            assert state.recommended_model == "gemma4:e2b"


class TestInstallingPageCallbacks:
    def test_on_log(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._on_log("test message", "info")

    def test_on_progress(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._on_progress(0.5)
        assert page._progress.value() == 500

    def test_on_finished_success(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = True
        page._on_finished(True, "")
        assert not page._is_running
        assert "Complete" in page._title.text()

    def test_on_finished_failure(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = True
        page._on_finished(False, "some error")
        assert "Warnings" in page._title.text()

    def test_on_finished_engine_exception_shows_stopped(
        self, qt_app: object, monkeypatch: object
    ) -> None:
        from PyQt5.QtWidgets import QMessageBox

        from nexus_installer.pages.installing import InstallingPage

        boxes: list[str] = []

        def fake_critical(_parent: object, title: str, text: str) -> int:
            boxes.append(text)
            return 0

        monkeypatch.setattr(QMessageBox, "critical", fake_critical)
        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = True
        page._on_finished(False, "Engine exception: RuntimeError: pull exploded")
        assert page._title.text() == "Installation Stopped"
        assert boxes
        assert "Engine exception" in boxes[0]
        assert "Engine exception" in page.get_log_text()

    def test_get_log_text(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._on_log("line 1", "info")
        text = page.get_log_text()
        assert "line 1" in text
