"""Tests for wizard pages requiring QApplication."""

from __future__ import annotations

from unittest.mock import patch

import pytest

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

    def test_compact_recheck_is_icon_not_button(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from PyQt5.QtWidgets import QPushButton, QToolButton

            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState(), compact=True)
            assert not any(
                btn.text() == "Re-check" for btn in page.findChildren(QPushButton)
            )
            tools = [
                t
                for t in page.findChildren(QToolButton)
                if t.accessibleName() == "Re-check"
            ]
            assert len(tools) == 1

    def test_compact_recheck_replaces_inflight_worker(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from unittest.mock import MagicMock

            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState(), compact=True)
            first = MagicMock()
            first.isRunning.return_value = True
            page._worker = first
            page._run_detection()
            first.vscode_result.disconnect.assert_called()
            first.quit.assert_called()
            first.wait.assert_called()

    def test_compact_prereqs_two_columns_then_stack(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from PyQt5.QtCore import QSize
            from PyQt5.QtGui import QResizeEvent

            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState(), compact=True)
            page.resizeEvent(QResizeEvent(QSize(800, 400), QSize(800, 400)))
            grid = page._grid
            assert grid is not None
            assert grid.itemAtPosition(0, 0).widget() is page._vscode_row
            assert grid.itemAtPosition(0, 1).widget() is page._python_row
            assert grid.itemAtPosition(1, 0).widget() is page._disk_row
            assert grid.itemAtPosition(1, 1).widget() is page._ollama_row
            page.resizeEvent(QResizeEvent(QSize(400, 400), QSize(800, 400)))
            assert grid.itemAtPosition(0, 0).widget() is page._vscode_row
            assert grid.itemAtPosition(1, 0).widget() is page._python_row
            empty = grid.itemAtPosition(0, 1)
            assert empty is None or empty.widget() is None

    def test_compact_prereq_callbacks_and_row_states(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.prerequisites._DetectionWorker.start"):
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState(), compact=True)
            page._on_vscode("")
            assert page._vscode_found is False
            page._on_vscode(r"C:\VSCode\code.cmd")
            assert page._vscode_found is True
            page._on_python("", "")
            page._on_python(r"C:\Python\python.exe", "3.12.3")
            page._on_ollama(False, "")
            page._on_ollama(True, "0.11.0")
            page._on_disk(3.0)
            page._on_disk(7.0)
            page._on_disk(80.0)
            page._vscode_row.set_found("ok")
            page._vscode_row.set_missing("no")
            page._vscode_row.set_warning("warn")
            saved = page._grid
            page._grid = None
            page._place_prereq_grid(two_columns=True)
            page._grid = saved
            ok, _ = page.validate()
            assert ok is True


class TestGpuDetectionPage:
    def test_creates_without_crash(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            state = InstallerState()
            page = GpuDetectionPage(state)
            assert page is not None

    def test_detection_copies_host_ram_not_disk(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=32,
            ),
        ):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            state = InstallerState()
            state.free_disk_gb = 0
            page = GpuDetectionPage(state)
            page._on_detection_complete("RTX 4080", "nvidia", 16384)
            assert state.total_ram_gb == 32
            assert state.vram_mb == 16384
            assert state.free_disk_gb == 0
            assert "16 GB VRAM" in page._gpu_detail_label.text()

    def test_detection_ceils_15360_mib_to_16_gb_label(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=32,
            ),
        ):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            page = GpuDetectionPage(InstallerState())
            page._on_detection_complete("RTX 3080", "nvidia", 15360)
            assert "16 GB VRAM" in page._gpu_detail_label.text()
            assert "15360" not in page._gpu_detail_label.text()

    def test_compact_gpu_name_vendor_vram_one_label(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=32,
            ),
        ):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            page = GpuDetectionPage(InstallerState(), compact=True)
            page._on_detection_complete(
                "NVIDIA GeForce RTX 3080 Ti Laptop GPU", "nvidia", 16384
            )
            assert page._gpu_detail_label.isHidden()
            line = page._gpu_name_label.text()
            assert "Vendor: Nvidia" in line
            assert "16 GB VRAM" in line
            assert "NVIDIA GeForce RTX 3080 Ti Laptop GPU" in line
            assert "|" in line

    def test_compact_no_gpu_hides_card_keeps_warning(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=16,
            ),
        ):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            page = GpuDetectionPage(InstallerState(), compact=True)
            page._on_detection_complete("", "none", 0)
            assert page._gpu_card.isHidden()
            assert "No dedicated GPU" in page._status_label.text()

    def test_compact_gpu_elides_long_name(self, qt_app: object) -> None:
        with (
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=32,
            ),
        ):
            from PyQt5.QtCore import QSize
            from PyQt5.QtGui import QResizeEvent, QShowEvent

            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            page = GpuDetectionPage(InstallerState(), compact=True)
            long_name = "NVIDIA GeForce " + ("RTX 3080 Ti Laptop GPU " * 8)
            page._on_detection_complete(long_name, "nvidia", 16384)
            page._gpu_name_label.setFixedWidth(100)
            page.showEvent(QShowEvent())
            page.resizeEvent(QResizeEvent(QSize(200, 80), QSize(400, 80)))
            shown = page._gpu_name_label.text()
            assert shown != page._gpu_line_full
            assert "\u2026" in shown or shown.endswith("...")
            assert page._gpu_name_label.toolTip() == page._gpu_line_full

    def test_compact_gpu_elide_keeps_full_text_when_narrow(
        self, qt_app: object
    ) -> None:
        with (
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=32,
            ),
        ):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            page = GpuDetectionPage(InstallerState(), compact=True)
            page._on_detection_complete("RTX 3080 Ti", "nvidia", 16384)
            page._gpu_name_label.setFixedWidth(40)
            page._apply_gpu_elide()
            assert page._gpu_name_label.text() == page._gpu_line_full
            ok, _ = page.validate()
            assert ok is True

    def test_gpu_validate_blocks_until_detection(self, qt_app: object) -> None:
        with patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"):
            from nexus_installer.pages.gpu_detection import GpuDetectionPage

            page = GpuDetectionPage(InstallerState())
            ok, msg = page.validate()
            assert ok is False
            assert "detecting" in msg.lower()
            page._apply_gpu_elide()


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

    def test_writes_free_disk_gb_from_path_probe(self, qt_app: object) -> None:
        from unittest.mock import MagicMock

        from nexus_installer.pages.install_path import InstallPathPage

        usage = MagicMock()
        usage.free = 200 * 1024**3
        with patch(
            "nexus_installer.pages.install_path.shutil.disk_usage", return_value=usage
        ):
            state = InstallerState(install_path=r"C:\NexusAI")
            page = InstallPathPage(state)
            assert page is not None
            assert state.free_disk_gb == 200
            assert state.disk_space_gb == 200.0

    def test_disk_probe_error_keeps_free_disk_at_zero(self, qt_app: object) -> None:
        from nexus_installer.pages.install_path import InstallPathPage

        with patch(
            "nexus_installer.pages.install_path.shutil.disk_usage",
            side_effect=OSError("no disk"),
        ):
            state = InstallerState(install_path=r"C:\NexusAI")
            page = InstallPathPage(state)
            assert page is not None
            assert state.free_disk_gb == 0
            assert state.disk_space_gb == 0.0


class TestSetupPage:
    def test_compacts_three_machine_panels(self, qt_app: object) -> None:
        from PyQt5.QtWidgets import QLabel

        from nexus_installer.pages.setup import SetupPage

        with (
            patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
        ):
            page = SetupPage(InstallerState())
            texts = " ".join(lbl.text() for lbl in page.findChildren(QLabel))
            assert "Set up this machine" in texts
            assert "Prerequisites" in texts
            assert "GPU Detection" in texts
            assert "Install Path" in texts

    def test_validate_waits_for_nested_panels(self, qt_app: object, tmp_path) -> None:
        from nexus_installer.pages.setup import SetupPage

        with (
            patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
            patch(
                "nexus_installer.pages.gpu_detection.detect_total_ram_gb",
                return_value=32,
            ),
        ):
            state = InstallerState(install_path=str(tmp_path / "NexusAI"))
            page = SetupPage(state)
            ok, _msg = page.validate()
            assert ok is False
            page._prereq._vscode_found = True
            page._prereq._disk_ok = True
            page._gpu._on_detection_complete("RTX 3080 Ti", "nvidia", 16384)
            ok, msg = page.validate()
            assert ok is True, msg

    def test_setup_packs_without_trailing_stretch(self, qt_app: object) -> None:
        from nexus_installer.pages.setup import SetupPage

        with (
            patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
            patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
        ):
            page = SetupPage(InstallerState())
            layout = page.layout()
            assert layout is not None
            last = layout.itemAt(layout.count() - 1)
            assert last is not None
            assert last.spacerItem() is None
            assert last.widget() is page._path


class TestConfigurationPage:
    @pytest.fixture(autouse=True)
    def _stub_vscode_detect(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from nexus_installer.engine.extension_installer import VsCodeCliStatus

        monkeypatch.setattr(
            "nexus_installer.pages.vscode_extension.detect_vscode_cli",
            lambda: VsCodeCliStatus(None, None, None, False, "not-found"),
        )

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

    def test_video2x_note_is_not_an_install_toggle(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage
        from nexus_installer.video_enhancement_support import INSTALLER_NOTE

        page = ConfigurationPage(InstallerState())
        assert page._video2x_note.text() == INSTALLER_NOTE
        assert "never installed by this wizard" in page._video2x_note.text()

    def test_components_and_features_are_separate_columns(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        page = ConfigurationPage(InstallerState())
        assert page._components_col.objectName() == "config-components-column"
        assert page._features_col.objectName() == "config-features-column"
        assert page._components_col.parent() is not page._features_col
        assert page._ollama_toggle.parentWidget() is page._components_col
        assert page._unsloth.parentWidget().parentWidget() is page._features_col

    def test_unsloth_checkbox_is_off_and_sets_state(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState(gpu_vendor="nvidia", vram_mb=16384)
        page = ConfigurationPage(state)
        assert page._unsloth.isChecked() is False
        assert state.install_unsloth is False
        page._unsloth.setChecked(True)
        assert state.install_unsloth is True
        assert "QLoRA" in page._unsloth.text()
        assert "LGPL" in page._unsloth_help.text()

    def test_unsloth_incompatible_cannot_be_checked(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState(gpu_vendor="nvidia", vram_mb=8192)
        page = ConfigurationPage(state)
        assert page._unsloth_badge.text() == "Incompatible"
        assert page._unsloth.isEnabled() is False
        page._unsloth.setChecked(True)
        assert page._unsloth.isChecked() is False
        assert state.install_unsloth is False
        assert page._unsloth_warning.isHidden()

    def test_unsloth_refreshes_on_show_after_gpu(self, qt_app: object) -> None:
        from PyQt5.QtGui import QShowEvent

        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        assert page._unsloth_badge.text() == "Incompatible"
        assert page._unsloth.isEnabled() is False
        state.gpu_vendor = "nvidia"
        state.vram_mb = 16384
        page.showEvent(QShowEvent())
        assert page._unsloth_badge.text() == "Compatible"
        assert page._unsloth.isEnabled() is True

    def test_unsloth_hides_warning_on_nvidia_16gb(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState(gpu_vendor="nvidia", vram_mb=16384)
        page = ConfigurationPage(state)
        page._unsloth.setChecked(True)
        assert page._unsloth_warning.isHidden()
        assert page._unsloth_warning.text() == ""

    def test_unsloth_badge_is_visible_before_opt_in(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        none_page = ConfigurationPage(InstallerState(gpu_vendor="none", vram_mb=0))
        assert none_page._unsloth.isChecked() is False
        assert none_page._unsloth_badge.text() == "Incompatible"
        assert none_page._unsloth.isEnabled() is False

        ok_page = ConfigurationPage(InstallerState(gpu_vendor="nvidia", vram_mb=16384))
        assert ok_page._unsloth_badge.text() == "Compatible"
        assert ok_page._unsloth.isEnabled() is True

    def test_narrow_width_stacks_config_columns(self, qt_app: object) -> None:
        from PyQt5.QtCore import QSize
        from PyQt5.QtGui import QResizeEvent

        from nexus_installer.pages.configuration import ConfigurationPage

        page = ConfigurationPage(InstallerState())
        page.resizeEvent(QResizeEvent(QSize(400, 700), QSize(900, 700)))
        assert page._narrow_columns is True
        page.resizeEvent(QResizeEvent(QSize(900, 700), QSize(400, 700)))
        assert page._narrow_columns is False

    def test_vscode_checkbox_lives_on_configuration(self, qt_app: object) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        page = ConfigurationPage(InstallerState())
        assert page._vscode._checkbox.isHidden() is False
        assert page._vscode._checkbox.isEnabled() is False
        assert "not found" in page._vscode._detection_label.text().lower()


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

    def test_facts_and_models_are_separate_columns(self, qt_app: object) -> None:
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState(
            install_path=r"C:\Program Files\NexusAI",
            gpu_name="NVIDIA GeForce RTX 3080 Ti Laptop GPU",
            vram_mb=16384,
            selected_model_ids=["embedding-gemma", "gemma-4-12b-it-gguf"],
            selected_models_gb=20.0,
            components_to_install=["extension", "ollama", "venv", "model", "desktop"],
        )
        page = ReviewPage(state)
        page._rebuild_summary()
        facts = page._facts_label.text()
        models = page._models_label.text()
        assert page._facts_label.objectName() == "review-facts-column"
        assert page._models_label.objectName() == "review-models-column"
        assert r"C:\Program Files\NexusAI" in facts
        # v2.4.5 Phase 3.3: both estimates moved under the model list, where
        # they describe the models rather than the install path beside them.
        assert "Estimated installation time" in models
        assert "Estimated disk usage" in models
        assert "Estimated installation time" not in facts
        assert "Estimated disk usage" not in facts
        assert "Estimated time:" not in facts
        assert "16 GB VRAM" in facts
        assert "16384 MB" not in facts
        assert "embedding-gemma" in models
        assert "embedding-gemma" not in facts
        assert "Install path" not in models

    def test_zero_vram_omits_gb_suffix(self, qt_app: object) -> None:
        from nexus_installer.pages.review import ReviewPage

        page = ReviewPage(InstallerState(gpu_name="", vram_mb=0))
        page._rebuild_summary()
        facts = page._facts_label.text()
        assert "None detected" in facts
        assert "GB VRAM" not in facts
        assert "0 GB" not in facts

    def test_narrow_width_stacks_review_columns(self, qt_app: object) -> None:
        from PyQt5.QtCore import QSize
        from PyQt5.QtGui import QResizeEvent

        from nexus_installer.pages.review import ReviewPage

        page = ReviewPage(InstallerState())
        page.resizeEvent(QResizeEvent(QSize(400, 700), QSize(900, 700)))
        assert page._narrow_columns is True
        page.resizeEvent(QResizeEvent(QSize(900, 700), QSize(400, 700)))
        assert page._narrow_columns is False


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

    def test_request_cancel_confirms_then_aborts(
        self, qt_app: object, monkeypatch: object
    ) -> None:
        # v1.14.0 Phase 4: the footer Cancel routes here; a confirmed cancel
        # aborts the engine and releases the shell (emits finished(False)).
        from unittest.mock import MagicMock

        from PyQt5.QtWidgets import QMessageBox

        from nexus_installer.pages.installing import InstallingPage

        page = InstallingPage(InstallerState())
        page._is_running = True
        page._engine = MagicMock()
        monkeypatch.setattr(
            QMessageBox, "question", lambda *a, **k: QMessageBox.StandardButton.Yes
        )
        finished: list[bool] = []
        page.finished.connect(finished.append)
        page.request_cancel()
        assert page._is_running is False
        assert finished == [False]
        page._engine.cancel.assert_called_once()


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

    # v1.15.0 Phase 3 (Issue 2) -- post-install summary + retry surface.

    def _refreshed_page(self, **state_kw: object) -> object:
        from nexus_installer.pages.complete import CompletePage

        state = InstallerState()
        for key, value in state_kw.items():
            setattr(state, key, value)
        page = CompletePage(state)
        page._refresh()
        return page

    def test_retry_button_visible_for_failed_downloads(self, qt_app: object) -> None:
        page = self._refreshed_page(
            selected_model_ids=["a"],
            failed_models=["a"],
            model_failures={"a": "Error: 400:"},
        )
        assert not page._retry_btn.isHidden()

    def test_retry_button_hidden_on_clean_run(self, qt_app: object) -> None:
        page = self._refreshed_page(selected_model_ids=["a"])
        assert page._retry_btn.isHidden()

    def test_gated_skip_does_not_offer_retry(self, qt_app: object) -> None:
        # A gated skip needs a token, not another download attempt.
        page = self._refreshed_page(selected_model_ids=[], gated_skipped=["g"])
        assert page._retry_btn.isHidden()

    def test_retry_button_emits_signal(self, qt_app: object) -> None:
        page = self._refreshed_page(
            selected_model_ids=["a"],
            failed_models=["a"],
            model_failures={"a": "boom"},
        )
        fired: list[bool] = []
        page.retry_requested.connect(lambda: fired.append(True))
        page._retry_btn.click()
        assert fired == [True]

    def test_engine_crash_title_and_callout(self, qt_app: object) -> None:
        from nexus_installer.pages.complete import CompletePage

        state = InstallerState()
        state.failed_steps.append("engine")
        state.record_step_failure(
            "engine",
            "The installer hit an unexpected error and stopped.",
            "Open the log on the Complete page, then retry the install.",
        )
        page = CompletePage(state)
        page._refresh()
        assert page._title.text() == "Installation Stopped"
        assert "unexpected error" in page._subtitle.text()
        assert not page._warning_callout.isHidden()

    def test_optional_failure_is_warning_not_stopped(self, qt_app: object) -> None:
        page = self._refreshed_page(
            optional_failed_steps=["unsloth"],
            step_failures=[
                {
                    "step": "unsloth",
                    "summary": "The optional Unsloth environment is not ready.",
                    "suggestion": "Retry from Settings.",
                }
            ],
        )
        assert page._title.text() == "Installation Completed with Warnings"
        assert "unexpected error" not in page._subtitle.text()
        assert not page._warning_callout.isHidden()
        assert "#f" in page._warning_callout.styleSheet().lower()

    def test_dropped_progress_diagnostic_is_not_a_completion_warning(
        self, qt_app: object
    ) -> None:
        page = self._refreshed_page(
            install_log=[
                "[WARN] Model progress display update was dropped for m1: "
                "completed event"
            ]
        )
        assert page._title.text() == "Installation Complete"
        assert page._warning_callout.isHidden()


class TestInstallingGatedAuthWiring:
    """v1.14.0 Phase 2 -- the installing page resolves gated auth before the
    engine reads the selection, so a declined gated model leaves the queue."""

    def test_declined_gated_model_is_deselected(
        self, qt_app: object, tmp_path: object, monkeypatch: object
    ) -> None:
        # Isolate HF env so no ambient token short-circuits the pass.
        monkeypatch.delenv("HF_TOKEN", raising=False)
        monkeypatch.delenv("HUGGING_FACE_HUB_TOKEN", raising=False)
        monkeypatch.delenv("HF_TOKEN_PATH", raising=False)
        monkeypatch.setenv("HF_HOME", str(tmp_path))

        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState(selected_model_ids=["gated-x", "pub-y"])
        catalog = {
            "gated-x": {"gated": True, "source": {"repo": "org/x"}},
            "pub-y": {"gated": False},
        }
        page = InstallingPage(state)
        with (
            patch(
                "nexus_installer.pages.installing.load_catalog_index",
                return_value=catalog,
            ),
            patch(
                "nexus_installer.pages.installing.default_catalog_path",
                return_value=tmp_path,
            ),
            patch(
                "nexus_installer.pages.installing.run_gated_prompt",
                return_value=None,
            ),
        ):
            page._resolve_gated_auth()

        # Declined -> removed from the queue; the public model is untouched.
        assert state.selected_model_ids == ["pub-y"]
        assert "gated-x" in state.skipped_steps
