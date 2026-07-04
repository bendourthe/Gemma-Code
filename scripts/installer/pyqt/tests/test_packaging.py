"""Tests for packaging infrastructure."""

from __future__ import annotations

from pathlib import Path

PYQT_ROOT = Path(__file__).parent.parent
BUILD_DIR = PYQT_ROOT / "build"
REPO_ROOT = PYQT_ROOT.parent.parent.parent
NSIS_DIR = REPO_ROOT / "scripts" / "installer" / "build" / "nsis"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


class TestSpecFile:
    def test_spec_file_exists(self) -> None:
        assert (BUILD_DIR / "nexus-installer.spec").is_file()

    def test_spec_contains_required_entries(self) -> None:
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "PyQt5.QtWidgets" in content
        assert "PyQt5.QtCore" in content
        assert "PyQt5.QtGui" in content
        assert "onefile" not in content or "console=False" in content

    def test_spec_bundles_registry_data_files(self) -> None:
        # v1.8.0 Phase 6 (T601, closes OSI004.P4.C): a packaged wizard must
        # carry catalog.json + recommended.json or the typed catalog renders
        # empty and every model id routes to ollama.
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "catalog.json" in content
        assert "recommended.json" in content
        assert "core/registry" in content

    def test_spec_prefers_renamed_vsix(self) -> None:
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "nexus-coding-*.vsix" in content

    def test_spec_windows_wizard_name_leaves_nexussetup_to_nsis(self) -> None:
        # The NSIS outer owns the user-facing NexusSetup.exe name; the frozen
        # wizard is nexus-installer.exe (T601).
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert 'APP_NAME = "nexus-installer"' in content

    def test_hook_file_exists(self) -> None:
        assert (BUILD_DIR / "hooks" / "hook-PyQt5.py").is_file()


class TestBuildScripts:
    def test_windows_script_exists(self) -> None:
        assert (BUILD_DIR / "build-windows.ps1").is_file()

    def test_macos_script_exists(self) -> None:
        assert (BUILD_DIR / "build-macos.sh").is_file()

    def test_linux_script_exists(self) -> None:
        assert (BUILD_DIR / "build-linux.sh").is_file()

    def test_scripts_contain_pyinstaller(self) -> None:
        for script in ("build-windows.ps1", "build-macos.sh", "build-linux.sh"):
            content = (BUILD_DIR / script).read_text()
            assert "pyinstaller" in content.lower() or "PyInstaller" in content

    def test_windows_script_compiles_the_nsis_outer(self) -> None:
        content = (BUILD_DIR / "build-windows.ps1").read_text()
        assert "makensis" in content
        assert "NexusSetup.exe" in content
        assert "nexus-setup.nsi" in content


class TestNsisOuter:
    def test_nsi_script_exists(self) -> None:
        assert (NSIS_DIR / "nexus-setup.nsi").is_file()

    def test_nsi_outputs_nexussetup_and_wraps_the_wizard(self) -> None:
        content = (NSIS_DIR / "nexus-setup.nsi").read_text()
        assert "NexusSetup.exe" in content
        assert "nexus-installer.exe" in content

    def test_nsi_is_version_parameterized(self) -> None:
        content = (NSIS_DIR / "nexus-setup.nsi").read_text()
        assert "!ifndef APP_VERSION" in content

    def test_nsi_does_not_invoke_unsupported_wizard_flags(self) -> None:
        # The v1.1.0-era template ran `nexus-installer.exe --verify-only`,
        # a flag the wizard never implemented (argparse exits 2).
        content = (NSIS_DIR / "nexus-setup.nsi").read_text()
        assert "--verify-only" not in content

    def test_nsi_preserves_user_data_on_silent_uninstall(self) -> None:
        content = (NSIS_DIR / "nexus-setup.nsi").read_text()
        assert "IfSilent" in content
        assert ".nexus" in content


class TestSmokeScript:
    def test_exe_smoke_script_exists(self) -> None:
        assert (BUILD_DIR / "smoke-windows-exe.ps1").is_file()

    def test_exe_smoke_probes_the_bundled_registry(self) -> None:
        content = (BUILD_DIR / "smoke-windows-exe.ps1").read_text()
        assert "--check-registry" in content
        assert "/S" in content


class TestWorkflows:
    def test_windows_workflow_is_no_longer_a_todo_skeleton(self) -> None:
        content = (WORKFLOWS / "installer-build.yml").read_text()
        assert "TODO" not in content
        assert "build-windows.ps1" in content
        assert "smoke-windows-exe.ps1" in content

    def test_mac_linux_workflows_use_the_canonical_build_scripts(self) -> None:
        mac = (WORKFLOWS / "installer-macos.yml").read_text()
        linux = (WORKFLOWS / "installer-linux.yml").read_text()
        assert "build-macos.sh" in mac
        assert "build-linux.sh" in linux
        # The old hand-rolled invocations bypassed the spec (and with it the
        # bundled VSIX + registry data files).
        assert "pyinstaller --noconfirm" not in mac
        assert "pyinstaller --noconfirm" not in linux

    def test_workflows_package_the_vsix_from_the_repo_root(self) -> None:
        # `extensions/nexus-coding` never existed; the repo root is the
        # extension package (same as release.yml's build-vsix job).
        workflow_names = (
            "installer-build.yml",
            "installer-macos.yml",
            "installer-linux.yml",
        )
        for name in workflow_names:
            content = (WORKFLOWS / name).read_text()
            assert "cd extensions/nexus-coding" not in content
            assert "vsce package" in content
