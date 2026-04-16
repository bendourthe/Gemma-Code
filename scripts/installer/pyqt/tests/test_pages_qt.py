"""Tests for wizard pages requiring QApplication."""

from __future__ import annotations

from unittest.mock import patch

from gemma_installer.installer_state import InstallerState


class TestWelcomePage:
    def test_creates_without_crash(self, qt_app: object) -> None:
        with patch("gemma_installer.pages.welcome._QuickCheckWorker.start"):
            from gemma_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            assert page is not None


class TestPrerequisitesPage:
    def test_creates_and_has_validate(self, qt_app: object) -> None:
        with patch("gemma_installer.pages.prerequisites._DetectionWorker.start"):
            from gemma_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            assert hasattr(page, "validate")

    def test_validate_fails_without_vscode(self, qt_app: object) -> None:
        with patch("gemma_installer.pages.prerequisites._DetectionWorker.start"):
            from gemma_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._vscode_found = False
            page._disk_ok = True
            ok, msg = page.validate()
            assert ok is False
            assert "VS Code" in msg or "Visual Studio Code" in msg

    def test_validate_fails_without_disk(self, qt_app: object) -> None:
        with patch("gemma_installer.pages.prerequisites._DetectionWorker.start"):
            from gemma_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._vscode_found = True
            page._disk_ok = False
            ok, msg = page.validate()
            assert ok is False

    def test_validate_passes_when_both_ok(self, qt_app: object) -> None:
        with patch("gemma_installer.pages.prerequisites._DetectionWorker.start"):
            from gemma_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._vscode_found = True
            page._disk_ok = True
            ok, _ = page.validate()
            assert ok is True


class TestGpuDetectionPage:
    def test_creates_without_crash(self, qt_app: object) -> None:
        with patch("gemma_installer.pages.gpu_detection._GpuDetectionWorker.start"):
            from gemma_installer.pages.gpu_detection import GpuDetectionPage

            state = InstallerState()
            page = GpuDetectionPage(state)
            assert page is not None


class TestInstallPathPage:
    def test_creates_with_default_path(self, qt_app: object) -> None:
        from gemma_installer.pages.install_path import InstallPathPage

        state = InstallerState()
        page = InstallPathPage(state)
        assert page is not None

    def test_validate_empty_path_fails(self, qt_app: object) -> None:
        from gemma_installer.pages.install_path import InstallPathPage

        state = InstallerState(install_path="")
        page = InstallPathPage(state)
        ok, _ = page.validate()
        assert ok is False


class TestModelSelectionPage:
    def test_creates_with_models(self, qt_app: object) -> None:
        from gemma_installer.pages.model_selection import ModelSelectionPage

        state = InstallerState(recommended_model="gemma4:e4b", vram_mb=8192)
        page = ModelSelectionPage(state)
        assert len(page._cards) == 4


class TestConfigurationPage:
    def test_creates_with_toggles(self, qt_app: object) -> None:
        from gemma_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        assert page is not None


class TestReviewPage:
    def test_creates_with_summary(self, qt_app: object) -> None:
        from gemma_installer.pages.review import ReviewPage

        state = InstallerState(
            selected_model="gemma4:e4b",
            gpu_name="RTX 4090",
            vram_mb=24576,
        )
        page = ReviewPage(state)
        assert page is not None


class TestInstallingPage:
    def test_creates_and_has_validate(self, qt_app: object) -> None:
        from gemma_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        assert hasattr(page, "validate")
        assert hasattr(page, "start_installation")

    def test_validate_blocks_while_running(self, qt_app: object) -> None:
        from gemma_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = True
        ok, msg = page.validate()
        assert ok is False

    def test_validate_passes_when_done(self, qt_app: object) -> None:
        from gemma_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = False
        ok, _ = page.validate()
        assert ok is True


class TestCompletePage:
    def test_creates_with_state(self, qt_app: object) -> None:
        from gemma_installer.pages.complete import CompletePage

        state = InstallerState()
        page = CompletePage(state)
        assert page is not None
