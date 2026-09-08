"""Tests for wizard pages requiring QApplication."""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import patch

import pytest

from nexus_installer.installer_state import InstallerState


@contextmanager
def _no_probes():
    """Keep the Welcome/prerequisites probes (software + GPU) off the host."""
    with (
        patch("nexus_installer.pages.prerequisites._DetectionWorker.start"),
        patch("nexus_installer.pages.gpu_detection._GpuDetectionWorker.start"),
    ):
        yield


class TestWelcomePage:
    def test_creates_without_crash(self, qt_app: object) -> None:
        with _no_probes():
            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            assert page is not None

    def test_copy_names_nexus_not_gemma_code(self, qt_app: object) -> None:
        """v1.8.0 Phase 5 (T503) -- the welcome copy sells the product."""
        with _no_probes():
            from PyQt5.QtWidgets import QLabel

            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            all_text = " ".join(lbl.text() for lbl in page.findChildren(QLabel))
            assert "Nexus" in all_text
            assert "Gemma Code" not in all_text

    def test_pillar_chips_present(self, qt_app: object) -> None:
        with _no_probes():
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
        with _no_probes():
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
        with _no_probes():
            from nexus_installer.pages.welcome import WelcomePage

            state = InstallerState()
            page = WelcomePage(state)
            assert not hasattr(page, "_logo")


class TestPrerequisitesPage:
    def test_creates_and_has_validate(self, qt_app: object) -> None:
        with _no_probes():
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            assert hasattr(page, "validate")

    def test_validate_fails_without_disk(self, qt_app: object) -> None:
        with _no_probes():
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            page._disk_ok = False
            page._gpu_done = True
            ok, msg = page.validate()
            assert ok is False
            assert "disk" in msg.lower()

    def test_validate_passes_when_disk_and_gpu_ok(self, qt_app: object) -> None:
        with _no_probes():
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            page._disk_ok = True
            page._gpu_done = True
            ok, _ = page.validate()
            assert ok is True

    def test_vscode_is_not_a_prerequisite(self, qt_app: object) -> None:
        # The extension feature detects VS Code and disables itself instead.
        with _no_probes():
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            assert not hasattr(page, "_vscode_row")
            names = [row._name.text() for row in page.rows]
            assert names == ["Disk Space", "GPU", "Python 3.11+", "Ollama"]

    def test_recheck_is_icon_not_button(self, qt_app: object) -> None:
        with _no_probes():
            from PyQt5.QtWidgets import QPushButton, QToolButton

            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            assert not any(
                btn.text() == "Re-check" for btn in page.findChildren(QPushButton)
            )
            tools = [
                t
                for t in page.findChildren(QToolButton)
                if t.accessibleName() == "Re-check"
            ]
            assert len(tools) == 1

    def test_recheck_replaces_inflight_worker(self, qt_app: object) -> None:
        with _no_probes():
            from unittest.mock import MagicMock

            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            first = MagicMock()
            first.isRunning.return_value = True
            page._worker = first
            page._run_detection()
            first.python_result.disconnect.assert_called()
            first.quit.assert_called()
            first.wait.assert_called()

    def test_prereqs_two_columns_then_stack(self, qt_app: object) -> None:
        with _no_probes():
            from PyQt5.QtCore import QSize
            from PyQt5.QtGui import QResizeEvent

            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            page.resizeEvent(QResizeEvent(QSize(800, 400), QSize(800, 400)))
            grid = page._grid
            # Disk top-left, GPU top-right, Python bottom-left, Ollama bottom-right.
            assert grid.itemAtPosition(0, 0).widget() is page._disk_row
            assert grid.itemAtPosition(0, 1).widget() is page._gpu_row
            assert grid.itemAtPosition(1, 0).widget() is page._python_row
            assert grid.itemAtPosition(1, 1).widget() is page._ollama_row
            page.resizeEvent(QResizeEvent(QSize(400, 400), QSize(800, 400)))
            assert grid.itemAtPosition(0, 0).widget() is page._disk_row
            assert grid.itemAtPosition(1, 0).widget() is page._gpu_row
            empty = grid.itemAtPosition(0, 1)
            assert empty is None or empty.widget() is None

    def test_prereq_callbacks_and_row_states(self, qt_app: object) -> None:
        with _no_probes():
            from nexus_installer.pages.prerequisites import PrerequisitesPage

            page = PrerequisitesPage(InstallerState())
            page._on_python("", "")
            page._on_python(r"C:\Python\python.exe", "3.12.3")
            page._on_ollama(False, "")
            page._on_ollama(True, "0.11.0")
            page._on_disk(3.0)
            page._on_disk(7.0)
            page._on_disk(80.0)
            page._disk_row.set_found("ok")
            page._disk_row.set_missing("no")
            page._disk_row.set_warning("warn")
            page._on_gpu("RTX 3080 Ti", "nvidia", 16384)
            ok, _ = page.validate()
            assert ok is True


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

    def test_facts_and_models_are_separate_cards(self, qt_app: object) -> None:
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
        assert page._facts_card.property("reviewColumn") == "facts"
        assert page._models_card.property("reviewColumn") == "models"
        assert page._path_label.text() == r"C:\Program Files\NexusAI"
        assert page._path_label.parentWidget().parentWidget() is page._facts_card
        # The estimates are model facts: they live in the Model Summary card.
        for tile in page._tiles.values():
            assert tile.parentWidget() is page._models_card
        assert "16 GB VRAM" in page._gpu_pill.text()
        assert "16384" not in page._gpu_pill.text()
        names = " ".join(cell.names_text() for cell in page._category_cells)
        assert "embedding-gemma" in names
        assert "embedding-gemma" not in page._path_label.text()

    def test_zero_vram_omits_gb_suffix(self, qt_app: object) -> None:
        from nexus_installer.pages.review import ReviewPage

        page = ReviewPage(InstallerState(gpu_name="", vram_mb=0))
        page._rebuild_summary()
        pill = page._gpu_pill.text()
        assert "None detected" in pill
        assert "GB VRAM" not in pill
        assert "0 GB" not in pill

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


class TestWizardDensityV247:
    """v2.4.7 Phase 3 (T014) -- Install Path and Configuration layout.

    Screenshot 1: Browse sat outside a narrowed path field.
    Screenshot 2: the Ollama URL spanned the page under both columns, and a
    blue detection paragraph sat under the VS Code checkbox.
    """

    def test_path_field_spans_the_row_with_browse_inside_it(
        self, qt_app: object
    ) -> None:
        from nexus_installer.pages.install_path import InstallPathPage

        page = InstallPathPage(InstallerState())
        # Browse is a child of the field, not a sibling in a shared row.
        assert page._browse_btn.parentWidget() is page._path_input
        # Typed text is kept clear of the overlaid button.
        margins = page._path_input.textMargins()
        assert margins.right() > 0

    def test_browse_stays_clickable_and_named(self, qt_app: object) -> None:
        from nexus_installer.pages.install_path import InstallPathPage

        page = InstallPathPage(InstallerState())
        assert page._browse_btn.isEnabled() is True
        assert "Browse" in page._browse_btn.text()
        assert page._path_input.isReadOnly() is False

    def test_disk_and_error_lines_remain_under_the_field(self, qt_app: object) -> None:
        from nexus_installer.pages.install_path import InstallPathPage

        page = InstallPathPage(InstallerState())
        assert page._disk_label is not None
        assert page._error_label is not None

    def test_compact_vscode_row_has_no_detection_paragraph(
        self, qt_app: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from nexus_installer.engine.extension_installer import VsCodeCliStatus
        from nexus_installer.pages.configuration import ConfigurationPage

        monkeypatch.setattr(
            "nexus_installer.pages.vscode_extension.detect_vscode_cli",
            lambda: VsCodeCliStatus(None, None, None, False, "not-found"),
        )
        page = ConfigurationPage(InstallerState())
        assert page._vscode._detection_label.isVisibleTo(page._vscode) is False

    def test_detection_still_drives_the_checkbox(self, qt_app: object) -> None:
        # Removing the paragraph must not remove the information: an
        # uninstallable extension still disables the box and explains itself.
        #
        # Detection is INJECTED rather than read from the host. Written as a
        # conditional against real detection, this passed vacuously on a
        # machine with VS Code installed and only ran on CI -- where it caught
        # a real gap, because the tooltip was set on refresh but not at
        # construction.
        from nexus_installer.pages.vscode_extension import VsCodeExtensionPage

        class _Detection:
            def __init__(self, supported: bool) -> None:
                self.supported = supported
                self.version = "1.1.0"
                self.path = "/usr/bin/code"
                self.cli_name = "code"
                self.reason = "ok" if supported else "not-found"

        unsupported = VsCodeExtensionPage(
            InstallerState(), detect_fn=lambda: _Detection(False), compact=True
        )
        assert unsupported._checkbox.isEnabled() is False
        assert unsupported._checkbox.toolTip().strip()

        supported = VsCodeExtensionPage(
            InstallerState(), detect_fn=lambda: _Detection(True), compact=True
        )
        assert supported._checkbox.isEnabled() is True
        # No tooltip when there is nothing to explain.
        assert supported._checkbox.toolTip() == ""
