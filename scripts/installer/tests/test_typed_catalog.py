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


def test_load_catalog_models_excludes_auxiliary_types(tmp_path: Path) -> None:
    """v1.14.0 Phase 1: vae + controlnet are runtime add-ons, never picker rows."""
    catalog = {
        "models": [
            {
                "id": "img-model",
                "displayName": "Img",
                "type": "image",
                "task": "image",
                "sizeGB": 3.2,
                "requiredVramGB": 6,
                "releaseDate": "2025-08-01",
                "description": "d",
            },
            {
                "id": "some-vae",
                "displayName": "VAE",
                "type": "vae",
                "sizeGB": 0.3,
                "requiredVramGB": 1,
                "description": "d",
            },
            {
                "id": "some-controlnet",
                "displayName": "CN",
                "type": "controlnet",
                "sizeGB": 0.7,
                "requiredVramGB": 2,
                "description": "d",
            },
        ]
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    ids = {m.id for m in load_catalog_models(path)}
    assert ids == {"img-model"}


def _write_catalog(tmp_path: Path) -> Path:
    catalog = {
        "models": [
            {
                "id": "gemma4:e4b",
                "displayName": "Gemma 4 E4B",
                "type": "llm",
                "task": "chat",
                "origin": "USA",
                "agentic": True,
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
                "origin": "China",
                "agentic": True,
                "sizeGB": 4.4,
                "requiredVramGB": 7,
                "releaseDate": "2025-06-01",
                "license": "Apache-2.0",
                "description": "Test agentic model",
                "strengths": ["code generation"],
                "differentiators": "Coding specialist",
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
                "agentic": ["gemma4:e4b", "qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": [],
                "video": [],
            },
            "8": {
                "chat": ["gemma4:e4b"],
                "agentic": ["gemma4:e4b", "qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
            "12": {
                "chat": ["gemma4:e4b"],
                "agentic": ["gemma4:e4b", "qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
            "16": {
                "chat": ["gemma4:e4b"],
                "agentic": ["gemma4:e4b", "qwen2.5-coder:7b"],
                "embed": ["nomic-embed-text"],
                "image": ["juggernaut-xl-v9"],
                "video": ["wan2.1-t2v-1.3b"],
            },
            "24": {
                "chat": ["gemma4:e4b"],
                "agentic": ["gemma4:e4b", "qwen2.5-coder:7b"],
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

    def test_origin_and_agentic_parsed(self, tmp_path: Path) -> None:
        # v1.9.0 Phase 4 (T401/T402): origin + agentic capability flag.
        models = {m.id: m for m in load_catalog_models(_write_catalog(tmp_path))}
        assert models["gemma4:e4b"].origin == "USA"
        assert models["gemma4:e4b"].agentic is True
        assert models["qwen2.5-coder:7b"].origin == "China"
        assert models["qwen2.5-coder:7b"].agentic is True
        assert models["juggernaut-xl-v9"].agentic is False

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


class TestModelMetadata:
    """v1.9.0 Phase 4 (T401): guardrails label + required-model derivation."""

    def _model(self, **overrides: object) -> CatalogModel:
        base: dict[str, object] = {
            "id": "m",
            "display_name": "M",
            "type": "chat",
            "task": "chat",
            "size_gb": 1.0,
            "required_vram_gb": 0,
            "required_ram_gb": 0,
            "release_date": "",
            "license_name": "",
            "context_window_in": 0,
            "context_window_out": 0,
            "multimodal": False,
            "uncensored": False,
            "description": "",
        }
        base.update(overrides)
        return CatalogModel(**base)  # type: ignore[arg-type]

    def test_guardrails_uncensored(self) -> None:
        assert self._model(uncensored=True).guardrails_label == "Uncensored"

    def test_guardrails_explicit_override_wins(self) -> None:
        assert self._model(guardrails="Aligned").guardrails_label == "Aligned"

    def test_guardrails_embed_and_audio_are_na(self) -> None:
        assert self._model(task="embed").guardrails_label == "N/A"
        assert self._model(task="audio", type="audio").guardrails_label == "N/A"

    def test_guardrails_default_is_safety_tuned(self) -> None:
        assert self._model(task="chat").guardrails_label == "Safety-tuned"
        img = self._model(task="image", type="image")
        assert img.guardrails_label == "Safety-tuned"

    def test_is_required_is_embed_only(self) -> None:
        assert self._model(task="embed").is_required is True
        assert self._model(task="chat").is_required is False
        assert self._model(task="agentic", type="agentic").is_required is False


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
    def _page(self, state: InstallerState, tmp_path: Path) -> TypedCatalogPage:
        return TypedCatalogPage(
            state,
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
        )

    def test_five_sections(self, qt_app, tmp_path: Path) -> None:
        page = self._page(_gpu_state(), tmp_path)
        # v1.11.0 Phase 6 (T603): a decided category is prefixed with a check
        # mark; strip it to assert the section set + order.
        labels = [
            page._tabs.tabText(i).replace("\u2713 ", "")
            for i in range(page._tabs.count())
        ]
        assert labels == ["Chat", "Agentic", "Image", "Video", "Audio"]

    def test_audio_tab_shows_empty_state(self, qt_app, tmp_path: Path) -> None:
        page = self._page(_gpu_state(), tmp_path)
        assert page._tabs.tabText(4).replace("\u2713 ", "") == "Audio"

    def test_gpu_tier_defaults_pre_ticked(self, qt_app, tmp_path: Path) -> None:
        page = self._page(_gpu_state(vram_mb=8192), tmp_path)
        selected = page.selection().selected
        # v1.9.0 Phase 4: the Gemma chat pick is agentic-capable and covers the
        # agentic section, so no coder is pre-selected (it stays opt-in).
        assert selected == {
            "gemma4:e4b",
            "nomic-embed-text",
            "juggernaut-xl-v9",
            "wan2.1-t2v-1.3b",
        }
        assert "qwen2.5-coder:7b" not in selected

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
        # v1.9.0 Phase 4: the agentic-capable Gemma covers agentic; no coder.
        assert "qwen2.5-coder:7b" not in selected

    def test_selection_written_to_state(self, qt_app, tmp_path: Path) -> None:
        state = _gpu_state(vram_mb=8192)
        self._page(state, tmp_path)
        # OSI003.P3.D: the page is the wired producer of selected_model_ids.
        # v1.9.0 Phase 4: Gemma covers chat + agentic, so no coder is added.
        assert set(state.selected_model_ids) == {
            "gemma4:e4b",
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
        assert state.selected_models_gb == pytest.approx(2.7 + 0.27 + 6.9 + 17.6)

    def test_seeded_selection_wins_over_defaults(self, qt_app, tmp_path: Path) -> None:
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

    def test_agentic_tab_includes_agentic_capable_chat_model(
        self, qt_app, tmp_path: Path
    ) -> None:
        # v1.9.0 Phase 4 (T404): the Agentic tab lists the coding specialist
        # AND the agentic-capable Gemma chat model; the chat model still
        # appears under Chat as its primary tab.
        page = self._page(_gpu_state(), tmp_path)
        agentic_ids = {m.id for m in page._models_for_section("agentic")}
        assert "qwen2.5-coder:7b" in agentic_ids
        assert "gemma4:e4b" in agentic_ids
        chat_ids = {m.id for m in page._models_for_section("chat")}
        assert "gemma4:e4b" in chat_ids
        assert "qwen2.5-coder:7b" not in chat_ids

    def test_agentic_ordering_by_vram_ascending(self, qt_app, tmp_path: Path) -> None:
        # v1.13.0 Phase 4: every tab sorts by required VRAM ascending, with
        # over-budget models forced to the bottom (superseding the old
        # Gemma-first agentic ordering).
        page = self._page(_gpu_state(vram_mb=8192), tmp_path)
        models = page._sorted_section_models("agentic", 8, "nvidia")
        vrams = [m.required_vram_gb for m in models]
        assert vrams == sorted(vrams)

    def test_try_advance_tab_walks_tabs_then_stops(
        self, qt_app, tmp_path: Path
    ) -> None:
        # v1.13.0 Phase 4: Next walks the category tabs, then returns False on
        # the last tab so the wizard proceeds to Configuration.
        page = self._page(_gpu_state(vram_mb=8192), tmp_path)
        page._tabs.setCurrentIndex(0)
        outcomes = [page.try_advance_tab() for _ in range(len(TYPE_TABS))]
        assert outcomes[:-1] == [True] * (len(TYPE_TABS) - 1)
        assert outcomes[-1] is False
        assert page._tabs.currentIndex() == len(TYPE_TABS) - 1

    def test_required_embed_checkbox_locked(self, qt_app, tmp_path: Path) -> None:
        # v1.9.0 Phase 4 (T403): nomic-embed is Required -- checked + locked.
        page = self._page(_gpu_state(), tmp_path)
        card = page._find_card("nomic-embed-text")
        assert card is not None
        assert card.model.is_required
        assert card.checkbox.isChecked() is True
        assert card.checkbox.isEnabled() is False

    def test_cross_tab_checkbox_sync(self, qt_app, tmp_path: Path) -> None:
        # v1.9.0 Phase 4 (T404): gemma4:e4b renders in both Chat and Agentic;
        # toggling the shared selection keeps every card for the id in sync.
        page = self._page(_gpu_state(vram_mb=8192), tmp_path)
        gemma_cards = [c for c in page._cards if c.model.id == "gemma4:e4b"]
        assert len(gemma_cards) == 2
        assert all(c.checkbox.isChecked() for c in gemma_cards)
        gemma_cards[0].checkbox.setChecked(False)
        assert "gemma4:e4b" not in page.selection().selected
        assert all(not c.checkbox.isChecked() for c in gemma_cards)

    def test_refresh_models_resets_to_defaults(self, qt_app, tmp_path: Path) -> None:
        # v1.9.0 Phase 4 (T403): Refresh Models clears manual edits and
        # re-applies the recommended set for the detected hardware.
        page = self._page(_gpu_state(vram_mb=8192), tmp_path)
        card = page._find_card("juggernaut-xl-v9")
        assert card is not None
        card.checkbox.setChecked(False)
        assert "juggernaut-xl-v9" not in page.selection().selected
        page._on_refresh_clicked()
        assert "juggernaut-xl-v9" in page.selection().selected


class TestRealCatalogPage:
    """v1.9.0 Phase 4: the shipped catalog drives the audio pillar + Agentic tab."""

    def test_audio_tab_populated(self, qt_app) -> None:
        state = _gpu_state(vram_mb=8192)
        page = TypedCatalogPage(state)  # real bundled catalog + recommended
        audio_ids = {m.id for m in page._models_for_section("audio")}
        assert audio_ids, "the audio pillar must be populated"
        assert "faster-whisper-large-v3" in audio_ids
        assert "kokoro-82m" in audio_ids

    def test_agentic_tab_sorted_by_vram_ascending(self, qt_app) -> None:
        # v1.13.0 Phase 4: the real-catalog agentic tab is VRAM-ascending, with
        # over-budget variants (e.g. the 18/22 GB Gemmas on an 8 GB GPU) last.
        state = _gpu_state(vram_mb=8192)
        page = TypedCatalogPage(state)
        models = page._sorted_section_models("agentic", 8, "nvidia")
        vrams = [m.required_vram_gb for m in models]
        assert vrams == sorted(vrams)
        # The over-budget variants (>8 GB) come after the fitting ones.
        fits = [m.required_vram_gb <= 8 for m in models]
        assert fits == sorted(fits, reverse=True)

    def test_over_budget_model_disabled(self, qt_app) -> None:
        # v1.13.0 Phase 4: a model needing more VRAM than the GPU has is marked
        # over-budget and its checkbox is disabled (not selectable).
        state = _gpu_state(vram_mb=8192)  # 8 GB nvidia
        page = TypedCatalogPage(state)
        card = page._find_card("gemma4:26b")  # needs 18 GB VRAM
        assert card is not None
        assert card.over_budget is True
        page._update_selection_state()
        assert card.checkbox.isEnabled() is False

    def test_audio_speech_defaults_selected_on_cpu(self, qt_app) -> None:
        # Speech models are CPU-capable and default on every tier.
        state = InstallerState()
        state.gpu_vendor = "none"
        state.vram_mb = 0
        state.free_disk_gb = 200
        page = TypedCatalogPage(state)
        selected = page.selection().selected
        assert "faster-whisper-large-v3" in selected
        assert "kokoro-82m" in selected

    def test_cards_colored_by_provider_not_tab(self, qt_app) -> None:
        # v1.9.0 Phase 6 (T022, DoD #7): cards are colored by the model's
        # provider (family), so a model that appears in both Chat and Agentic
        # shows one consistent color rather than two per-tab colors.
        from collections import defaultdict

        from nexus_installer.constants import provider_color

        state = _gpu_state(vram_mb=24576)
        page = TypedCatalogPage(state)
        page.refresh_from_state()
        accents: dict[str, set[str]] = defaultdict(set)
        for card in page._cards:
            accents[card.model.id].add(card.checkbox.accent)
        multi = {mid: cols for mid, cols in accents.items() if len(cols) > 1}
        assert not multi, f"models colored inconsistently across tabs: {multi}"
        # gemma4:e4b renders in both Chat and Agentic with one Google color.
        assert sum(1 for c in page._cards if c.model.id == "gemma4:e4b") == 2
        assert accents["gemma4:e4b"] == {provider_color("gemma4")}

    def test_provider_legend_lists_multiple_providers(self, qt_app) -> None:
        # v1.9.0 Phase 6 (T025): the color legend names each provider present.
        page = TypedCatalogPage(_gpu_state(vram_mb=8192))
        html = page._provider_legend_html()
        assert html  # the bundled catalog spans several providers
        assert "Google" in html and "Alibaba" in html
        assert not page._legend.isHidden()


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
