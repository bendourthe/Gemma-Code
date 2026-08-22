"""Hardware-tier default matrix tests.

Runs the real `core/registry/catalog.json` + `recommended.json` through
`nexus_installer.tier_defaults` for every simulated GPU tier (8 / 12 / 16 /
24 GB + CPU-only) and asserts the tier contract: the default selection fits
VRAM and disk, always includes a chat model plus agentic coverage (the embed
model the memory layer needs and the CPU-capable speech models too), and
includes uncensored image + video defaults exactly on the tiers whose
hardware fits them. v1.9.0 Phase 4: agentic coverage may come from an
agentic-capable chat model (a Gemma 4 variant) rather than a distinct coder.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from nexus_installer.pages.typed_catalog import CatalogModel, load_catalog_models
from nexus_installer.tier_defaults import (
    GUARANTEED_SECTIONS,
    SECTION_ORDER,
    TIER_ORDER,
    default_selection,
    load_tier_matrix,
    resolve_tier,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO_ROOT / "core" / "registry" / "catalog.json"
RECOMMENDED_PATH = REPO_ROOT / "core" / "registry" / "recommended.json"

SIMULATED_FREE_DISK_GB = 500
RESERVE_GB = 10


def _models() -> dict[str, CatalogModel]:
    models = {m.id: m for m in load_catalog_models(CATALOG_PATH)}
    assert models, "real catalog must load"
    return models


def _matrix() -> dict[str, dict[str, list[str]]]:
    matrix = load_tier_matrix(RECOMMENDED_PATH)
    assert matrix, "real recommended.json must carry a tiers matrix"
    return matrix


class TestResolveTier:
    @pytest.mark.parametrize(
        ("vram_mb", "vendor", "expected"),
        [
            (0, "none", "cpu"),
            (0, "", "cpu"),
            (-1, "nvidia", "cpu"),
            (8192, "none", "cpu"),
            (4096, "nvidia", "8"),
            (6144, "nvidia", "8"),
            (8192, "nvidia", "8"),
            (11264, "nvidia", "8"),
            (12288, "amd", "12"),
            (16384, "nvidia", "16"),
            (20480, "nvidia", "16"),
            (24576, "nvidia", "24"),
            (49152, "apple", "24"),
        ],
    )
    def test_resolution(self, vram_mb: int, vendor: str, expected: str) -> None:
        assert resolve_tier(vram_mb, vendor) == expected

    def test_every_resolvable_tier_exists_in_matrix(self) -> None:
        matrix = _matrix()
        for tier in TIER_ORDER:
            assert tier in matrix, f"recommended.json missing tier {tier}"


class TestRealMatrixDefaults:
    """The T404 matrix: real catalog + real recommended.json per tier."""

    @pytest.mark.parametrize("tier_vram", [8, 12, 16, 24])
    def test_gpu_tier_contract(self, tier_vram: int) -> None:
        models = _models()
        tier = str(tier_vram)
        ids = default_selection(
            models,
            _matrix(),
            tier,
            vram_gb=tier_vram,
            free_disk_gb=SIMULATED_FREE_DISK_GB,
            reserve_gb=RESERVE_GB,
        )
        assert ids, f"tier {tier} produced no defaults"

        by_task: dict[str, list[str]] = {}
        for mid in ids:
            assert mid in models, f"default {mid} is not a catalog entry"
            model = models[mid]
            assert model.required_vram_gb <= tier_vram, (
                f"default {mid} needs {model.required_vram_gb} GB VRAM "
                f"but tier {tier} budgets {tier_vram}"
            )
            by_task.setdefault(model.task, []).append(mid)

        # Composition: always a chat model + agentic coverage (+ the embed
        # support model), plus image, video, and speech on every GPU tier.
        # v1.9.0 Phase 4: agentic coverage can come from an agentic-capable
        # chat model (a Gemma 4 variant) rather than a distinct coder.
        agentic_covered = any(
            models[mid].task == "agentic" or models[mid].agentic for mid in ids
        )
        assert by_task.get("chat"), f"tier {tier}: no chat default"
        assert agentic_covered, f"tier {tier}: no agentic-capable default"
        assert by_task.get("embed"), f"tier {tier}: no embed default"
        assert by_task.get("image"), f"tier {tier}: no image default"
        assert by_task.get("video"), f"tier {tier}: no video default"
        assert by_task.get("audio"), f"tier {tier}: no audio (speech) default"

        # Product decision: image + video defaults are uncensored entries.
        for mid in by_task["image"] + by_task["video"]:
            assert models[mid].uncensored, (
                f"tier {tier}: default {mid} must be an uncensored entry"
            )

        # Disk fit: the whole default selection respects the OS reserve.
        total_gb = sum(models[mid].size_gb for mid in ids)
        assert SIMULATED_FREE_DISK_GB - total_gb >= RESERVE_GB

    def test_cpu_tier_contract(self) -> None:
        models = _models()
        ids = default_selection(
            models,
            _matrix(),
            "cpu",
            vram_gb=0,
            free_disk_gb=SIMULATED_FREE_DISK_GB,
            reserve_gb=RESERVE_GB,
        )
        tasks = {models[mid].task for mid in ids}
        agentic_covered = any(
            models[mid].task == "agentic" or models[mid].agentic for mid in ids
        )
        assert "chat" in tasks
        assert agentic_covered
        assert "lfm2.5:2.6b" in ids, (
            "cpu tier must default the dedicated sub-4 GB agentic pick"
        )
        assert "embed" in tasks
        assert "audio" in tasks, "cpu tier still gets the CPU-capable speech models"
        assert "image" not in tasks, "cpu tier must not select image models"
        assert "video" not in tasks, "cpu tier must not select video models"

    def test_sub_tier_gpu_degrades_gracefully(self) -> None:
        # A 6 GB GPU uses the 8 GB matrix: the chat Gemma (6 GB) fits and, as
        # an agentic-capable model, also covers the agentic section; image and
        # video are fit-gated out rather than substituted.
        models = _models()
        ids = default_selection(
            models,
            _matrix(),
            "8",
            vram_gb=6,
            free_disk_gb=SIMULATED_FREE_DISK_GB,
            reserve_gb=RESERVE_GB,
        )
        tasks = {models[mid].task for mid in ids}
        agentic_covered = any(
            models[mid].task == "agentic" or models[mid].agentic for mid in ids
        )
        assert "chat" in tasks
        assert agentic_covered
        assert "image" not in tasks
        assert "video" not in tasks

    def test_every_matrix_id_is_real_and_downloadable(self) -> None:
        # Every id in the matrix exists in the catalog, carries a source,
        # and HF-sourced entries carry a weights manifest (the download
        # path the installer's weights puller consumes).
        raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        index = {m["id"]: m for m in raw["models"]}
        for tier, sections in _matrix().items():
            for section, ids in sections.items():
                assert section in SECTION_ORDER
                for mid in ids:
                    assert mid in index, f"{tier}/{section}: {mid} not in catalog"
                    entry = index[mid]
                    protocol = entry["source"]["protocol"]
                    if protocol == "huggingface":
                        files = entry["weights"]["files"]
                        assert files, f"{mid}: HF entry without weights manifest"

    @pytest.mark.parametrize("tier_vram", [8, 12, 16, 24])
    def test_gemma_covers_agentic_without_redundant_coder(self, tier_vram: int) -> None:
        # v1.9.0 Phase 4 (T404): the chat pick is an agentic-capable Gemma 4
        # variant, so it also covers the agentic section -- no coding
        # specialist is pre-selected (coders stay opt-in).
        models = _models()
        ids = default_selection(
            models,
            _matrix(),
            str(tier_vram),
            vram_gb=tier_vram,
            free_disk_gb=SIMULATED_FREE_DISK_GB,
            reserve_gb=RESERVE_GB,
        )
        assert any(models[mid].agentic and models[mid].task == "chat" for mid in ids), (
            f"tier {tier_vram}: no agentic-capable Gemma covering agentic"
        )
        coders = [mid for mid in ids if models[mid].task == "agentic"]
        assert not coders, f"tier {tier_vram}: unexpected coder default {coders}"

    def test_sub_6gb_gpu_selects_lfm_agentic_fallback(self) -> None:
        # A 4 GB GPU uses the 8 GB matrix: gemma4:e4b (6 GB) does not fit, so
        # chat falls back to gemma4:e2b and agentic takes LFM2.5-2.6B (3 GB)
        # instead of the 7B coder.
        models = _models()
        ids = default_selection(
            models,
            _matrix(),
            "8",
            vram_gb=4,
            free_disk_gb=SIMULATED_FREE_DISK_GB,
            reserve_gb=RESERVE_GB,
        )
        assert "lfm2.5:2.6b" in ids
        assert "qwen2.5-coder:7b" not in ids
        assert "qwen3.5:9b" not in ids
        assert "gemma4:e4b" not in ids

    def test_higher_tiers_do_not_default_lfm(self) -> None:
        models = _models()
        for tier, vram in [("8", 8), ("12", 12), ("16", 16), ("24", 24)]:
            ids = default_selection(
                models,
                _matrix(),
                tier,
                vram_gb=vram,
                free_disk_gb=SIMULATED_FREE_DISK_GB,
                reserve_gb=RESERVE_GB,
            )
            assert "lfm2.5:2.6b" not in ids, f"tier {tier}: LFM must stay opt-in"

    def test_audio_speech_defaults_on_every_tier(self) -> None:
        # STT + TTS default on every tier (permissive + CPU-capable); the
        # non-commercial generation models are never defaults.
        models = _models()
        for tier, vram in [("cpu", 0), ("8", 8), ("12", 12), ("16", 16), ("24", 24)]:
            ids = default_selection(
                models,
                _matrix(),
                tier,
                vram_gb=vram,
                free_disk_gb=SIMULATED_FREE_DISK_GB,
                reserve_gb=RESERVE_GB,
            )
            assert "faster-whisper-large-v3" in ids, f"tier {tier}: no STT default"
            assert "kokoro-82m" in ids, f"tier {tier}: no TTS default"
            assert "musicgen-medium" not in ids
            assert "stable-audio-open-1.0" not in ids

    def test_matrix_sections_match_entry_tasks(self) -> None:
        # v1.9.0 Phase 4: the agentic section may list agentic-capable chat
        # models (the Gemma 4 family, task == "chat") in addition to coders.
        models = _models()
        for tier, sections in _matrix().items():
            for section, ids in sections.items():
                for mid in ids:
                    model = models[mid]
                    if section == "agentic":
                        assert model.task == "agentic" or model.agentic, (
                            f"{tier}/agentic: {mid} is neither a coder nor "
                            f"agentic-capable (task={model.task})"
                        )
                    else:
                        assert model.task == section, (
                            f"{tier}/{section}: {mid} has task {model.task}"
                        )


@dataclass
class _FakeModel:
    id: str
    task: str
    size_gb: float
    required_vram_gb: int
    agentic: bool = False


class TestFallbackLogic:
    """Synthetic-matrix edge cases for the guaranteed-section fallback."""

    def _models(self) -> dict[str, _FakeModel]:
        entries = [
            _FakeModel("chat-small", "chat", 2.0, 4),
            _FakeModel("chat-mid", "chat", 8.0, 12),
            _FakeModel("chat-big", "chat", 20.0, 24),
            _FakeModel("agentic-small", "agentic", 4.0, 7),
            _FakeModel("agentic-big", "agentic", 9.0, 14),
            _FakeModel("image-a", "image", 7.0, 8),
            _FakeModel("video-a", "video", 17.0, 8),
        ]
        return {m.id: m for m in entries}

    def test_unfit_matrix_pick_falls_back_to_largest_fitting(self) -> None:
        matrix = {"12": {"chat": ["chat-big"], "agentic": ["agentic-big"]}}
        ids = default_selection(
            self._models(), matrix, "12", vram_gb=12, free_disk_gb=500, reserve_gb=10
        )
        # chat-big (24 GB) does not fit 12 -> chat-mid (12) is the largest fit;
        # agentic-big (14) does not fit -> agentic-small (7) fits.
        assert "chat-mid" in ids
        assert "agentic-small" in ids
        assert "chat-big" not in ids

    def test_nothing_fits_vram_picks_smallest_of_task(self) -> None:
        models = {
            "chat-big": _FakeModel("chat-big", "chat", 20.0, 24),
            "chat-huge": _FakeModel("chat-huge", "chat", 39.0, 40),
            "agentic-big": _FakeModel("agentic-big", "agentic", 9.0, 14),
        }
        matrix = {"8": {"chat": ["chat-huge"], "agentic": ["agentic-big"]}}
        ids = default_selection(
            models, matrix, "8", vram_gb=8, free_disk_gb=500, reserve_gb=10
        )
        # RAM-offload fallback: the smallest download of each task.
        assert "chat-big" in ids
        assert "agentic-big" in ids

    def test_non_guaranteed_sections_are_not_substituted(self) -> None:
        matrix = {
            "8": {
                "chat": ["chat-small"],
                "agentic": ["agentic-small"],
                "image": ["image-missing"],
                "video": [],
            }
        }
        ids = default_selection(
            self._models(), matrix, "8", vram_gb=8, free_disk_gb=500, reserve_gb=10
        )
        tasks = {self._models()[mid].task for mid in ids if mid in self._models()}
        assert "image" not in tasks
        assert "video" not in tasks

    def test_disk_gating_drops_late_sections(self) -> None:
        matrix = {
            "8": {
                "chat": ["chat-small"],
                "agentic": ["agentic-small"],
                "image": ["image-a"],
                "video": ["video-a"],
            }
        }
        # 25 GB free, 10 reserve: chat (2) + agentic (4) + image (7) = 13,
        # video (17) would breach the reserve and is dropped.
        ids = default_selection(
            self._models(), matrix, "8", vram_gb=8, free_disk_gb=25, reserve_gb=10
        )
        assert "video-a" not in ids
        assert "image-a" in ids

    def test_unknown_disk_allows_selection(self) -> None:
        matrix = {
            "8": {
                "chat": ["chat-small"],
                "agentic": ["agentic-small"],
                "video": ["video-a"],
            }
        }
        ids = default_selection(
            self._models(), matrix, "8", vram_gb=8, free_disk_gb=0, reserve_gb=10
        )
        assert "video-a" in ids

    def test_wrong_task_section_pairing_is_skipped(self) -> None:
        matrix = {"8": {"chat": ["agentic-small", "chat-small"]}}
        ids = default_selection(
            self._models(), matrix, "8", vram_gb=8, free_disk_gb=500, reserve_gb=10
        )
        assert "chat-small" in ids
        # agentic-small was listed under chat: rejected there, then picked
        # by the agentic guarantee itself.
        assert GUARANTEED_SECTIONS == ("chat", "agentic")
        assert "agentic-small" in ids

    def test_empty_matrix_still_guarantees_chat_and_agentic(self) -> None:
        ids = default_selection(
            self._models(), {}, "8", vram_gb=8, free_disk_gb=500, reserve_gb=10
        )
        tasks = {self._models()[mid].task for mid in ids}
        assert "chat" in tasks
        assert "agentic" in tasks

    def test_agentic_capable_chat_covers_agentic_no_coder(self) -> None:
        # v1.9.0 Phase 4: a Gemma-style agentic-capable chat model chosen for
        # chat also covers the agentic section, so no coder is added.
        models = {
            "gemma": _FakeModel("gemma", "chat", 3.0, 6, agentic=True),
            "coder": _FakeModel("coder", "agentic", 4.0, 7),
        }
        matrix = {"8": {"chat": ["gemma"], "agentic": ["gemma", "coder"]}}
        ids = default_selection(
            models, matrix, "8", vram_gb=8, free_disk_gb=500, reserve_gb=10
        )
        assert "gemma" in ids
        assert "coder" not in ids

    def test_coder_is_in_list_fallback_when_no_gemma_fits(self) -> None:
        # When the agentic list's Gemma does not fit, the coder below it in the
        # priority list is taken instead.
        models = {
            "chat-small": _FakeModel("chat-small", "chat", 2.0, 4),
            "gemma-big": _FakeModel("gemma-big", "chat", 20.0, 24, agentic=True),
            "coder": _FakeModel("coder", "agentic", 4.0, 7),
        }
        matrix = {"8": {"chat": ["chat-small"], "agentic": ["gemma-big", "coder"]}}
        ids = default_selection(
            models, matrix, "8", vram_gb=8, free_disk_gb=500, reserve_gb=10
        )
        assert "chat-small" in ids
        assert "coder" in ids
        assert "gemma-big" not in ids
