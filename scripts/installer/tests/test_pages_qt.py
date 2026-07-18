"""Tests for wizard pages requiring QApplication."""

from __future__ import annotations

from unittest.mock import patch

from nexus_installer.installer_state import InstallerState


class TestWelcomePage:
    def test_creates_without_crash(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.welcome._QuickCheckWorker.start"):
            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            assert page is not None

    def test_copy_names_nexus_not_gemma_code(self, qt_app: object) -> None:
        """v1.8.0 Phase 5 (T503) -- the welcome copy sells the product."""
        with patch("nexus_installer.pages.welcome._QuickCheckWorker.start"):
            from PyQt5.QtWidgets import QLabel

            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            all_text = " ".join(lbl.text() for lbl in page.findChildren(QLabel))
            assert "Nexus" in all_text
            assert "Gemma Code" not in all_text

    def test_pillar_chips_present(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.welcome._QuickCheckWorker.start"):
            from PyQt5.QtWidgets import QLabel

            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            texts = [lbl.text() for lbl in page.findChildren(QLabel)]
            for pillar in ("Chat", "Agentic Coding", "Image", "Video"):
                assert pillar in texts

    def test_title_is_nexus_ai_studio(self, qt_app: object) -> None:
        """v1.13.0 Phase 3 -- the welcome hero is a gradient wordmark carrying
        the product name (a custom-painted widget, not a plain QLabel)."""
        with patch("nexus_installer.pages.welcome._QuickCheckWorker.start"):
            from nexus_installer.pages.welcome import WelcomePage
            from nexus_installer.widgets.gradient_wordmark import (
                GradientWordmark,
            )

            state = InstallerState()
            page = WelcomePage(state)
            wordmarks = [w.full_text() for w in page.findChildren(GradientWordmark)]
            assert "Welcome to Nexus AI Studio" in wordmarks

    def test_hero_has_no_logo(self, qt_app: object) -> None:
        """v1.9.0 Phase 4 (T013) -- the Welcome logo lockup is retired.

        The hero is now just the title; there is no logo widget beside it (and
        so no floating-logo animation on the Welcome page).
        """
        with patch("nexus_installer.pages.welcome._QuickCheckWorker.start"):
            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            assert not hasattr(page, "_logo")


class TestWelcomeDiskCheck:
    """v1.13.0 Phase 4: the disk check probes an existing anchor (the install
    directory does not exist yet) against the base-install requirement."""

    def test_existing_anchor_walks_up_to_existing_dir(self) -> None:
        import os

        from nexus_installer.pages.welcome import _existing_anchor

        deep = os.path.join(os.path.expanduser("~"), "definitely", "missing", "x")
        assert os.path.isdir(_existing_anchor(deep))

    def test_worker_reports_sufficient_for_ample_free_space(
        self, qt_app: object
    ) -> None:
        from unittest.mock import MagicMock

        from nexus_installer.pages.welcome import _QuickCheckWorker

        worker = _QuickCheckWorker(r"C:\Program Files\NexusAI", required_gb=15.0)
        results: list[tuple[bool, float]] = []
        worker.disk_ok.connect(lambda ok, gb: results.append((ok, gb)))
        usage = MagicMock()
        usage.free = 484 * 1024**3  # 484 GB, like the reported machine
        with (
            patch.object(_QuickCheckWorker, "_find_python", return_value=("", False)),
            patch("nexus_installer.pages.welcome.shutil.which", return_value=None),
            patch(
                "nexus_installer.pages.welcome.shutil.disk_usage", return_value=usage
            ),
        ):
            worker.run()
        assert results
        ok, gb = results[0]
        # 484 GB >= 15 GB base install: no more amber-dot-with-ample-space bug.
        assert ok is True
        assert gb > 400


class TestPrerequisitesPage:
    def test_creates_and_has_validate(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            assert hasattr(page, "validate")

    def test_validate_fails_without_vscode(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._vscode_found = False
            page._disk_ok = True
            ok, msg = page.validate()
            assert ok is False
            assert "VS Code" in msg or "Visual Studio Code" in msg

    def test_validate_fails_without_disk(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._vscode_found = True
            page._disk_ok = False
            ok, msg = page.validate()
            assert ok is False

    def test_validate_passes_when_both_ok(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            state = InstallerState()
            page = PrerequisitesPage(state)
            page._vscode_found = True
            page._disk_ok = True
            ok, _ = page.validate()
            assert ok is True


class TestGpuDetectionPage:
    def test_creates_without_crash(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            state = InstallerState()
            page = GpuDetectionPage(state)
            assert page is not None


class TestInstallPathPage:
    def test_creates_with_default_path(self, qt_app: object) -> None:
        from nexus_installer.pages.install_path import InstallPathPage

        state = InstallerState()
        page = InstallPathPage(state)
        assert page is not None

    def test_default_path_is_nexusai(self, qt_app: object) -> None:
        """v1.9.0 Phase 3 (T305) -- the default path is NexusAI, not GemmaCode."""
        from nexus_installer.pages.install_path import InstallPathPage

        state = InstallerState()
        page = InstallPathPage(state)
        assert "GemmaCode" not in page._path_input.text()

    def test_callout_names_nexus_models(self, qt_app: object) -> None:
        """v1.9.0 Phase 3 (T305) -- the storage callout drops the 'Gemma' string."""
        from PyQt5.QtWidgets import QLabel

        from nexus_installer.pages.install_path import InstallPathPage

        state = InstallerState()
        page = InstallPathPage(state)
        all_text = " ".join(lbl.text() for lbl in page.findChildren(QLabel))
        assert "Nexus models" in all_text
        assert "Gemma model" not in all_text

    def test_validate_empty_path_fails(self, qt_app: object) -> None:
        from nexus_installer.pages.install_path import InstallPathPage

        state = InstallerState(install_path="")
        page = InstallPathPage(state)
        ok, _ = page.validate()
        assert ok is False


class TestConfigurationPage:
    def test_creates_with_toggles(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        assert page is not None

    def test_desktop_toggle_default_checked(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        assert page._desktop_toggle.isChecked() is True

    def test_desktop_toggle_updates_components(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        page._desktop_toggle.setChecked(False)
        assert "desktop" not in state.components_to_install
        page._desktop_toggle.setChecked(True)
        assert "desktop" in state.components_to_install


class TestReviewPage:
    def test_creates_with_summary(self, qt_app: object) -> None:
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState(
            selected_model="gemma4:e4b",
            gpu_name="RTX 4090",
            vram_mb=24576,
        )
        page = ReviewPage(state)
        assert page is not None


class TestInstallingPage:
    def test_creates_and_has_validate(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        assert hasattr(page, "validate")
        assert hasattr(page, "start_installation")

    def test_validate_blocks_while_running(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = True
        ok, msg = page.validate()
        assert ok is False

    def test_validate_passes_when_done(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._is_running = False
        ok, _ = page.validate()
        assert ok is True


class TestCompletePage:
    def test_creates_with_state(self, qt_app: object) -> None:
        from nexus_installer.pages.complete import CompletePage

        state = InstallerState()
        page = CompletePage(state)
        assert page is not None

    def test_copy_names_nexus_not_gemma_code(self, qt_app: object) -> None:
        """v1.8.0 Phase 5 (T503) -- complete-page copy matches the product."""
        from PyQt5.QtWidgets import QLabel

        from nexus_installer.pages.complete import CompletePage

        state = InstallerState()
        page = CompletePage(state)
        all_text = " ".join(lbl.text() for lbl in page.findChildren(QLabel))
        assert "Managing Nexus" in all_text
        assert "Gemma Code" not in all_text
