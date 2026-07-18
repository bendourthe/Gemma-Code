"""Tests for the default-model preflight harness (v1.13.0 Phase 2).

Reachability probe + pull/load runner with mocked network; a live pull+load
integration smoke gated behind NEXUS_MODEL_PREFLIGHT=1 (multi-GB, needs a real
Gemma-4-capable Ollama).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx as real_httpx
import pytest

from nexus_installer.engine.model_preflight import (
    Reachability,
    _ollama_load_smoke,
    default_model_ids,
    probe_catalog,
    probe_entry,
    run_preflight,
)
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.model_preflight"
_PLACEHOLDER = "0" * 64


def _hf_entry(gated: bool = False) -> dict:
    entry: dict = {
        "id": "img",
        "source": {"protocol": "huggingface", "repo": "org/model", "url": ""},
        "weights": {
            "layoutVersion": 1,
            "files": [{"path": "m.safetensors", "sha256": _PLACEHOLDER}],
        },
    }
    if gated:
        entry["gated"] = True
    return entry


def _ollama_entry() -> dict:
    return {
        "id": "gemma4:12b",
        "source": {"protocol": "ollama", "url": "ollama://gemma4:12b"},
    }


def _head(status: int):
    return lambda url, **kw: MagicMock(status_code=status)


class TestDefaultModelIds:
    def test_reads_all_tiers_ordered_deduped(self, tmp_path: Path) -> None:
        rec = {
            "tiers": {
                "cpu": {"chat": ["a"], "embed": ["z"]},
                "16": {"chat": ["b"], "agentic": ["b", "c"], "embed": ["z"]},
            }
        }
        p = tmp_path / "recommended.json"
        p.write_text(json.dumps(rec), encoding="utf-8")
        assert default_model_ids(recommended_path=p) == ["a", "z", "b", "c"]

    def test_tier_filter(self, tmp_path: Path) -> None:
        rec = {"tiers": {"cpu": {"chat": ["a"]}, "16": {"chat": ["b"]}}}
        p = tmp_path / "recommended.json"
        p.write_text(json.dumps(rec), encoding="utf-8")
        assert default_model_ids("16", recommended_path=p) == ["b"]

    def test_real_recommended_has_gemma_default(self) -> None:
        assert "gemma-4-12b-it-gguf" in default_model_ids()


class TestProbeEntry:
    def test_none_is_unknown(self) -> None:
        assert probe_entry(None, "x") is Reachability.UNKNOWN

    def test_gated_flag_short_circuits_without_network(self) -> None:
        head = MagicMock()
        assert probe_entry(_hf_entry(gated=True), "img", head) is Reachability.GATED
        head.assert_not_called()

    def test_hf_200_is_ok(self) -> None:
        assert probe_entry(_hf_entry(), "img", _head(200)) is Reachability.OK

    def test_hf_401_is_gated(self) -> None:
        assert probe_entry(_hf_entry(), "img", _head(401)) is Reachability.GATED

    def test_hf_404_is_dead(self) -> None:
        assert probe_entry(_hf_entry(), "img", _head(404)) is Reachability.DEAD

    def test_hf_5xx_is_unknown(self) -> None:
        assert probe_entry(_hf_entry(), "img", _head(503)) is Reachability.UNKNOWN

    def test_network_error_is_unknown(self) -> None:
        def boom(url, **kw):
            raise real_httpx.ConnectError("down")

        assert probe_entry(_hf_entry(), "img", boom) is Reachability.UNKNOWN

    def test_ollama_registry_manifest_ok(self) -> None:
        captured: dict[str, str] = {}

        def head(url, **kw):
            captured["url"] = url
            return MagicMock(status_code=200)

        assert probe_entry(_ollama_entry(), "gemma4:12b", head) is Reachability.OK
        assert (
            captured["url"]
            == "https://registry.ollama.ai/v2/library/gemma4/manifests/12b"
        )


class TestProbeCatalog:
    def test_classifies_all(self) -> None:
        catalog = {"gemma4:12b": _ollama_entry(), "img": _hf_entry(gated=True)}
        result = probe_catalog(catalog, head=_head(200))
        assert result["gemma4:12b"] is Reachability.OK
        assert result["img"] is Reachability.GATED

    def test_real_catalog_defaults_all_reachable(self) -> None:
        # The shipped catalog's default models must not be gated/dead (offline:
        # gated flags resolve without network; non-gated entries return UNKNOWN
        # under the stubbed HEAD, never GATED/DEAD).
        from nexus_installer.engine.model_preflight import default_model_ids
        from nexus_installer.engine.model_router import (
            default_catalog_path,
            load_catalog_index,
        )

        catalog = load_catalog_index(default_catalog_path())
        statuses = probe_catalog(catalog, head=_head(200))
        broken = [
            mid
            for mid in default_model_ids()
            if statuses.get(mid) in (Reachability.GATED, Reachability.DEAD)
        ]
        assert broken == [], f"default models not reachable: {broken}"


class TestOllamaLoadSmoke:
    def test_200_loads(self) -> None:
        with patch(f"{_MOD}.httpx.post", return_value=MagicMock(status_code=200)):
            ok, reason = _ollama_load_smoke("gemma4:12b", InstallerState())
        assert ok is True
        assert reason == ""

    def test_500_fails(self) -> None:
        with patch(f"{_MOD}.httpx.post", return_value=MagicMock(status_code=500)):
            ok, reason = _ollama_load_smoke("gemma4:12b", InstallerState())
        assert ok is False
        assert "500" in reason

    def test_network_error_fails(self) -> None:
        with patch(f"{_MOD}.httpx.post", side_effect=real_httpx.ConnectError("down")):
            ok, _reason = _ollama_load_smoke("gemma4:12b", InstallerState())
        assert ok is False


class TestRunPreflight:
    def _catalog(self) -> dict:
        return {"gemma4:12b": _ollama_entry(), "img": _hf_entry()}

    def test_ollama_pull_then_load_ok(self) -> None:
        with (
            patch(f"{_MOD}.ModelPuller") as puller_cls,
            patch(f"{_MOD}._ollama_load_smoke", return_value=(True, "")),
            patch(f"{_MOD}.ModelStepRouter") as router_cls,
        ):
            puller_cls.return_value.pull_model.return_value = True
            results = run_preflight(
                ["gemma4:12b"], InstallerState(), MagicMock(), self._catalog()
            )
            router_cls.return_value.ensure_ollama_server.assert_called_once()
        assert len(results) == 1
        assert results[0].ok

    def test_pull_ok_but_load_fails(self) -> None:
        with (
            patch(f"{_MOD}.ModelPuller") as puller_cls,
            patch(
                f"{_MOD}._ollama_load_smoke",
                return_value=(False, "load failed: HTTP 500"),
            ),
            patch(f"{_MOD}.ModelStepRouter"),
        ):
            puller_cls.return_value.pull_model.return_value = True
            results = run_preflight(
                ["gemma4:12b"], InstallerState(), MagicMock(), self._catalog()
            )
        assert results[0].pulled is True
        assert results[0].loaded is False
        assert results[0].ok is False

    def test_pull_fails_reports_reason(self) -> None:
        with (
            patch(f"{_MOD}.ModelPuller") as puller_cls,
            patch(f"{_MOD}.ModelStepRouter"),
        ):
            puller_cls.return_value.pull_model.return_value = False
            puller_cls.return_value.last_error = "Error: 400"
            results = run_preflight(
                ["gemma4:12b"], InstallerState(), MagicMock(), self._catalog()
            )
        assert results[0].ok is False
        assert "400" in results[0].reason

    def test_hf_model_download_no_ollama_server(self) -> None:
        with (
            patch(f"{_MOD}.HFWeightsPuller") as hf_cls,
            patch(f"{_MOD}.ModelStepRouter") as router_cls,
        ):
            hf_cls.return_value.install_model.return_value = True
            results = run_preflight(
                ["img"], InstallerState(), MagicMock(), self._catalog()
            )
            # No ollama model selected -> the server is never started.
            router_cls.return_value.ensure_ollama_server.assert_not_called()
        assert results[0].protocol == "huggingface"
        assert results[0].ok is True


@pytest.mark.skipif(
    os.environ.get("NEXUS_MODEL_PREFLIGHT") != "1",
    reason=(
        "live multi-GB pull + load of the default models; opt in with "
        "NEXUS_MODEL_PREFLIGHT=1 against a Gemma-4-capable Ollama"
    ),
)
class TestLivePreflightIntegration:
    def test_default_16gb_tier_models_pull_and_load(self) -> None:
        ids = default_model_ids("16")
        results = run_preflight(ids, InstallerState(), lambda *_a: None)
        failed = [r.model_id for r in results if not r.ok]
        assert not failed, f"failed: {failed}"
