"""Tests for the protocol-routed model step (v1.8.0 Phase 3, T304).

Covers catalog lookup, protocol resolution, multi-selection handling,
weighted mixed-protocol progress aggregation, per-model failure
isolation, and cancel forwarding.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from unittest.mock import MagicMock, patch

from nexus_installer.engine.model_router import (
    ModelProgress,
    ModelStepEvents,
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
                    "files": [{"path": "ltx.safetensors", "sha256": _PLACEHOLDER}],
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


class TestCatalogIntegrity:
    """v1.13.0 Phase 1: the shipped catalog must never route a default model to
    a broken or gated source (the class behind the fresh-install half-failure)."""

    def _catalog(self) -> dict[str, object]:
        return load_catalog_index(default_catalog_path())

    def test_gemma_12b_routes_to_registry_not_hf_gguf(self) -> None:
        # The Unsloth hf.co GGUF path fails Ollama manifest registration
        # (bug #15447); the default must route to the Ollama-registry tag.
        entry = self._catalog()["gemma-4-12b-it-gguf"]
        target = ollama_target_for(entry, "gemma-4-12b-it-gguf")
        assert target == "gemma4:12b"
        assert "hf.co" not in target

    def test_no_default_model_is_gated(self) -> None:
        catalog = self._catalog()
        recommended = json.loads(
            (default_catalog_path().parent / "recommended.json").read_text(
                encoding="utf-8"
            )
        )
        default_ids = {
            mid
            for tier in recommended["tiers"].values()
            for section in tier.values()
            for mid in section
        }
        gated = sorted(mid for mid in default_ids if catalog.get(mid, {}).get("gated"))
        assert gated == [], f"gated default models must not ship: {gated}"

    def test_sd15_repointed_to_public_mirror(self) -> None:
        # v1.14.0 Phase 1: the withdrawn runwayml repo is re-pointed to the
        # public stable-diffusion-v1-5 mirror and is no longer gated.
        entry = self._catalog()["sd1.5"]
        assert entry.get("gated") is not True
        assert entry["source"]["repo"] == "stable-diffusion-v1-5/stable-diffusion-v1-5"
        assert "runwayml" not in entry["source"]["url"]

    def test_gated_opt_ins_carry_license_metadata(self) -> None:
        # v1.14.0 Phase 1: genuinely license-gated open-weight opt-ins keep
        # gated=true and add requiresLicense + a licenseUrl so the installer's
        # guided Hugging Face step can unlock them (never a silent skip).
        catalog = self._catalog()
        for mid in ("sana-1.6b-int4", "svd", "stable-audio-open-1.0"):
            entry = catalog[mid]
            assert entry.get("gated") is True, f"{mid} must be gated"
            assert entry.get("requiresLicense") is True, f"{mid} needs requiresLicense"
            url = str(entry.get("licenseUrl", ""))
            assert url.startswith("https://huggingface.co/"), f"{mid} needs licenseUrl"

    def test_every_selectable_model_has_release_date(self) -> None:
        # v1.14.0 Phase 1: the picker renders releaseDate as a pill, so every
        # user-selectable model (auxiliary vae/controlnet excluded) must carry
        # an ISO release date.
        selectable_types = {"llm", "embed", "image", "video", "audio"}
        catalog = self._catalog()
        missing = [
            mid
            for mid, entry in catalog.items()
            if entry.get("type") in selectable_types
            and not re.fullmatch(
                r"\d{4}-\d{2}-\d{2}", str(entry.get("releaseDate", ""))
            )
        ]
        assert missing == [], f"selectable models missing releaseDate: {missing}"


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
        # max_workers=1 keeps ordering deterministic for these routing tests;
        # parallel behavior is covered by TestParallelPool.
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path), max_workers=1)
        log = MagicMock()
        fractions: list[float] = []
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=True),
        ):
            mock_puller_cls.return_value.pull_model.side_effect = lambda _m, _l, prog: (
                prog(1.0),
                ollama_ok,
            )[1]
            mock_puller_cls.return_value.last_error = "pull failed"
            mock_hf_cls.return_value.install_model.side_effect = (
                lambda _e, _s, _l, prog: (prog(1.0), hf_ok)[1]
            )
            ok = router.install(state, log, fractions.append)
        return ok, log, mock_puller_cls, mock_hf_cls, fractions

    def test_routes_by_protocol(self, tmp_path: Path) -> None:
        state = InstallerState(selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"])
        ok, _log, mock_puller, mock_hf, _ = self._run(tmp_path, state)
        assert ok is True
        mock_puller.return_value.pull_model.assert_called_once()
        assert mock_puller.return_value.pull_model.call_args.args[0] == "gemma4:e4b"
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
        assert any("skipping" in call.args[0].lower() for call in log.call_args_list)

    def test_failure_isolation_continues_and_records(self, tmp_path: Path) -> None:
        state = InstallerState(selected_model_ids=["sana-1.6b-int4", "gemma4:e4b"])
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
        state = InstallerState(selected_model_ids=["sana-1.6b-int4", "ltx-video"])
        ok, _log, _puller, _hf, _ = self._run(tmp_path, state, hf_ok=False)
        assert ok is False
        assert state.failed_models == ["sana-1.6b-int4", "ltx-video"]

    def test_progress_is_weighted_by_size(self, tmp_path: Path) -> None:
        # gemma4:e4b (2.7 GB) then sana-1.6b-int4 (1.4 GB): the first
        # model's completion lands at 2.7 / 4.1 of the band, not 0.5.
        state = InstallerState(selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"])
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
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=True),
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
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=True),
        ):
            ok = router.install(state, log, lambda _p: None)
        assert ok is False
        mock_puller_cls.return_value.pull_model.assert_not_called()

    def test_cancel_forwards_to_active_pullers(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path))
        active = MagicMock()
        router._active = [active]
        router.cancel()
        active.cancel.assert_called_once()

    def test_cancel_during_model_stops_routing(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path), max_workers=1)
        state = InstallerState(selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"])
        log = MagicMock()

        def cancel_mid_pull(_m: str, _l: object, _p: object) -> bool:
            router.cancel()
            return False

        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=True),
        ):
            mock_puller_cls.return_value.pull_model.side_effect = cancel_mid_pull
            mock_puller_cls.return_value.last_error = ""
            ok = router.install(state, log, lambda _p: None)
        assert ok is False
        mock_hf_cls.return_value.install_model.assert_not_called()
        # A user cancel is not a per-model failure.
        assert state.failed_models == []


class TestServerAwareness:
    def test_healthy_server_skips_spawn(self) -> None:
        router = ModelStepRouter(catalog_path=Path("unused"))
        resp = MagicMock(status_code=200)
        with (
            patch(f"{_MOD}.httpx.get", return_value=resp) as mock_get,
            patch(f"{_MOD}.subprocess.Popen") as mock_popen,
        ):
            ok = router.ensure_ollama_server(InstallerState(), MagicMock())
        assert ok is True
        mock_get.assert_called_once()
        mock_popen.assert_not_called()

    def test_down_server_spawns_hidden_and_waits(self) -> None:
        import httpx as _httpx

        router = ModelStepRouter(catalog_path=Path("unused"))
        resp = MagicMock(status_code=200)
        with (
            patch(
                f"{_MOD}.httpx.get",
                side_effect=[_httpx.ConnectError("down"), resp],
            ),
            patch(f"{_MOD}.subprocess.Popen") as mock_popen,
            patch(f"{_MOD}.time.sleep"),
        ):
            ok = router.ensure_ollama_server(InstallerState(), MagicMock())
        assert ok is True
        mock_popen.assert_called_once()
        args, kwargs = mock_popen.call_args
        assert args[0] == ["ollama", "serve"]
        # DEVNULL streams: the server must never inherit installer pipes.
        import subprocess as _sp

        assert kwargs["stdout"] == _sp.DEVNULL
        assert kwargs["stderr"] == _sp.DEVNULL

    def test_missing_ollama_binary_fails(self) -> None:
        import httpx as _httpx

        router = ModelStepRouter(catalog_path=Path("unused"))
        log = MagicMock()
        with (
            patch(f"{_MOD}.httpx.get", side_effect=_httpx.ConnectError("down")),
            patch(f"{_MOD}.subprocess.Popen", side_effect=FileNotFoundError),
        ):
            ok = router.ensure_ollama_server(InstallerState(), log)
        assert ok is False

    def test_unavailable_server_fails_ollama_models_fast(self, tmp_path: Path) -> None:
        """HF models still install when the Ollama server cannot start."""
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path), max_workers=1)
        state = InstallerState(selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"])
        log = MagicMock()
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=False),
        ):
            mock_hf_cls.return_value.install_model.return_value = True
            ok = router.install(state, log, lambda _p: None)
        assert ok is False
        mock_puller_cls.return_value.pull_model.assert_not_called()
        mock_hf_cls.return_value.install_model.assert_called_once()
        assert state.failed_models == ["gemma4:e4b"]


class TestPerModelEvents:
    def test_lifecycle_events_fire(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path), max_workers=1)
        state = InstallerState(selected_model_ids=["gemma4:e4b", "sana-1.6b-int4"])
        started: list[str] = []
        completed: list[str] = []
        failed: list[tuple[str, str]] = []
        samples: list[ModelProgress] = []
        events = ModelStepEvents(
            started=started.append,
            progress=samples.append,
            completed=completed.append,
            failed=lambda mid, reason: failed.append((mid, reason)),
        )
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=True),
        ):
            mock_puller_cls.return_value.pull_model.side_effect = lambda _m, _l, prog: (
                prog(0.5),
                prog(1.0),
                True,
            )[-1]
            mock_hf_cls.return_value.install_model.return_value = False
            ok = router.install(state, MagicMock(), lambda _p: None, events)
        assert ok is False
        assert started == ["gemma4:e4b", "sana-1.6b-int4"]
        assert completed == ["gemma4:e4b"]
        assert len(failed) == 1 and failed[0][0] == "sana-1.6b-int4"
        assert samples, "progress events must fire"
        assert samples[0].model_id == "gemma4:e4b"
        assert samples[-1].fraction <= 1.0
        assert samples[0].bytes_total > 0  # sizeGB-derived estimate


class TestParallelPool:
    def test_parallel_runs_all_models(self, tmp_path: Path) -> None:
        router = ModelStepRouter(catalog_path=_write_catalog(tmp_path), max_workers=3)
        state = InstallerState(
            selected_model_ids=["gemma4:e4b", "sana-1.6b-int4", "ltx-video"]
        )
        pulled: list[str] = []
        with (
            patch(f"{_MOD}.ModelPuller") as mock_puller_cls,
            patch(f"{_MOD}.HFWeightsPuller") as mock_hf_cls,
            patch.object(ModelStepRouter, "ensure_ollama_server", return_value=True),
        ):
            mock_puller_cls.return_value.pull_model.side_effect = lambda m, _l, prog: (
                pulled.append(m),
                prog(1.0),
                True,
            )[-1]
            mock_hf_cls.return_value.install_model.side_effect = (
                lambda e, _s, _l, prog: (pulled.append(e["id"]), prog(1.0), True)[-1]
            )
            ok = router.install(state, MagicMock(), lambda _p: None)
        assert ok is True
        assert sorted(pulled) == ["gemma4:e4b", "ltx-video", "sana-1.6b-int4"]
