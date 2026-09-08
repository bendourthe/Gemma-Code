"""Welcome + Setup merge: the prerequisites panel (with the GPU row) lives on
Welcome, the install path and Start Menu shortcut live on Configuration, and
the wizard has six steps."""

from __future__ import annotations

import os
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.constants import BASE_INSTALL_GB, FS_H1, STEP_NAMES
from nexus_installer.installer_state import InstallerState


@contextmanager
def _no_probes():
    """Keep every Welcome probe (software checks, GPU, RAM) off the host."""
    with (
        patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
        patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
        patch(
            "nexus_installer.pages.prerequisites.detect_total_ram_gb", return_value=32
        ),
    ):
        yield


def _label_texts(widget) -> str:
    from PyQt5.QtWidgets import QLabel

    return " ".join(lbl.text() for lbl in widget.findChildren(QLabel))


class TestStepSequence:
    def test_setup_step_is_gone(self) -> None:
        assert "Setup" not in STEP_NAMES
        assert "Configuration" not in STEP_NAMES
        assert STEP_NAMES[:3] == ["Welcome", "Models", "Review"]
        assert len(STEP_NAMES) == 5

    def test_setup_page_module_is_removed(self) -> None:
        with pytest.raises(ImportError):
            import nexus_installer.pages.setup  # noqa: F401


class TestWelcomeHostsPrerequisites:
    def test_welcome_hosts_the_prerequisites_panel(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage
        from nexus_installer.pages.welcome import WelcomePage

        with _no_probes():
            page = WelcomePage(InstallerState())
            assert isinstance(page._prereq, PrerequisitesPage)
            texts = _label_texts(page)
            for name in ("Prerequisites", "Disk Space", "Ollama", "GPU"):
                assert name in texts
            # The Setup page's title and purpose-less subtitle did not come along.
            assert "Set up this machine" not in texts
            assert "on one screen" not in texts

    def test_hero_is_page_title_scale(self, qt_app) -> None:
        from nexus_installer.pages.welcome import WelcomePage
        from nexus_installer.widgets.gradient_wordmark import GradientWordmark

        with _no_probes():
            page = WelcomePage(InstallerState())
            (hero,) = page.findChildren(GradientWordmark)
            assert hero.full_text() == "Welcome to Nexus AI Studio"
            assert hero.base_px == FS_H1

    def test_before_you_begin_callout_is_replaced_by_the_panel(self, qt_app) -> None:
        from nexus_installer.pages.welcome import WelcomePage

        with _no_probes():
            page = WelcomePage(InstallerState())
            assert "Before you begin" not in _label_texts(page)
            assert not hasattr(page, "_callout")
            assert not hasattr(page, "_worker")

    def test_welcome_hosts_the_configuration_panel(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage
        from nexus_installer.pages.welcome import WelcomePage

        with _no_probes():
            page = WelcomePage(InstallerState())
            assert isinstance(page._config, ConfigurationPage)
            texts = _label_texts(page)
            for head in ("Configuration", "Install path", "Features"):
                assert head in texts
            layout = page.layout()
            assert layout.indexOf(page._prereq) < layout.indexOf(page._config)

    def test_gpu_detection_unlocks_unsloth_on_the_same_page(self, qt_app) -> None:
        from nexus_installer.pages.welcome import WelcomePage

        with _no_probes():
            page = WelcomePage(InstallerState())
            assert page._config._unsloth.isEnabled() is False
            page._prereq._on_gpu("RTX 3080 Ti", "nvidia", 16384)
            assert page._config._unsloth.isEnabled() is True
            assert page._config._unsloth_badge.text() == "Compatible"

    def test_validate_also_requires_a_usable_install_path(self, qt_app) -> None:
        from nexus_installer.pages.welcome import WelcomePage

        with _no_probes():
            page = WelcomePage(InstallerState(install_path=""))
            page._prereq._disk_ok = True
            page._prereq._on_gpu("RTX 3080 Ti", "nvidia", 16384)
            ok, msg = page.validate()
            assert ok is False
            assert "empty" in msg.lower()

    def test_validate_delegates_to_the_panel(self, qt_app, tmp_path) -> None:
        from nexus_installer.pages.welcome import WelcomePage

        with _no_probes():
            # A writable path: this asserts delegation, not whether the
            # host may write to the default install directory.
            page = WelcomePage(InstallerState(install_path=str(tmp_path / "NexusAI")))
            ok, msg = page.validate()
            assert ok is False
            assert "disk" in msg.lower()
            page._prereq._disk_ok = True
            ok, msg = page.validate()
            assert ok is False
            assert "detecting" in msg.lower()
            page._prereq._on_gpu("RTX 3080 Ti", "nvidia", 16384)
            ok, msg = page.validate()
            assert ok is True, msg


class TestGpuPrerequisiteRow:
    def test_gpu_card_sits_top_right(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            page = PrerequisitesPage(InstallerState())
            assert page.rows[1] is page._gpu_row
            assert page._grid.itemAtPosition(0, 1).widget() is page._gpu_row
            assert "Detecting GPU" in page._gpu_row.detail_text

    def test_detection_fills_the_row_and_the_state(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            state = InstallerState()
            state.free_disk_gb = 0
            page = PrerequisitesPage(state)
            page._on_gpu("NVIDIA GeForce RTX 3080 Ti Laptop GPU", "nvidia", 16384)
            assert state.gpu_vendor == "nvidia"
            assert state.gpu_name == "NVIDIA GeForce RTX 3080 Ti Laptop GPU"
            assert state.vram_mb == 16384
            assert state.total_ram_gb == 32
            assert state.free_disk_gb == 0  # RAM never masquerades as disk
            assert state.recommended_model != ""
            # Same style as the other cards: name, VRAM in brackets, no vendor.
            assert page._gpu_row.detail_text == (
                "NVIDIA GeForce RTX 3080 Ti Laptop GPU (16 GB VRAM)"
            )
            assert "Vendor" not in page._gpu_row.detail_text

    def test_15360_mib_reads_as_16_gb(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            page = PrerequisitesPage(InstallerState())
            page._on_gpu("RTX 3080", "nvidia", 15360)
            assert "16 GB VRAM" in page._gpu_row.detail_text
            assert "15360" not in page._gpu_row.detail_text

    def test_no_gpu_is_a_warning_not_a_failure(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            state = InstallerState()
            page = PrerequisitesPage(state)
            page._on_gpu("", "none", 0)
            assert "No dedicated GPU" in page._gpu_row.detail_text
            assert state.gpu_vendor == "none"
            assert state.recommended_model == "gemma4:e2b"
            page._disk_ok = True
            ok, _ = page.validate()
            assert ok is True

    def test_validate_blocks_until_detection(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            page = PrerequisitesPage(InstallerState())
            page._disk_ok = True
            ok, msg = page.validate()
            assert ok is False
            assert "detecting" in msg.lower()
            page._on_gpu("RTX 4090", "nvidia", 24576)
            ok, _ = page.validate()
            assert ok is True

    def test_recheck_restarts_both_probes(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            page = PrerequisitesPage(InstallerState())
            software, gpu = MagicMock(), MagicMock()
            page._worker = software
            page._gpu_worker = gpu
            page._run_detection()
            software.quit.assert_called()
            gpu.finished.disconnect.assert_called()
            gpu.quit.assert_called()
            assert page._worker is not software
            assert page._gpu_worker is not gpu

    def test_single_column_keeps_the_card_order(self, qt_app) -> None:
        from PyQt5.QtCore import QSize
        from PyQt5.QtGui import QResizeEvent

        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            page = PrerequisitesPage(InstallerState())
            page.resizeEvent(QResizeEvent(QSize(400, 400), QSize(800, 400)))
            assert page._grid.itemAtPosition(1, 0).widget() is page._gpu_row
            assert page._grid.itemAtPosition(3, 0).widget() is page._ollama_row
            assert page._grid.itemAtPosition(0, 1) is None


class TestDiskCheck:
    def test_existing_anchor_walks_up_to_existing_dir(self) -> None:
        from nexus_installer.pages.prerequisites import _existing_anchor

        deep = os.path.join(os.path.expanduser("~"), "definitely", "missing", "x")
        assert os.path.isdir(_existing_anchor(deep))

    def test_check_disk_space_probes_an_existing_anchor(self) -> None:
        # The install directory does not exist yet; probing it directly used to
        # raise and report 0 GB free (the amber-dot-with-ample-space bug).
        from nexus_installer.pages.prerequisites import check_disk_space

        usage = MagicMock()
        usage.free = 484 * 1024**3
        deep = os.path.join(os.path.expanduser("~"), "definitely", "missing", "NexusAI")
        with patch(
            "nexus_installer.pages.prerequisites.shutil.disk_usage", return_value=usage
        ) as probe:
            assert check_disk_space(deep) == 484.0
        assert os.path.isdir(probe.call_args[0][0])

    def test_base_install_floor_gates_next(self, qt_app) -> None:
        from nexus_installer.pages.prerequisites import PrerequisitesPage

        with _no_probes():
            state = InstallerState()
            page = PrerequisitesPage(state)
            page._on_disk(BASE_INSTALL_GB - 3.0)
            assert page._disk_ok is False
            assert str(BASE_INSTALL_GB) in page._disk_row.detail_text
            page._on_disk(BASE_INSTALL_GB + 5.0)
            assert page._disk_ok is True
            assert state.free_disk_gb == BASE_INSTALL_GB + 5


class TestSelectableText:
    def test_page_labels_become_selectable_on_switch(self, qt_app) -> None:
        from PyQt5.QtCore import Qt
        from PyQt5.QtWidgets import QLabel, QVBoxLayout, QWidget

        from nexus_installer.window import InstallerWindow

        win = InstallerWindow()
        page = QWidget()
        layout = QVBoxLayout(page)
        label = QLabel("C:/Program Files/NexusAI")
        layout.addWidget(label)
        win.add_page(page)
        win.show_first_page()
        selectable = Qt.TextInteractionFlag.TextSelectableByMouse
        assert label.textInteractionFlags() & selectable
        # Chrome text (the step counter) is selectable too.
        assert win._step_counter.textInteractionFlags() & selectable
        # The clickable help box keeps its labels click-through.
        help_labels = [
            lbl
            for lbl in win.sidebar.findChildren(QLabel)
            if lbl.parentWidget() is not None
            and lbl.parentWidget().objectName() == "helpBox"
        ]
        assert help_labels
        for help_label in help_labels:
            assert not (help_label.textInteractionFlags() & selectable)

    def test_rebuilt_review_rows_are_selectable(self, qt_app) -> None:
        from PyQt5.QtCore import Qt

        from nexus_installer.pages.review import ReviewPage

        page = ReviewPage(InstallerState(selected_model_ids=["gemma4:e4b"]))
        page._rebuild_summary()
        selectable = Qt.TextInteractionFlag.TextSelectableByMouse
        assert page._component_rows
        for row in page._component_rows:
            assert row.textInteractionFlags() & selectable
        for cell in page._category_cells:
            for model_label in cell.model_labels:
                assert model_label.textInteractionFlags() & selectable
