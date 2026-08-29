"""Tests for packaging infrastructure."""

from __future__ import annotations

import json
import re
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

    def test_spec_bundles_validated_unsloth_pins(self) -> None:
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "unsloth-pins.json" in content
        assert 'datas.append((str(unsloth_pins_path), "core/tuning"))' in content
        assert "every Unsloth provisioned package needs" in content

    def test_spec_bundles_no_hub_catalog_payload(self) -> None:
        # v1.10.0 Phase 5: the Nexus-Hub catalog is fetched at runtime into
        # ~/.nexus-ai/catalog/, never bundled into the exe.
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "devai-hub-baseline" not in content
        assert "devai_hub" not in content

    def test_no_bundled_hub_baseline_manifest(self) -> None:
        # The broken bundled-baseline manifest is removed.
        assert not (INSTALLER_ROOT / "devai-hub-baseline.json").exists()

    def test_spec_stages_runtime_icons(self) -> None:
        # v1.9.0 Phase 5 (T019): the runtime window/taskbar icon (icon.ico) and
        # the brand mark must be staged under assets/ so setWindowIcon resolves
        # them from sys._MEIPASS in the frozen bundle -- otherwise the taskbar
        # falls back to the generic Python host icon.
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "icon.ico" in content
        assert "nexus-ai-primary_no-background.png" in content
        assert '"assets"' in content
        assert "runtime icon missing" in content
        assert "upx=False" in content
        assert "upx=True" not in content

    def test_spec_requires_one_exact_host_matched_vsix(self) -> None:
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "vsix_platform" in content
        assert "vsix_arch" in content
        assert (
            'f"nexus-coding-{product_version}-{vsix_platform}-{vsix_arch}.vsix"'
            in content
        )
        assert "if len(vsix_candidates) != 1" in content
        assert "expected exactly one host-matched VSIX" in content
        assert "gemma-code-*.vsix" not in content

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
            assert "scripts/build-vsix.ps1" in content

    def test_vsix_bundling_workflows_use_the_canonical_build_pipeline(self) -> None:
        workflow_names = (
            "release.yml",
            "ci.yml",
            "installer-build.yml",
            "installer-macos.yml",
            "installer-linux.yml",
        )
        for name in workflow_names:
            content = (WORKFLOWS / name).read_text()
            assert "scripts/build-vsix.ps1" in content
            assert "npx vsce package --no-dependencies" not in content

    def test_manual_windows_rehearsal_builds_exact_desktop_payload_first(self) -> None:
        content = (WORKFLOWS / "installer-build.yml").read_text()
        desktop_build = "name: Build current-version Windows desktop bundle"
        exact_bundle_check = "name: Verify exact current-version desktop bundle"
        installer_build = "name: Build NexusSetup.exe (PyInstaller onefile)"
        assert "node scripts/sync-tauri-version.mjs" in content
        assert "npm run build:sidecar" in content
        assert "npm run build:shell" in content
        assert '"Nexus AI Studio_${version}_x64-setup.exe"' in content
        assert "Expected exactly one Windows desktop bundle for version" in content
        assert content.index(desktop_build) < content.index(exact_bundle_check)
        assert content.index(exact_bundle_check) < content.index(installer_build)

    def test_unix_installer_workflows_are_manual_non_release_rehearsals(self) -> None:
        expected = {
            "installer-macos.yml": "NexusSetup-macos-rehearsal",
            "installer-linux.yml": "NexusSetup-linux-rehearsal",
        }
        for name, artifact_name in expected.items():
            content = (WORKFLOWS / name).read_text()
            assert "Installer rehearsal" in content
            assert "manual non-release rehearsal" in content
            assert "dispatch-only" in content
            assert "workflow_dispatch:" in content
            assert "push:" not in content
            assert "tags:" not in content
            assert '"v*"' not in content
            assert f"name: {artifact_name}" in content

    def test_canonical_vsix_build_is_host_targeted_and_abi_pinned(self) -> None:
        from nexus_installer.engine.extension_installer import (
            SUPPORTED_VSCODE_MAX_EXCLUSIVE,
            SUPPORTED_VSCODE_VERSION,
            VSCE_ENGINES_VSCODE,
        )

        content = (REPO_ROOT / "scripts" / "build-vsix.ps1").read_text()
        manifest = json.loads((REPO_ROOT / "package.json").read_text())
        # @vscode/vsce 2.24.0 src/validation.ts validateEngineCompatibility
        vsce_engine = re.compile(
            r"^\*$|^(\^|>=)?((\d+)|x)\.((\d+)|x)\.((\d+)|x)(\-.*)?$"
        )
        compound = f">={SUPPORTED_VSCODE_VERSION} <{SUPPORTED_VSCODE_MAX_EXCLUSIVE}"
        assert manifest["engines"]["vscode"] == VSCE_ENGINES_VSCODE
        assert f"^{SUPPORTED_VSCODE_VERSION}" == VSCE_ENGINES_VSCODE
        assert vsce_engine.match(manifest["engines"]["vscode"])
        assert vsce_engine.match(compound) is None
        assert manifest["dependencies"]["better-sqlite3"] == "12.11.1"
        assert manifest["dependencies"]["typescript"] == "^5.4.0"
        assert "typescript" not in manifest["devDependencies"]
        assert "$SupportedElectronVersion = '42.8.1'" in content
        assert "NEXUS_ELECTRON_VERSION" not in content
        assert "[string]$ElectronVersion" not in content
        assert "does not match build host" in content
        assert "nexus-coding-$Version-$ResolvedTarget.vsix" in content
        assert "vsce package --target $ResolvedTarget" in content

    def test_windows_installer_requires_its_exact_vsix(self) -> None:
        content = (BUILD_DIR / "build-windows.ps1").read_text()
        assert '"nexus-coding-$Version-win32-$VsixArch.vsix"' in content
        assert "$VsixCandidates.Count -ne 1" in content
        assert (
            "Select-Object -First 1"
            not in content.split("# v1.11.0 Phase 4", maxsplit=1)[0]
        )

    def test_release_workflow_builds_and_routes_three_native_vsixes(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert "release-verification:" in content
        assert "npm run lint --silent" in content
        assert "npm run test --silent" in content
        assert "npm run build --silent" in content
        for platform in ("windows", "macos", "linux"):
            assert f"platform: {platform}" in content
            assert f"name: vsix-{platform}" in content
        assert "name: vsix-${{ matrix.platform }}" in content
        assert "Expected 3 platform-specific VSIX files" in content
        assert "artifacts/nexus-coding-*.vsix" in content
        assert "name: vsix\n" not in content
        assert "needs.build-vsix.outputs" not in content

    def test_release_smokes_final_windows_artifacts_before_upload(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        vsix_smoke = (
            'npm run test:vsix-runtime -- --vsix "nexus-coding-'
            '${{ needs.release-metadata.outputs.version }}-win32-x64.vsix"'
        )
        installer_smoke = (
            "pwsh -NonInteractive -File scripts/installer/build/smoke-windows-exe.ps1"
        )
        assert vsix_smoke in content
        assert "if: matrix.platform == 'windows'" in content
        assert installer_smoke in content
        assert content.index(vsix_smoke) < content.index(
            "name: vsix-${{ matrix.platform }}"
        )
        assert content.index(installer_smoke) < content.index("name: installer-windows")

    def test_windows_exe_smoke_resolves_defaults_after_parameter_binding(self) -> None:
        content = (BUILD_DIR / "smoke-windows-exe.ps1").read_text()
        param_block = content.split(")\n", maxsplit=1)[0]
        assert "$PSScriptRoot" not in param_block
        assert "$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot" in content
        assert "if (-not $ExePath)" in content

    def test_release_workflow_binds_dispatch_to_the_tagged_commit(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert 'EXPECTED_TAG="v${VERSION}"' in content
        assert 'TAG_SHA=$(git rev-parse "refs/tags/${RELEASE_TAG}^{commit}")' in content
        assert '"$TAG_SHA" != "$GITHUB_SHA"' in content
        assert "tag_name: ${{ needs.release-metadata.outputs.tag_name }}" in content
        final_check = "name: Revalidate annotated tag immediately before publication"
        create_release = "name: Create release"
        assert final_check in content
        assert "git ls-remote --tags origin" in content
        assert "has no peeled commit on origin" in content
        assert '"$TAG_SHA" != "$EXPECTED_SHA"' in content
        assert "target_commitish: ${{ github.sha }}" in content
        assert content.index(final_check) < content.index(create_release)

    def test_release_notes_extraction_keeps_markdown_subsections(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert 'index($0, "# [" version "]") == 1' in content
        assert "flag && /^# / { exit }" in content
        assert "^#+ /{flag=0}" not in content
        changelog = (REPO_ROOT / "CHANGELOG.md").read_text()
        release_block = changelog.split("# [2.3.1]", maxsplit=1)[1].split(
            "# [2.3.0]", maxsplit=1
        )[0]
        assert "### Features" in release_block
        assert "### Bug Fixes" in release_block
        assert "**Packaging:**" in release_block

    def test_release_workflow_stages_only_the_current_windows_desktop_payload(
        self,
    ) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert '"Nexus AI Studio_${v}_x64-setup.exe"' in content
        assert "Expected exactly one Windows desktop bundle" in content
        assert "name: desktop-bundle-windows" in content
        assert "desktop-bundle-${{ matrix.platform }}" not in content
        assert '"Nexus AI Studio_${V}"*.dmg' not in content
        assert '"*${V}*.AppImage"' not in content
        assert '"*${V}*.deb"' not in content
        assert "bundle/nsis/*-setup.exe" not in content
        assert "bundle/dmg/*.dmg" not in content
        assert "pick=$(ls -t" not in content

    def test_platform_vsix_builders_pin_the_documented_native_targets(self) -> None:
        release = (WORKFLOWS / "release.yml").read_text()
        rehearsal = (WORKFLOWS / "installer-linux.yml").read_text()
        install_doc = (REPO_ROOT / "docs" / "install.md").read_text()

        vsix_job = release.split("  build-vsix:\n", maxsplit=1)[1].split(
            "  build-installer-windows:\n", maxsplit=1
        )[0]
        linux_matrix = vsix_job.split("- platform: linux", maxsplit=1)[1].split(
            "steps:", maxsplit=1
        )[0]
        assert "os: ubuntu-22.04" in linux_matrix
        assert "os: ubuntu-latest" not in linux_matrix
        assert "os: macos-15" in vsix_job
        assert "vsce_arch: arm64" in vsix_job
        assert "Runner architecture mismatch" in vsix_job
        assert "runs-on: ubuntu-22.04" in rehearsal
        assert "glibc 2.35+" in rehearsal
        assert "glibc 2.35+" in install_doc
        assert "Ubuntu 22.04+" in install_doc
        assert "Debian 12+" in install_doc
        assert "glibc 2.31+" not in install_doc

    def test_release_workflow_serializes_tags_and_clears_cached_bundles(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert "group: release-${{ github.event_name == 'workflow_dispatch'" in content
        assert "cancel-in-progress: false" in content
        cleanup_step = "name: Remove cached Tauri bundle outputs"
        assert cleanup_step in content
        assert "Refusing to remove bundle path outside the workspace" in content
        assert "Remove-Item -LiteralPath $Candidate -Recurse -Force" in content
        assert content.index(cleanup_step) < content.index(
            "name: Build Windows Tauri payload"
        )

    def test_release_publishes_only_the_supported_windows_installer(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert "build-installer-windows:" in content
        assert "build-installer-macos:" not in content
        assert "build-installer-linux:" not in content
        assert "artifacts/NexusSetup.exe" in content
        assert "artifacts/NexusSetup.dmg" not in content
        assert "artifacts/NexusSetup-x86_64.AppImage" not in content
        assert "artifacts/Nexus-Desktop_*" not in content
        assert "Nexus-Desktop_${VERSION}_universal.dmg" not in content
        assert "Nexus-Desktop_${VERSION}_amd64.AppImage" not in content
        assert "Nexus-Desktop_${VERSION}_amd64.deb" not in content
        checksum = content.split("name: Generate SHA256SUMS.txt", maxsplit=1)[1].split(
            "name: Extract release notes", maxsplit=1
        )[0]
        assert '"${VSIX_FILES[@]}"' in checksum
        assert "NexusSetup.exe" in checksum
        assert "Nexus-Desktop_" not in checksum

    def test_release_workflow_scopes_write_permission_to_publication(self) -> None:
        content = (WORKFLOWS / "release.yml").read_text()
        assert "permissions:\n  contents: read" in content
        create_release = content.split("  create-release:\n", maxsplit=1)[1]
        assert "    permissions:\n      contents: write" in create_release
        pre_publication = content.split("  create-release:\n", maxsplit=1)[0]
        assert "contents: write" not in pre_publication

    def test_vscodeignore_excludes_local_state_and_test_artifacts(self) -> None:
        ignored = (REPO_ROOT / ".vscodeignore").read_text().splitlines()
        for pattern in (
            ".coverage",
            ".coverage.*",
            ".pytest_cache/**",
            "**/.pytest_cache/**",
            ".ruff_cache/**",
            "**/.ruff_cache/**",
            "*.log",
            "**/*.log",
            ".agents/**",
            ".codex/**",
            ".husky/**",
            ".nexus/**",
        ):
            assert pattern in ignored

    def test_workflows_upload_the_single_artifact_from_repo_root_dist(self) -> None:
        # v1.9.0 Phase 1 (T103): each manual workflow uploads its artifact from
        # repo-root dist/ (no deep scripts/installer/dist path). Unix artifacts
        # are explicitly rehearsal-only and are not release assets.
        checks = {
            "installer-build.yml": "dist/NexusSetup.exe",
            "installer-macos.yml": "dist/NexusSetup.dmg",
            "installer-linux.yml": "dist/NexusSetup-x86_64.AppImage",
        }
        for name, artifact in checks.items():
            content = (WORKFLOWS / name).read_text()
            assert f"path: {artifact}" in content
            assert "scripts/installer/dist" not in content


class TestSidecarPackagingContracts:
    """v2.2.0 Phase 1 -- static parity guards for the sidecar packaging chain.

    These pin the three facts that made a v2.1.0 install functionally inert:
    the sidecar was never bundled into the Tauri app, the model catalog was
    never copied next to the sidecar bundle, and the diffusion runtime sources
    were never shipped by the installer.
    """

    def test_tauri_bundle_ships_sidecar_dist(self) -> None:
        import json

        conf = json.loads(
            (REPO_ROOT / "desktop" / "src-tauri" / "tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )
        resources = conf.get("bundle", {}).get("resources")
        assert resources, "tauri.conf.json bundle.resources is missing"
        assert resources.get("../sidecar/dist") == "sidecar/dist"

    def test_sidecar_esbuild_copies_catalog(self) -> None:
        content = (REPO_ROOT / "desktop" / "sidecar" / "esbuild.config.mjs").read_text(
            encoding="utf-8"
        )
        assert "catalog.json" in content

    def test_sidecar_esbuild_copies_unsloth_pins(self) -> None:
        content = (REPO_ROOT / "desktop" / "sidecar" / "esbuild.config.mjs").read_text(
            encoding="utf-8"
        )
        assert "unsloth-pins.json" in content
        assert "The bundled sidecar loads it at import time" in content
        assert "22.11.0" in content
        assert "prebuild-install" in content

    def test_spec_bundles_diffusion_runtime_sources(self) -> None:
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert '"runtimes"' in content
        assert "runtimes sources missing" in content


class TestPlatformContracts:
    """Declarative parity gate for the three installer build targets."""

    def test_contract_covers_platforms_and_shared_capabilities(self) -> None:
        contract = json.loads(
            (BUILD_DIR / "platform-contracts.json").read_text(encoding="utf-8")
        )
        assert contract["schema"] == "nexus-installer-platform-contract/v1"
        assert set(contract["platforms"]) == {"windows", "macos", "linux"}
        assert contract["shared"]["documentDefaults"] == "supported"
        assert contract["shared"]["runtimeSources"] == "embedded"
        assert contract["shared"]["hubCatalogFallback"] == "network-sync"

    def test_contract_paths_match_the_build_scripts_and_workflows(self) -> None:
        contract = json.loads(
            (BUILD_DIR / "platform-contracts.json").read_text(encoding="utf-8")
        )
        for platform in contract["platforms"].values():
            script = REPO_ROOT / platform["buildScript"]
            workflow = REPO_ROOT / platform["workflow"]
            assert script.is_file()
            assert workflow.is_file()
            artifact_name = Path(platform["artifact"]).name
            assert artifact_name in script.read_text(encoding="utf-8")
            assert f"path: {platform['artifact']}" in workflow.read_text(
                encoding="utf-8"
            )

    def test_contract_records_platform_specific_support(self) -> None:
        contract = json.loads(
            (BUILD_DIR / "platform-contracts.json").read_text(encoding="utf-8")
        )["platforms"]
        assert contract["windows"]["desktopPayload"] == "embedded"
        assert contract["windows"]["taskbarTransparency"] == "supported"
        assert contract["windows"]["createNoWindow"] == "supported"
        for name in ("macos", "linux"):
            assert contract[name]["desktopPayload"] == "not-staged"
            assert contract[name]["taskbarTransparency"] == "not-applicable"
            assert contract[name]["createNoWindow"] == "not-applicable"
            assert contract[name]["gap"] == "DF-18"
