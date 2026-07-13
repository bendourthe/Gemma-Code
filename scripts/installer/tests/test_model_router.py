"""Tests for the protocol-routed model step (v1.8.0 Phase 3, T304).

Covers catalog lookup, protocol resolution, multi-selection handling,
weighted mixed-protocol progress aggregation, per-model failure
isolation, and cancel forwarding.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from nexus_installer.engine.model_router import (
    ModelStepRouter,
    default_catalog_path,
    load_catalog_index,
    ollama_target_for,
    protocol_for,
    resolve_selected_models,
)
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.model_router"

_PLACEHOLDER = "0" * 64


class TestOllamaTargetResolution:
    def test_resolves_hf_gguf_url_with_quant_tag(self) -> None:
        # Regression: the display id is not a real ollama tag; the source.url
        # host/path + quant tag is (the gemma-4-12b-it-gguf "file does not
        # exist" bug).
        entry = {
            "id": "gemma-4-12b-it-gguf",
            "tag": "Q4_K_XL",
            "source": {
                "protocol": "ollama",
                "url": "ollama://hf.co/unsloth/gemma-4-12b-it-GGUF",
            },
        }
        assert (
            ollama_target_for(entry, "gemma-4-12b-it-gguf")
            == "hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL"
        )

    def test_registry_url_keeps_inline_tag(self) -> None:
        entry = {"source": {"protocol": "ollama", "url": "ollama://gemma4:31b"}}
        assert ollama_target_for(entry, "gemma4-31b") == "gemma4:31b"

    def test_falls_back_to_id_without_entry(self) -> None:
        assert ollama_target_for(None, "llama3.1:8b") == "llama3.1:8b"

    def test_falls_back_to_id_without_ollama_url(self) -> None:
        entry = {"source": {"protocol": "huggingface", "url": "https://hf.co/x"}}
        assert ollama_target_for(entry, "some-id") == "some-id"


def _write_catalog(tmp_path: Path) -> Path:
    """A minimal mixed-protocol catalog for routing tests."""
    catalog = {
        "models": [
            {
                "id": "gemma4:e4b",
                "sizeGB": 2.7,
                "source": {"protocol": "ollama", "url": "ollama://gemma4:e4b"},
            },
            {
                "id": "sana-1.6b-int4",
                "sizeGB": 1.4,
                "source": {
                    "protocol": "huggingface",
                    "repo": "Efficient-Large-Model/SANA1.5_1.6B_1024px_int4",
                    "url": "",
                },
                "weights": {
                    "layoutVersion": 1,
                    "files": [
                        {
                            "path": "transformer/x.safetensors",
                            "sha256": _PLACEHOLDER,
                        }
                    ],
                },
            },
            {
                "id": "ltx-video",
                "sizeGB": 13.0,
                "source": {
                    "protocol": "huggingface",
                    "repo": "Lightricks/LTX-Video",
                    "url": "",
                },
                "weights": {
                    "layoutVersion": 1,
                    "files": [
                        {"path": "ltx.safetensors", "sha256": _PLACEHOLDER}
                    ],
                },
            },
        ]
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    return path


class TestDefaultCatalogPath:
    def test_finds_repo_catalog(self) -> None:
        path = default_catalog_path()
        assert path.is_file()
        assert path.name == "catalog.json"


class TestLoadCatalogIndex:
    def test_indexes_by_id(self, tmp_path: Path) -> None:
        index = load_catalog_index(_write_catalog(tmp_path))
        assert set(index) == {"gemma4:e4b", "sana-1.6b-int4", "ltx-video"}

    def test_missing_file_returns_empty(self, tmp_path: Path) -> None:
        assert load_catalog_index(tmp_path / "nope.json") == {}

    def test_malformed_json_returns_empty(self, tmp_path: Path) -> None:
        bad = tmp_path / "bad.json"
        bad.write_text("{not json", encoding="utf-8")
        assert load_catalog_index(bad) == {}


class TestProtocolFor:
    def test_none_defaults_to_ollama(self) -> None:
        assert protocol_for(None) == "ollama"

    def test_ollama_entry(self) -> None:
        entry = {"source": {"protocol": "ollama"}}
        assert protocol_for(entry) == "ollama"

    def test_huggingface_entry(self) -> None:
        entry = {"source": {"protocol": "huggingface"}}
        assert protocol_for(entry) == "huggingface"


class TestResolveSelectedModels:
    def test_multi_selection_wins_over_single(self) -> None:
        state = InstallerState(
            selected_model="gemma4:e4b",
            selected_model_ids=["sana-1.6b-int4", "ltx-video"],
        )
        assert resolve_selected_models(state) == ["sana-1.6b-int4", "ltx-video"]

    def test_falls_back_to_single_selection(self) -> None:
        state = InstallerState(selected_model="gemma4:e4b")
        assert resolve_selected_models(state) == ["gemma4:e4b"]

    def test_deduplicates_in_order(self) -> None:
        state = InstallerState(selected_model_ids=["a", "b", "a", "", "b"])
        assert resolve_selected_models(state) == ["a", "b"]

    def test_empty_selection(self) -> None:
        assert resolve_selected_models(InstallerState()) == []


class TestRouterRouting:
    def _run(
        self,
        tmp_path: Path,
        state: InstallerState,
        ollama_ok: bool = True,
        hf_ok: bool = True,
    ) -> tuple[bool, MagicMock, MagicMock, MagicMock, list[float]]:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path))
        log = MagicMock()
        fractions: list[float] = []
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
        ):
            mock_puller_cls.return_value.pull_model.side_effect = (
                lambda _m, _l, prog: (prog(1.0), ollama_ok)[1]
            )
            mock_hf_cls.return_value.install_model.side_effect = (
                lambda _e, _s, _l, prog: (prog(1.0), hf_ok)[1]
            )
            ok = router.install(state, log, fractions.append)
        return ok, log, mock_puller_cls, mock_hf_cls, fractions

    def test_routes_by_protocol(self, tmp_path: Path) -> None:
        state = InstallerState(
            selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"]
        )
        ok, _log, mock_puller, mock_hf, _ = self._run(tmp_path, state)
        assert ok is True
        mock_puller.return_value.pull_model.assert_called_once()
        assert (
            mock_puller.return_value.pull_model.call_args.args[0] == "gemma4:e4b"
        )
        mock_hf.return_value.install_model.assert_called_once()
        entry = mock_hf.return_value.install_model.call_args.args[0]
        assert entry["id"] == "sana-1.6b-int4"

    def test_unknown_id_routes_to_ollama(self, tmp_path: Path) -> None:
        state = InstallerState(selected_model_ids=["mystery-model"])
        ok, _log, mock_puller, mock_hf, _ = self._run(tmp_path, state)
        assert ok is True
        mock_puller.return_value.pull_model.assert_called_once()
        mock_hf.return_value.install_model.assert_not_called()

    def test_legacy_single_selection_still_pulls(self, tmp_path: Path) -> None:
        state = InstallerState(selected_model="gemma4:e4b")
        ok, _log, mock_puller, _hf, _ = self._run(tmp_path, state)
        assert ok is True
        mock_puller.return_value.pull_model.assert_called_once()

    def test_empty_selection_skips(self, tmp_path: Path) -> None:
        ok, log, mock_puller, mock_hf, _ = self._run(tmp_path, InstallerState())
        assert ok is True
        mock_puller.return_value.pull_model.assert_not_called()
        mock_hf.return_value.install_model.assert_not_called()
        assert any(
            "skipping" in call.args[0].lower() for call in log.call_args_list
        )

    def test_failure_isolation_continues_and_records(self, tmp_path: Path) -> None:
        state = InstallerState(
            selected_model_ids=["sana-1.6b-int4", "gemma4:e4b"]
        )
        ok, log, mock_puller, _hf, _ = self._run(tmp_path, state, hf_ok=False)
        assert ok is False
        # The ollama model still ran after the HF failure.
        mock_puller.return_value.pull_model.assert_called_once()
        assert state.failed_models == ["sana-1.6b-int4"]
        assert any(
            "continuing with the remaining models" in call.args[0].lower()
            for call in log.call_args_list
        )

    def test_all_failures_recorded(self, tmp_path: Path) -> None:
        state = InstallerState(
            selected_model_ids=["sana-1.6b-int4", "ltx-video"]
        )
        ok, _log, _puller, _hf, _ = self._run(tmp_path, state, hf_ok=False)
        assert ok is False
        assert state.failed_models == ["sana-1.6b-int4", "ltx-video"]

    def test_progress_is_weighted_by_size(self, tmp_path: Path) -> None:
        # gemma4:e4b (2.7 GB) then sana-1.6b-int4 (1.4 GB): the first
        # model's completion lands at 2.7 / 4.1 of the band, not 0.5.
        state = InstallerState(
            selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"]
        )
        ok, _log, _puller, _hf, fractions = self._run(tmp_path, state)
        assert ok is True
        assert fractions == sorted(fractions)
        assert any(abs(f - 2.7 / 4.1) < 1e-9 for f in fractions)
        assert fractions[-1] == 1.0

    def test_unreadable_catalog_warns_and_uses_ollama(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=tmp_path / "missing.json")
        state = InstallerState(selected_model_ids=["sana-1.6b-int4"])
        log = MagicMock()
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
        ):
            mock_puller_cls.return_value.pull_model.return_value = True
            ok = router.install(state, log, lambda _p: None)
        assert ok is True
        mock_puller_cls.return_value.pull_model.assert_called_once()
        mock_hf_cls.return_value.install_model.assert_not_called()
        assert any(
            "not readable" in call.args[0].lower() for call in log.call_args_list
        )

    def test_cancel_before_install_aborts(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path))
        router.cancel()
        state = InstallerState(selected_model_ids=["gemma4:e4b"])
        log = MagicMock()
        with patch(f"{_MOD}.ModelPuller") as mock_puller_cls:
            ok = router.install(state, log, lambda _p: None)
        assert ok is False
        mock_puller_cls.return_value.pull_model.assert_not_called()

    def test_cancel_forwards_to_active_puller(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path))
        active = MagicMock()
        router._active = active
        router.cancel()
        active.cancel.assert_called_once()

    def test_cancel_during_model_stops_routing(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path))
        state = InstallerState(
            selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"]
        )
        log = MagicMock()

        def cancel_mid_pull(_m: str, _l: object, _p: object) -> bool:
            router.cancel()
            return False

        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
        ):
            mock_puller_cls.return_value.pull_model.side_effect = cancel_mid_pull
            ok = router.install(state, log, lambda _p: None)
        assert ok is False
        mock_hf_cls.return_value.install_model.assert_not_called()
        # A user cancel is not a per-model failure.
        assert state.failed_models == []
