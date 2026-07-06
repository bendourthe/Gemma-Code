"""Tests for packaging infrastructure."""

from __future__ import annotations

from pathlib import Path

INSTALLER_ROOT = Path(__file__).parent.parent
BUILD_DIR = INSTALLER_ROOT / "build"
REPO_ROOT = INSTALLER_ROOT.parent.parent
LEGACY_DIR = REPO_ROOT / "scripts" / "installer" / "legacy"
BUILD_NSIS_DIR = REPO_ROOT / "scripts" / "installer" / "build" / "nsis"
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

    def test_spec_windows_wizard_is_nexussetup_onefile(self) -> None:
        # v1.9.0 Phase 1 (T101): the PyInstaller onefile IS the distributable;
        # it carries the user-facing NexusSetup name directly (no NSIS outer).
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert 'APP_NAME = "NexusSetup"' in content
        assert 'APP_NAME = "nexus-installer"' not in content

    def test_spec_declares_per_os_onefile_names(self) -> None:
        # macOS ships "Nexus AI Studio Setup"; Linux ships "nexus-setup".
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert 'APP_NAME = "Nexus AI Studio Setup"' in content
        assert 'APP_NAME = "nexus-setup"' in content

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

    def test_windows_script_is_single_onefile_no_nsis(self) -> None:
        # v1.9.0 Phase 1 (T102): the onefile is the artifact; no NSIS stage,
        # no two-artifact loop, and the exe is emitted to the repo-root dist/.
        content = (BUILD_DIR / "build-windows.ps1").read_text()
        assert "NexusSetup.exe" in content
        assert "makensis" not in content
        assert "nexus-setup.nsi" not in content

    def test_build_scripts_target_repo_root_dist(self) -> None:
        # One easy-to-find output location on every OS (no deep pyqt/dist +
        # hand-copy).
        win = (BUILD_DIR / "build-windows.ps1").read_text()
        mac = (BUILD_DIR / "build-macos.sh").read_text()
        linux = (BUILD_DIR / "build-linux.sh").read_text()
        assert "NexusSetup.exe" in win
        assert "NexusSetup.dmg" in mac
        assert "NexusSetup-x86_64.AppImage" in linux


class TestNsisRetired:
    def test_nsis_shell_removed_from_build_tree(self) -> None:
        # v1.9.0 Phase 1 (T103): the NSIS outer shell is retired to legacy/.
        assert not (BUILD_NSIS_DIR / "nexus-setup.nsi").exists()
        assert not BUILD_NSIS_DIR.exists()

    def test_nsis_shell_archived_in_legacy(self) -> None:
        assert (LEGACY_DIR / "nexus-setup.nsi").is_file()

    def test_active_windows_pipeline_has_no_nsis(self) -> None:
        # No active build script or the Windows workflow may invoke NSIS.
        win_script = (BUILD_DIR / "build-windows.ps1").read_text()
        workflow = (WORKFLOWS / "installer-build.yml").read_text()
        for content in (win_script, workflow):
            assert "makensis" not in content
            assert "nexus-setup.nsi" not in content


class TestSmokeScript:
    def test_exe_smoke_script_exists(self) -> None:
        assert (BUILD_DIR / "smoke-windows-exe.ps1").is_file()

    def test_exe_smoke_boots_the_frozen_exe(self) -> None:
        # v1.9.0 Phase 1 (T105): boot NexusSetup.exe directly (--version +
        # --check-registry); no NSIS silent install/uninstall round-trip.
        content = (BUILD_DIR / "smoke-windows-exe.ps1").read_text()
        assert "--check-registry" in content
        assert "--version" in content
        assert "NexusSetup.exe" in content
        assert "makensis" not in content


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

    def test_workflows_upload_the_single_artifact_from_repo_root_dist(self) -> None:
        # v1.9.0 Phase 1 (T103): one artifact per OS, uploaded from the
        # repo-root dist/ (no deep scripts/installer/dist path).
        checks = {
            "installer-build.yml": "dist/NexusSetup.exe",
            "installer-macos.yml": "dist/NexusSetup.dmg",
            "installer-linux.yml": "dist/NexusSetup-x86_64.AppImage",
        }
        for name, artifact in checks.items():
            content = (WORKFLOWS / name).read_text()
            assert f"path: {artifact}" in content
            assert "scripts/installer/dist" not in content
