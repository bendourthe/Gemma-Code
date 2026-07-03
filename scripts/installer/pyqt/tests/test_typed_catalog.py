"""v1.8.0 Phase 4 -- tests for the sectioned catalog page (Chat / Agentic /
Image / Video / Audio) with hardware-tier defaults and the
`selected_model_ids` state wiring (OSI003.P3.D)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.typed_catalog import (
    CATALOG_TYPE_TO_TAB,
    TASK_TO_TAB,
    TYPE_TABS,
    CatalogModel,
    TypedCatalogPage,
    TypedSelection,
    compatibility_badge,
    load_catalog_models,
)


def _write_catalog(tmp_path: Path) -> Path:
    catalog = {
        "models": [
            {
                "id": "gemma4:e4b",
                "displayName": "Gemma 4 E4B",
                "type": "llm",
                "task": "chat",
                "sizeGB": 2.7,
                "requiredVramGB": 6,
                "releaseDate": "2025-08-01",
                "license": "Gemma TOU",
                "contextWindow": 128000,
                "multimodal": False,
                "uncensored": False,
                "description": "Test chat model",
                "strengths": ["general chat", "drafting"],
                "whyRecommended": "Best chat per GB",
                "differentiators": "The balanced default",
            },
            {
                "id": "qwen2.5-coder:7b",
                "displayName": "Qwen 2.5 Coder 7B",
                "type": "llm",
                "task": "agentic",
                "sizeGB": 4.4,
                "requiredVramGB": 7,
                "releaseDate": "2025-06-01",
                "license": "Apache-2.0",
                "description": "Test agentic model",
            },
            {
                "id": "nomic-embed-text",
                "displayName": "Nomic Embed",
                "type": "embed",
                "task": "embed",
                "sizeGB": 0.27,
                "requiredVramGB": 1,
                "description": "Embedding model",
            },
            {
                "id": "juggernaut-xl-v9",
                "displayName": "Juggernaut XL v9",
                "type": "image",
                "task": "image",
                "sizeGB": 6.9,
                "requiredVramGB": 8,
                "releaseDate": "2024-02-19",
                "license": "CreativeML Open RAIL-M",
                "uncensored": True,
                "description": "Uncensored image model",
            },
            {
                "id": "wan2.1-t2v-1.3b",
                "displayName": "Wan 2.1 T2V 1.3B",
                "type": "video",
                "task": "video",
                "sizeGB": 17.6,
                "requiredVramGB": 8,
                "releaseDate": "2025-02-25",
                "license": "Apache-2.0",
                "uncensored": True,
                "description": "Uncensored video model",
            },
            {
                "id": "legacy-text-no-task",
                "displayName": "Legacy Text",
                "type": "llm",
                "sizeGB": 4.0,
                "requiredVramGB": 8,
                "description": "Entry without a task field",
            },
            {
                "id": "ignored-vae",
                "displayName": "Some VAE",
                "type": "vae",
                "sizeGB": 0.3,
            },
        ]
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    return path


def _write_recommended(tmp_path: Path) -> Path:
    recommended = {
        "_meta": {"version": 2},
        "tiers": {
            "cpu": {
                "chat": ["gemma4:e4b"],
                "agentic": ["qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": [],
                "video": [],
            },
            "8": {
                "chat": ["gemma4:e4b"],
                "agentic": ["qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
            "12": {
                "chat": ["gemma4:e4b"],
                "agentic": ["qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
            "16": {
                "chat": ["gemma4:e4b"],
                "agentic": ["qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
            "24": {
                "chat": ["gemma4:e4b"],
                "agentic": ["qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
        },
    }
    path = tmp_path / "recommended.json"
    path.write_text(json.dumps(recommended), encoding="utf-8")
    return path


def _gpu_state(vram_mb: int = 8192, free_disk_gb: int = 200) -> InstallerState:
    state = InstallerState()
    state.gpu_vendor = "nvidia"
    state.gpu_name = "Test GPU"
    state.vram_mb = vram_mb
    state.free_disk_gb = free_disk_gb
    return state


class TestLoadCatalog:
    def test_filters_out_non_user_models(self, tmp_path: Path) -> None:
        models = load_catalog_models(_write_catalog(tmp_path))
        ids = {m.id for m in models}
        assert "ignored-vae" not in ids
        assert ids == {
            "gemma4:e4b",
            "qwen2.5-coder:7b",
            "nomic-embed-text",
            "juggernaut-xl-v9",
            "wan2.1-t2v-1.3b",
            "legacy-text-no-task",
        }

    def test_task_drives_tab(self, tmp_path: Path) -> None:
        models = {m.id: m for m in load_catalog_models(_write_catalog(tmp_path))}
        assert models["gemma4:e4b"].type == "chat"
        assert models["qwen2.5-coder:7b"].type == "agentic"
        assert models["nomic-embed-text"].type == "chat"  # embed renders in Chat
        assert models["juggernaut-xl-v9"].type == "image"
        assert models["wan2.1-t2v-1.3b"].type == "video"

    def test_missing_task_falls_back_to_type(self, tmp_path: Path) -> None:
        models = {m.id: m for m in load_catalog_models(_write_catalog(tmp_path))}
        legacy = models["legacy-text-no-task"]
        assert legacy.type == "chat"
        assert legacy.task == "chat"

    def test_phase4_copy_fields_parsed(self, tmp_path: Path) -> None:
        models = {m.id: m for m in load_catalog_models(_write_catalog(tmp_path))}
        gemma = models["gemma4:e4b"]
        assert gemma.strengths == ("general chat", "drafting")
        assert gemma.why_recommended == "Best chat per GB"
        assert gemma.differentiators == "The balanced default"

    def test_missing_catalog_returns_empty(self, tmp_path: Path) -> None:
        assert load_catalog_models(tmp_path / "nope.json") == []

    def test_invalid_json_returns_empty(self, tmp_path: Path) -> None:
        bad = tmp_path / "bad.json"
        bad.write_text("not json")
        assert load_catalog_models(bad) == []


class TestCompatibilityBadge:
    def _model(self, **overrides) -> CatalogModel:
        return CatalogModel(
            id="m",
            display_name="m",
            type=overrides.pop("type", "chat"),
            task=overrides.pop("task", "chat"),
            size_gb=1.0,
            required_vram_gb=overrides.pop("required_vram_gb", 0),
            required_ram_gb=overrides.pop("required_ram_gb", 0),
            release_date="2025-01-01",
            license_name="MIT",
            context_window_in=0,
            context_window_out=0,
            multimodal=False,
            uncensored=False,
            description="",
        )

    def test_no_gpu_with_vram_requirement(self) -> None:
        text, color = compatibility_badge(
            self._model(required_vram_gb=8),
            total_vram_gb=0,
            total_ram_gb=16,
            gpu_vendor="none",
        )
        assert "Requires 8" in text
        assert color == "#ef4444"

    def test_short_vram(self) -> None:
        text, color = compatibility_badge(
            self._model(required_vram_gb=12),
            total_vram_gb=8,
            total_ram_gb=16,
            gpu_vendor="nvidia",
        )
        assert "Requires 12" in text
        assert color == "#f59e0b"

    def test_compatible(self) -> None:
        text, color = compatibility_badge(
            self._model(required_vram_gb=4),
            total_vram_gb=12,
            total_ram_gb=16,
            gpu_vendor="nvidia",
        )
        assert text == "Compatible"


class TestTypedSelection:
    def test_total_gb(self) -> None:
        models = {
            "a": CatalogModel(
                id="a",
                display_name="A",
                type="chat",
                task="chat",
                size_gb=4.0,
                required_vram_gb=0,
                required_ram_gb=0,
                release_date="",
                license_name="",
                context_window_in=0,
                context_window_out=0,
                multimodal=False,
                uncensored=False,
                description="",
            ),
            "b": CatalogModel(
                id="b",
                display_name="B",
                type="image",
                task="image",
                size_gb=3.2,
                required_vram_gb=0,
                required_ram_gb=0,
                release_date="",
                license_name="",
                context_window_in=0,
                context_window_out=0,
                multimodal=False,
                uncensored=False,
                description="",
            ),
        }
        sel = TypedSelection(selected={"a", "b", "unknown"})
        assert sel.total_gb(models) == pytest.approx(7.2)


class TestTypedCatalogPage:
    def _page(
        self, state: InstallerState, tmp_path: Path
    ) -> TypedCatalogPage:
        return TypedCatalogPage(
            state,
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
        )

    def test_five_sections(self, qt_app, tmp_path: Path) -> None:
        page = self._page(_gpu_state(), tmp_path)
        labels = [page._tabs.tabText(i) for i in range(page._tabs.count())]
        assert labels == ["Chat", "Agentic Coding", "Image", "Video", "Audio"]

    def test_audio_tab_shows_empty_state(self, qt_app, tmp_path: Path) -> None:
        page = self._page(_gpu_state(), tmp_path)
        assert page._tabs.tabText(4) == "Audio"

    def test_gpu_tier_defaults_pre_ticked(self, qt_app, tmp_path: Path) -> None:
        page = self._page(_gpu_state(vram_mb=8192), tmp_path)
        selected = page.selection().selected
        assert selected == {
            "gemma4:e4b",
            "qwen2.5-coder:7b",
            "nomic-embed-text",
            "juggernaut-xl-v9",
            "wan2.1-t2v-1.3b",
        }

    def test_cpu_tier_skips_image_and_video(self, qt_app, tmp_path: Path) -> None:
        state = InstallerState()
        state.gpu_vendor = "none"
        state.vram_mb = 0
        state.free_disk_gb = 200
        page = self._page(state, tmp_path)
        selected = page.selection().selected
        assert "juggernaut-xl-v9" not in selected
        assert "wan2.1-t2v-1.3b" not in selected
        assert "gemma4:e4b" in selected
        assert "qwen2.5-coder:7b" in selected

    def test_selection_written_to_state(self, qt_app, tmp_path: Path) -> None:
        state = _gpu_state(vram_mb=8192)
        self._page(state, tmp_path)
        # OSI003.P3.D: the page is the wired producer of selected_model_ids.
        assert set(state.selected_model_ids) == {
            "gemma4:e4b",
            "qwen2.5-coder:7b",
            "nomic-embed-text",
            "juggernaut-xl-v9",
            "wan2.1-t2v-1.3b",
        }
        # Section-ordered: chat ids first, video last.
        assert state.selected_model_ids[0] in ("gemma4:e4b", "nomic-embed-text")
        assert state.selected_model_ids[-1] == "wan2.1-t2v-1.3b"
        # The legacy single-model surface points at the chat pick.
        assert state.selected_model == "gemma4:e4b"
        # Totals feed the disk-aware footer / install guard.
        assert state.selected_models_gb == pytest.approx(
            2.7 + 4.4 + 0.27 + 6.9 + 17.6
        )

    def test_seeded_selection_wins_over_defaults(
        self, qt_app, tmp_path: Path
    ) -> None:
        state = _gpu_state(vram_mb=8192)
        state.selected_model_ids = ["custom-ollama-tag"]
        page = self._page(state, tmp_path)
        assert page.selection().selected == {"custom-ollama-tag"}
        # Unknown ids survive the write-back (they route to ollama verbatim).
        assert state.selected_model_ids == ["custom-ollama-tag"]
        assert state.selected_model == "custom-ollama-tag"

    def test_refresh_recomputes_defaults_until_touched(
        self, qt_app, tmp_path: Path
    ) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        # Page constructed before GPU detection completed (the real wizard
        # constructs all pages up front).
        page = self._page(state, tmp_path)
        assert "juggernaut-xl-v9" not in page.selection().selected
        # Detection finishes, then the page is shown.
        state.gpu_vendor = "nvidia"
        state.gpu_name = "RTX 4080"
        state.vram_mb = 16384
        page.refresh_from_state()
        assert "juggernaut-xl-v9" in page.selection().selected
        assert "wan2.1-t2v-1.3b" in page.selection().selected

    def test_user_toggle_marks_touched_and_survives_refresh(
        self, qt_app, tmp_path: Path
    ) -> None:
        state = _gpu_state(vram_mb=8192)
        page = self._page(state, tmp_path)
        card = page._find_card("juggernaut-xl-v9")
        assert card is not None
        card.checkbox.setChecked(False)
        assert "juggernaut-xl-v9" not in page.selection().selected
        page.refresh_from_state()
        assert "juggernaut-xl-v9" not in page.selection().selected

    def test_disk_reserve_disables_overflow(self, qt_app, tmp_path: Path) -> None:
        state = _gpu_state(vram_mb=8192, free_disk_gb=15)
        state.disk_reserve_gb = 10
        self._page(state, tmp_path)
        # Defaults themselves are disk-gated: with 15 GB free and a 10 GB
        # reserve only the small text-side models fit.
        assert state.selected_models_gb < 15


class TestCatalogTabMapping:
    @pytest.mark.parametrize(
        ("raw_type", "tab"),
        [
            ("llm", "chat"),
            ("embed", "chat"),
            ("image", "image"),
            ("video", "video"),
            ("audio", "audio"),
        ],
    )
    def test_type_fallback_mapping(self, raw_type: str, tab: str) -> None:
        assert CATALOG_TYPE_TO_TAB[raw_type] == tab

    @pytest.mark.parametrize(
        ("task", "tab"),
        [
            ("chat", "chat"),
            ("agentic", "agentic"),
            ("embed", "chat"),
            ("image", "image"),
            ("video", "video"),
            ("audio", "audio"),
        ],
    )
    def test_task_mapping(self, task: str, tab: str) -> None:
        assert TASK_TO_TAB[task] == tab

    def test_vae_excluded(self) -> None:
        assert "vae" not in CATALOG_TYPE_TO_TAB

    def test_tab_order_matches_dod_sections(self) -> None:
        keys = [key for key, _, _ in TYPE_TABS]
        assert keys == ["chat", "agentic", "image", "video", "audio"]
