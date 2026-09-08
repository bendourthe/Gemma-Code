"""v2.4.5 Phase 1 (T003) -- already-downloaded model detection.

Field reproduction: the wizard refused an install with `need 204.4 GB free,
have 201.0 GB` on a host where 176 GB of the selected models were already
downloaded and verified. The guard was sizing the whole selection because
nothing in the installer knew what was already on disk.

These tests pin the probe that supplies the missing fact. Every case uses
`tmp_path` fixtures, never the real home directory, so a developer's own
model store cannot make them pass or fail.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from nexus_installer.engine.installed_models import (
    InstalledReport,
    default_ollama_root,
    fetch_ollama_tags,
    huggingface_model_present,
    ollama_manifest_path,
    probe_installed_models,
)

HF_ENTRY = {"id": "sana-video-2b-720p", "source": {"protocol": "huggingface"}}
OLLAMA_ENTRY = {
    "id": "gemma-4-12b-it-gguf",
    "source": {"protocol": "ollama", "url": "ollama://hf.co/Owner/Repo"},
    "tag": "Q4_K_M",
}
PLAIN_OLLAMA_ENTRY = {"id": "embeddinggemma", "source": {"protocol": "ollama"}}


def _weights(models_root: Path, dir_name: str, *, marker: str | None = None) -> Path:
    target = models_root / "weights" / dir_name
    target.mkdir(parents=True, exist_ok=True)
    (target / "model.safetensors").write_bytes(b"x")
    if marker is not None:
        (target / ".nexus-model-id").write_text(marker, encoding="utf-8")
    return target


class TestHuggingFacePresence:
    def test_directory_with_a_file_counts_as_present(self, tmp_path: Path) -> None:
        _weights(tmp_path, "sana-video-2b-720p")
        assert huggingface_model_present(tmp_path, "sana-video-2b-720p") is True

    def test_missing_directory_is_absent(self, tmp_path: Path) -> None:
        assert huggingface_model_present(tmp_path, "sana-video-2b-720p") is False

    def test_empty_directory_is_absent(self, tmp_path: Path) -> None:
        # A directory created by an interrupted run holds no weights, so it
        # must not be reported as a completed download.
        (tmp_path / "weights" / "sana-video-2b-720p").mkdir(parents=True)
        assert huggingface_model_present(tmp_path, "sana-video-2b-720p") is False

    def test_nested_file_counts(self, tmp_path: Path) -> None:
        nested = tmp_path / "weights" / "wan2.1-t2v-1.3b" / "transformer"
        nested.mkdir(parents=True)
        (nested / "diffusion_pytorch_model.safetensors").write_bytes(b"x")
        assert huggingface_model_present(tmp_path, "wan2.1-t2v-1.3b") is True

    def test_marker_matching_the_id_is_accepted(self, tmp_path: Path) -> None:
        _weights(tmp_path, "sana-1.6b-int4", marker="sana-1.6b-int4")
        assert huggingface_model_present(tmp_path, "sana-1.6b-int4") is True

    def test_marker_for_a_different_id_is_rejected(self, tmp_path: Path) -> None:
        # `safe_dir_name` maps ":" and "/" to "-", so two ids can collide on
        # one directory. Claiming another model's weights would report a
        # download that never happened.
        _weights(tmp_path, "a-b", marker="a/b")
        assert huggingface_model_present(tmp_path, "a:b") is False


class TestOllamaManifestPath:
    def test_bare_name_and_tag_use_the_default_registry(self, tmp_path: Path) -> None:
        path = ollama_manifest_path(tmp_path, "embeddinggemma:300m")
        assert path == (
            tmp_path
            / "manifests"
            / "registry.ollama.ai"
            / "library"
            / "embeddinggemma"
            / "300m"
        )

    def test_untagged_name_defaults_to_latest(self, tmp_path: Path) -> None:
        assert ollama_manifest_path(tmp_path, "gemma4").name == "latest"

    def test_hf_target_keeps_its_own_registry(self, tmp_path: Path) -> None:
        path = ollama_manifest_path(tmp_path, "hf.co/LiquidAI/LFM2.5-GGUF:Q4_K_M")
        assert path == (
            tmp_path / "manifests" / "hf.co" / "LiquidAI" / "LFM2.5-GGUF" / "Q4_K_M"
        )


class TestFetchOllamaTags:
    def test_unreachable_ollama_returns_empty_rather_than_raising(self) -> None:
        # Port 1 is reserved and never listening; the probe must degrade.
        assert fetch_ollama_tags("http://127.0.0.1:1", timeout=0.2) == set()


class TestProbe:
    def _sizes(self) -> dict[str, float]:
        return {"sana-video-2b-720p": 18.0, "embeddinggemma": 0.6}

    def test_splits_downloaded_from_pending_with_sizes(self, tmp_path: Path) -> None:
        models_root = tmp_path / "models"
        _weights(models_root, "sana-video-2b-720p")
        report = probe_installed_models(
            selection=["sana-video-2b-720p", "embeddinggemma"],
            catalog={
                "sana-video-2b-720p": HF_ENTRY,
                "embeddinggemma": PLAIN_OLLAMA_ENTRY,
            },
            sizes_gb=self._sizes(),
            models_root=models_root,
            ollama_root=tmp_path / "ollama",
        )
        assert report.downloaded == frozenset({"sana-video-2b-720p"})
        assert report.pending == frozenset({"embeddinggemma"})
        assert report.downloaded_gb == pytest.approx(18.0)
        assert report.pending_gb == pytest.approx(0.6)
        # The split must conserve the selection total, or the Review page and
        # the picker footer would disagree about what was chosen.
        assert report.total_gb == pytest.approx(18.6)

    def test_ollama_model_detected_from_disk_when_the_api_is_down(
        self, tmp_path: Path
    ) -> None:
        ollama_root = tmp_path / "ollama"
        manifest = ollama_manifest_path(ollama_root, "embeddinggemma:300m")
        manifest.parent.mkdir(parents=True)
        manifest.write_text("{}", encoding="utf-8")
        entry = {
            "id": "embeddinggemma",
            "source": {"protocol": "ollama", "url": "ollama://embeddinggemma"},
            "tag": "300m",
        }
        report = probe_installed_models(
            selection=["embeddinggemma"],
            catalog={"embeddinggemma": entry},
            sizes_gb={"embeddinggemma": 0.6},
            models_root=tmp_path / "models",
            ollama_url="http://127.0.0.1:1",  # not listening
            ollama_root=ollama_root,
        )
        assert report.downloaded == frozenset({"embeddinggemma"})
        # The API failure is reported, not swallowed silently.
        assert any("api/tags" in err for err in report.probe_errors)

    def test_ollama_model_detected_from_the_api(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setattr(
            "nexus_installer.engine.installed_models.fetch_ollama_tags",
            lambda url, timeout=2.0: {"embeddinggemma:300m"},
        )
        entry = {
            "id": "embeddinggemma",
            "source": {"protocol": "ollama", "url": "ollama://embeddinggemma"},
            "tag": "300m",
        }
        report = probe_installed_models(
            selection=["embeddinggemma"],
            catalog={"embeddinggemma": entry},
            sizes_gb={"embeddinggemma": 0.6},
            models_root=tmp_path / "models",
            ollama_url="http://127.0.0.1:11434",
            ollama_root=tmp_path / "ollama",
        )
        assert report.downloaded == frozenset({"embeddinggemma"})
        assert report.probe_errors == ()

    def test_uncatalogued_id_routes_to_ollama_and_does_not_raise(
        self, tmp_path: Path
    ) -> None:
        # `qwen3-coding:30b-a3b-offload` was selected in the field but is not
        # in catalog.json; unknown ids pull verbatim (the --model override
        # contract) and must be handled, not crash the picker.
        report = probe_installed_models(
            selection=["qwen3-coding:30b-a3b-offload"],
            catalog={},
            sizes_gb={},
            models_root=tmp_path / "models",
            ollama_root=tmp_path / "ollama",
        )
        assert report.pending == frozenset({"qwen3-coding:30b-a3b-offload"})
        assert report.pending_gb == pytest.approx(0.0)

    def test_empty_selection_is_an_empty_report(self, tmp_path: Path) -> None:
        report = probe_installed_models(
            selection=[],
            catalog={},
            sizes_gb={},
            models_root=tmp_path / "models",
            ollama_root=tmp_path / "ollama",
        )
        assert report.downloaded == frozenset()
        assert report.pending_gb == pytest.approx(0.0)

    def test_accepts_a_generator_selection(self, tmp_path: Path) -> None:
        # The selection is walked twice internally (protocol scan, then the
        # main loop); a generator must not be exhausted by the first pass.
        models_root = tmp_path / "models"
        _weights(models_root, "sana-video-2b-720p")
        report = probe_installed_models(
            selection=(m for m in ["sana-video-2b-720p"]),
            catalog={"sana-video-2b-720p": HF_ENTRY},
            sizes_gb={"sana-video-2b-720p": 18.0},
            models_root=models_root,
            ollama_root=tmp_path / "ollama",
        )
        assert report.downloaded == frozenset({"sana-video-2b-720p"})

    def test_unreadable_models_root_fails_open_to_pending(self, tmp_path: Path) -> None:
        # Fail open: the model is reported pending, which is the old
        # conservative behavior, rather than raising out of the picker load.
        report = probe_installed_models(
            selection=["sana-video-2b-720p"],
            catalog={"sana-video-2b-720p": HF_ENTRY},
            sizes_gb={"sana-video-2b-720p": 18.0},
            models_root=tmp_path / "does-not-exist",
            ollama_root=tmp_path / "ollama",
        )
        assert report.pending == frozenset({"sana-video-2b-720p"})

    def test_reproduces_the_field_case(self, tmp_path: Path) -> None:
        """194 GB selected, 176 GB already on disk -> ~18 GB pending."""
        models_root = tmp_path / "models"
        present = {
            "inkling-small": 70.0,
            "wan2.1-t2v-1.3b": 44.0,
            "sana-video-2b-720p": 18.0,
            "realvisxl-v5": 13.0,
            "ltx-video": 8.8,
            "juggernaut-xl-v9": 6.7,
            "unlimited-ocr-3b": 6.3,
            "sana-1.6b-2k": 6.1,
            "faster-whisper-large-v3": 2.9,
            "sana-1.6b-int4": 1.4,
            "kokoro-82m": 0.3,
        }
        absent = {"a-new-video-model": 18.0}
        for model_id in present:
            _weights(models_root, model_id)
        sizes = {**present, **absent}
        catalog = {
            mid: {"id": mid, "source": {"protocol": "huggingface"}} for mid in sizes
        }

        report = probe_installed_models(
            selection=list(sizes),
            catalog=catalog,
            sizes_gb=sizes,
            models_root=models_root,
            ollama_root=tmp_path / "ollama",
        )

        assert report.downloaded == frozenset(present)
        assert report.pending == frozenset(absent)
        assert report.downloaded_gb == pytest.approx(sum(present.values()))
        # The number the guard should have been comparing all along.
        assert report.pending_gb == pytest.approx(18.0)


class TestReportDefaults:
    def test_empty_report_is_safe_to_read(self) -> None:
        report = InstalledReport()
        assert report.is_downloaded("anything") is False
        assert report.total_gb == pytest.approx(0.0)
        assert report.probe_errors == ()


def test_default_ollama_root_is_under_home(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OLLAMA_MODELS", raising=False)
    assert default_ollama_root() == Path.home() / ".ollama" / "models"


def test_default_ollama_root_honors_ollama_models_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # A relocated store must still count its pulled models as downloaded, or
    # none of them would be pre-selected on the Models page.
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path / "store"))
    assert default_ollama_root() == tmp_path / "store"


def test_manifest_json_is_not_parsed(tmp_path: Path) -> None:
    # Presence, not validity: a corrupt manifest still means the model was
    # pulled, and the install path is what repairs it.
    manifest = ollama_manifest_path(tmp_path, "gemma4:12b")
    manifest.parent.mkdir(parents=True)
    manifest.write_text("{not json", encoding="utf-8")
    entry = {
        "id": "gemma4",
        "source": {"protocol": "ollama", "url": "ollama://gemma4"},
        "tag": "12b",
    }
    report = probe_installed_models(
        selection=["gemma4"],
        catalog={"gemma4": entry},
        sizes_gb={"gemma4": 8.0},
        models_root=tmp_path / "models",
        ollama_root=tmp_path,
    )
    assert report.downloaded == frozenset({"gemma4"})
