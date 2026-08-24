"""v2.2.0 Phase 2 (2.3) -- per-model Ollama version gate + failure classes.

Field evidence: `gemma-4-12b-it-gguf` failed with HTTP 412 ("requires a newer
version of Ollama") on a host where Ollama was already installed. The global
`MIN_OLLAMA_VERSION` floor is only consulted while INSTALLING Ollama, and that
step is skipped when Ollama is already present, so the per-model
`minOllamaVersion` was never enforced anywhere and the log showed only a bare
download URL.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine import ollama_installer as oi
from nexus_installer.engine.model_puller import (
    PULL_FAILURE_CANCELLED,
    PULL_FAILURE_DISK,
    PULL_FAILURE_NETWORK,
    PULL_FAILURE_NOT_FOUND,
    PULL_FAILURE_UNKNOWN,
    PULL_FAILURE_VERSION,
    classify_pull_failure,
    remedy_for_failure,
    summarize_pull_failure,
)
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.ollama_installer"


@pytest.fixture()
def log() -> MagicMock:
    return MagicMock()


class TestClassifyPullFailure:
    def test_412_is_classified_as_too_old(self) -> None:
        message = (
            "Error: pull model manifest: 412: The model you are attempting to "
            "pull requires a newer version of Ollama."
        )
        assert classify_pull_failure(message) == PULL_FAILURE_VERSION

    @pytest.mark.parametrize(
        ("message", "expected"),
        [
            ("connection reset by peer", PULL_FAILURE_NETWORK),
            ("i/o timeout", PULL_FAILURE_NETWORK),
            ("write /models: no space left on device", PULL_FAILURE_DISK),
            ("file does not exist", PULL_FAILURE_NOT_FOUND),
            ("cancelled by user", PULL_FAILURE_CANCELLED),
            ("something inexplicable", PULL_FAILURE_UNKNOWN),
            ("", PULL_FAILURE_UNKNOWN),
        ],
    )
    def test_other_classes(self, message: str, expected: str) -> None:
        assert classify_pull_failure(message) == expected

    def test_every_class_has_an_actionable_remedy(self) -> None:
        for cls in (
            PULL_FAILURE_VERSION,
            PULL_FAILURE_NETWORK,
            PULL_FAILURE_DISK,
            PULL_FAILURE_NOT_FOUND,
            PULL_FAILURE_CANCELLED,
            PULL_FAILURE_UNKNOWN,
        ):
            remedy = remedy_for_failure(cls)
            assert remedy and len(remedy) > 10

    def test_summary_still_prefers_the_reason_over_the_url(self) -> None:
        messages = [
            "pulling manifest",
            "Error: pull model manifest: 412: requires a newer version of Ollama",
            "https://ollama.com/download",
        ]
        summary = summarize_pull_failure(messages, 1)
        assert "newer version" in summary
        assert not summary.startswith("http")


class TestEnsureOllamaSupports:
    def test_entry_without_requirement_passes(self, log: MagicMock) -> None:
        assert oi.ensure_ollama_supports({}, InstallerState(), log).ok is True
        assert oi.ensure_ollama_supports(None, InstallerState(), log).ok is True

    def test_new_enough_ollama_passes_without_upgrading(self, log: MagicMock) -> None:
        with (
            patch.object(oi.OllamaInstaller, "_ollama_version", return_value="0.32.20"),
            patch.object(oi.OllamaInstaller, "install") as install,
        ):
            gate = oi.ensure_ollama_supports(
                {"minOllamaVersion": "0.32.15"}, InstallerState(), log
            )
        assert gate.ok is True
        install.assert_not_called()

    def test_old_ollama_triggers_upgrade_then_passes(self, log: MagicMock) -> None:
        versions = iter(["0.32.9", "0.32.15"])
        with (
            patch.object(
                oi.OllamaInstaller,
                "_ollama_version",
                side_effect=lambda _state: next(versions),
            ),
            patch.object(oi.OllamaInstaller, "install", return_value=True) as install,
        ):
            gate = oi.ensure_ollama_supports(
                {"minOllamaVersion": "0.32.15"},
                InstallerState(ollama_installed=True),
                log,
            )
        assert gate.ok is True
        install.assert_called_once()

    def test_failed_upgrade_reports_actionable_reason(self, log: MagicMock) -> None:
        with (
            patch.object(oi.OllamaInstaller, "_ollama_version", return_value="0.32.9"),
            patch.object(oi.OllamaInstaller, "install", return_value=False),
        ):
            gate = oi.ensure_ollama_supports(
                {"minOllamaVersion": "0.32.15"}, InstallerState(), log
            )
        assert gate.ok is False
        assert "0.32.15" in gate.reason
        assert "ollama-too-old" in gate.reason
        # The user is told what to do, not just what failed.
        assert "ollama.com/download" in gate.reason

    def test_upgrade_that_lands_below_the_requirement_still_fails(
        self, log: MagicMock
    ) -> None:
        with (
            patch.object(oi.OllamaInstaller, "_ollama_version", return_value="0.32.9"),
            patch.object(oi.OllamaInstaller, "install", return_value=True),
        ):
            gate = oi.ensure_ollama_supports(
                {"minOllamaVersion": "0.99.0"}, InstallerState(), log
            )
        assert gate.ok is False
        assert "0.99.0" in gate.reason

    def test_undetectable_version_does_not_block(self, log: MagicMock) -> None:
        # Best-effort: an unknowable version must not stop a working install.
        # The pull's own 412 classification remains the backstop.
        with (
            patch.object(oi.OllamaInstaller, "_ollama_version", return_value=None),
            patch.object(oi.OllamaInstaller, "install") as install,
        ):
            gate = oi.ensure_ollama_supports(
                {"minOllamaVersion": "0.32.15"}, InstallerState(), log
            )
        assert gate.ok is True
        install.assert_not_called()

    def test_gemma_4_12b_catalog_entry_declares_a_requirement(self) -> None:
        """The model that actually failed in the field must carry the field."""
        import json
        from pathlib import Path

        catalog_path = (
            Path(__file__).resolve().parents[3] / "core" / "registry" / "catalog.json"
        )
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        entry = next(m for m in catalog["models"] if m["id"] == "gemma-4-12b-it-gguf")
        assert entry.get("minOllamaVersion"), "gemma-4-12b must pin minOllamaVersion"
