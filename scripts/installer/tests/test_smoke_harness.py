"""v1.11.0 Phase 2 (T205) -- headless-smoke contract + harness self-tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nexus_installer.installer_state import InstallerState
from nexus_installer.smoke import (
    SMOKE_RESULT_SCHEMA,
    SmokeProfileError,
    apply_smoke_profile,
    build_smoke_result,
    load_smoke_profile,
    write_smoke_result,
)

TESTING_DIR = Path(__file__).resolve().parents[1] / "testing"


class TestProfileLoading:
    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(SmokeProfileError, match="cannot read"):
            load_smoke_profile(tmp_path / "nope.json")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        with pytest.raises(SmokeProfileError, match="not valid JSON"):
            load_smoke_profile(p)

    def test_missing_name_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "noname.json"
        p.write_text("{}", encoding="utf-8")
        with pytest.raises(SmokeProfileError, match="name"):
            load_smoke_profile(p)

    def test_unknown_component_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "badcomp.json"
        p.write_text(
            json.dumps({"name": "x", "components": ["warp-drive"]}),
            encoding="utf-8",
        )
        with pytest.raises(SmokeProfileError, match="components"):
            load_smoke_profile(p)

    def test_bom_profile_loads(self, tmp_path: Path) -> None:
        """Windows PowerShell's `Out-File -Encoding utf8` prepends a BOM;
        operator-authored profiles must still load."""
        p = tmp_path / "bom.json"
        p.write_bytes(b"\xef\xbb\xbf" + json.dumps({"name": "bom"}).encode())
        assert load_smoke_profile(p)["name"] == "bom"

    def test_valid_profile_loads(self, tmp_path: Path) -> None:
        p = tmp_path / "ok.json"
        p.write_text(
            json.dumps(
                {
                    "name": "ok",
                    "components": ["ollama", "venv"],
                    "selected_model_ids": ["nomic-embed-text"],
                }
            ),
            encoding="utf-8",
        )
        profile = load_smoke_profile(p)
        assert profile["name"] == "ok"


class TestProfileApply:
    def test_profile_overrides_state(self) -> None:
        state = InstallerState()
        apply_smoke_profile(
            state,
            {
                "name": "x",
                "components": ["venv"],
                "selected_model_ids": ["m1"],
                "install_path": "/tmp/x",
                "models_root": "/tmp/x/models",
                "ollama_url": "http://127.0.0.1:11434",
            },
        )
        assert state.components_to_install == ["venv"]
        assert state.selected_model_ids == ["m1"]
        assert state.selected_model == ""  # legacy default must not leak
        assert state.install_path == "/tmp/x"
        assert state.models_root == "/tmp/x/models"

    def test_absent_fields_leave_state(self) -> None:
        state = InstallerState()
        before = list(state.components_to_install)
        apply_smoke_profile(state, {"name": "x"})
        assert state.components_to_install == before


class TestResultContract:
    def test_schema_and_shape(self, tmp_path: Path) -> None:
        state = InstallerState()
        state.failed_models.append("bad-model")
        result = build_smoke_result(
            "p", state, ["venv"], ["ollama"], [{"level": "info", "message": "hi"}]
        )
        assert result["schema"] == SMOKE_RESULT_SCHEMA
        assert result["success"] is False
        assert result["steps_failed"] == ["ollama"]
        assert result["failed_models"] == ["bad-model"]
        out = tmp_path / "deep" / "result.json"
        write_smoke_result(out, result)
        assert json.loads(out.read_text(encoding="utf-8"))["profile"] == "p"

    def test_success_when_nothing_failed(self) -> None:
        result = build_smoke_result("p", InstallerState(), ["venv"], [], [])
        assert result["success"] is True


class TestShippedHarnessFiles:
    """The checked-in harness artifacts stay mutually consistent."""

    def test_shipped_profiles_are_valid(self) -> None:
        profiles = sorted((TESTING_DIR / "profiles").glob("*.json"))
        assert profiles, "no shipped profiles found"
        for p in profiles:
            profile = load_smoke_profile(p)  # raises on invalidity
            assert profile["name"] == p.stem

    def test_wsb_template_placeholders(self) -> None:
        template = (TESTING_DIR / "sandbox-config.wsb.template").read_text(
            encoding="utf-8"
        )
        for placeholder in (
            "{{DIST_DIR}}",
            "{{TESTING_DIR}}",
            "{{OUTPUT_DIR}}",
            "{{PROFILE}}",
        ):
            assert placeholder in template
        # The bootstrap the template invokes must ship next to it.
        assert "sandbox-bootstrap.ps1" in template
        assert (TESTING_DIR / "sandbox-bootstrap.ps1").is_file()

    def test_runners_reference_the_contract(self) -> None:
        sandbox = (TESTING_DIR / "run-sandbox-test.ps1").read_text(encoding="utf-8")
        docker = (TESTING_DIR / "run-docker-test.sh").read_text(encoding="utf-8")
        boot = (TESTING_DIR / "sandbox-bootstrap.ps1").read_text(encoding="utf-8")
        assert "result.json" in sandbox
        assert "--headless-smoke" in boot
        assert "--smoke-output" in boot
        assert "--headless-smoke" in docker
        assert "--smoke-output" in docker


class TestHeadlessSmokeCli:
    def test_bad_profile_exits_2(self, tmp_path: Path) -> None:
        import argparse

        from nexus_installer.main import _run_headless

        args = argparse.Namespace(
            install_path=None,
            ollama_url=None,
            model=None,
            skip_model=False,
            skip_extension=False,
            skip_desktop=False,
            desktop_bundle=None,
            headless_smoke=str(tmp_path / "missing.json"),
            smoke_output=None,
            json_output=False,
            debug=False,
        )
        assert _run_headless(args) == 2
