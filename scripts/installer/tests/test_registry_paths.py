"""Tests for the shared registry-file resolver (v1.8.0 Phase 6, T601).

Covers the three runtime shapes `nexus_installer.registry_paths` serves:
frozen bundle (sys._MEIPASS first), source tree (walk-up), and neither
(bare relative fallback) -- plus the `--check-registry` packaging-smoke
diagnostic and its CLI wiring.
"""

from __future__ import annotations

import sys
from pathlib import Path

from nexus_installer import registry_paths
from nexus_installer.main import _build_arg_parser


def _make_bundle(root: Path, names: tuple[str, ...]) -> None:
    registry = root / "core" / "registry"
    registry.mkdir(parents=True)
    for name in names:
        (registry / name).write_text("{}", encoding="utf-8")


def _make_assets(root: Path, names: tuple[str, ...]) -> None:
    assets = root / "assets"
    assets.mkdir(parents=True)
    for name in names:
        (assets / name).write_bytes(b"\x00")


def _make_tuning(root: Path, names: tuple[str, ...]) -> None:
    tuning = root / "core" / "tuning"
    tuning.mkdir(parents=True)
    for name in names:
        (tuning / name).write_text("{}", encoding="utf-8")


class TestRegistryFile:
    def test_source_tree_walkup_finds_real_catalog(self) -> None:
        path = registry_paths.registry_file("catalog.json")
        assert path.is_file()
        assert path.parts[-3:] == ("core", "registry", "catalog.json")

    def test_source_tree_walkup_finds_real_recommended(self) -> None:
        path = registry_paths.registry_file("recommended.json")
        assert path.is_file()

    def test_frozen_prefers_bundle_dir(self, tmp_path, monkeypatch) -> None:
        _make_bundle(tmp_path, ("catalog.json",))
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        path = registry_paths.registry_file("catalog.json")
        assert path == tmp_path / "core" / "registry" / "catalog.json"

    def test_frozen_missing_from_bundle_falls_back_to_walkup(
        self, tmp_path, monkeypatch
    ) -> None:
        # Bundle dir exists but lacks the file: the source-tree walk-up
        # still resolves (this test runs from the checkout).
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        path = registry_paths.registry_file("catalog.json")
        assert path.is_file()
        assert not str(path).startswith(str(tmp_path))

    def test_not_frozen_ignores_meipass(self, tmp_path, monkeypatch) -> None:
        _make_bundle(tmp_path, ("catalog.json",))
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        monkeypatch.delattr(sys, "frozen", raising=False)
        path = registry_paths.registry_file("catalog.json")
        assert not str(path).startswith(str(tmp_path))

    def test_missing_everywhere_returns_relative_fallback(self) -> None:
        path = registry_paths.registry_file("does-not-exist.json")
        assert path == Path("core") / "registry" / "does-not-exist.json"

    def test_default_helpers_point_at_the_two_registry_files(self) -> None:
        assert registry_paths.default_catalog_path().name == "catalog.json"
        assert registry_paths.default_recommended_path().name == "recommended.json"


class TestAssetFile:
    def test_source_tree_walkup_finds_icon_ico(self) -> None:
        path = registry_paths.asset_file("icon.ico")
        assert path.is_file()
        assert path.parts[-2:] == ("assets", "icon.ico")

    def test_frozen_prefers_bundle_dir(self, tmp_path, monkeypatch) -> None:
        _make_assets(tmp_path, ("icon.ico",))
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        path = registry_paths.asset_file("icon.ico")
        assert path == tmp_path / "assets" / "icon.ico"

    def test_frozen_missing_from_bundle_falls_back_to_walkup(
        self, tmp_path, monkeypatch
    ) -> None:
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        path = registry_paths.asset_file("icon.ico")
        assert path.is_file()
        assert not str(path).startswith(str(tmp_path))

    def test_not_frozen_ignores_meipass(self, tmp_path, monkeypatch) -> None:
        _make_assets(tmp_path, ("icon.ico",))
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        monkeypatch.delattr(sys, "frozen", raising=False)
        path = registry_paths.asset_file("icon.ico")
        assert not str(path).startswith(str(tmp_path))

    def test_missing_everywhere_returns_relative_fallback(self) -> None:
        path = registry_paths.asset_file("no-such-icon.ico")
        assert path == Path("assets") / "no-such-icon.ico"


class TestTuningFile:
    def test_source_tree_walkup_finds_unsloth_pins(self) -> None:
        path = registry_paths.tuning_file("unsloth-pins.json")
        assert path.is_file()
        assert path.parts[-3:] == ("core", "tuning", "unsloth-pins.json")

    def test_frozen_prefers_bundle_dir(self, tmp_path, monkeypatch) -> None:
        _make_tuning(tmp_path, ("unsloth-pins.json",))
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        path = registry_paths.tuning_file("unsloth-pins.json")
        assert path == tmp_path / "core" / "tuning" / "unsloth-pins.json"

    def test_resource_file_rejects_unsafe_segments(self) -> None:
        import pytest

        with pytest.raises(ValueError):
            registry_paths.resource_file("core", "..", "secret")


class TestResolveWindowIcon:
    def test_source_tree_prefers_ico(self) -> None:
        path = registry_paths.resolve_window_icon()
        assert path is not None
        assert path.is_file()
        assert path.name == "icon.ico"  # .ico wins over .png / the mark

    def test_none_when_no_icon_asset(self, monkeypatch) -> None:
        # asset_file returns a non-existent path for every candidate.
        monkeypatch.setattr(
            registry_paths, "asset_file", lambda name: Path("nope") / name
        )
        assert registry_paths.resolve_window_icon() is None


class TestCheckRegistry:
    def test_exit_zero_when_both_resolve(self, capsys) -> None:
        assert registry_paths.check_registry() == 0
        out = capsys.readouterr().out
        assert "catalog.json: ok" in out
        assert "recommended.json: ok" in out

    def test_exit_one_when_a_file_is_missing(
        self, tmp_path, monkeypatch, capsys
    ) -> None:
        monkeypatch.setattr(
            registry_paths,
            "registry_file",
            lambda name: tmp_path / name,
        )
        assert registry_paths.check_registry() == 1
        assert "MISSING" in capsys.readouterr().out

    def test_survives_windowed_mode_without_stdout(self, monkeypatch) -> None:
        # Frozen --windowed builds have sys.stdout None; the exit code is
        # the only signal there.
        monkeypatch.setattr(sys, "stdout", None)
        assert registry_paths.check_registry() == 0


class TestCliWiring:
    def test_flag_defaults_off(self) -> None:
        args = _build_arg_parser().parse_args([])
        assert args.check_registry is False

    def test_flag_parses(self) -> None:
        args = _build_arg_parser().parse_args(["--check-registry"])
        assert args.check_registry is True
