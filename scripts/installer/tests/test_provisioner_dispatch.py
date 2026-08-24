"""v1.1.0 Phase 14.2 -- tests for OS-aware provisioner dispatch."""

from __future__ import annotations

from nexus_installer.engine.host_detect import HostProfile
from nexus_installer.engine.provisioner_dispatch import chain_for, run_chain


def _profile(**overrides) -> HostProfile:
    defaults = dict(
        os_family="windows",
        os_version="Windows 11",
        arch="x86_64",
        cpu_model="i9",
        total_ram_gb=32,
        gpu_vendor="nvidia",
        gpu_model="RTX 4070",
        total_vram_gb=12,
        driver_version="535.86",
        cuda_compatible=True,
        metal_compatible=False,
        rocm_compatible=False,
        free_disk_gb=100,
        target_install_path=r"C:\Nexus",
    )
    defaults.update(overrides)
    return HostProfile(**defaults)


class TestChainFor:
    def test_windows_cuda(self) -> None:
        chain = chain_for(_profile())
        assert chain[0] == "cuda"
        assert "windows-python" in chain
        assert "ollama-windows" not in chain or chain[3] == "ollama-windows"

    def test_windows_cpu_only(self) -> None:
        chain = chain_for(_profile(cuda_compatible=False, gpu_vendor="none"))
        assert chain[0] == "cpu-only"

    def test_macos_apple_silicon(self) -> None:
        chain = chain_for(
            _profile(
                os_family="macos",
                arch="arm64",
                gpu_vendor="apple",
                cuda_compatible=False,
                metal_compatible=True,
            )
        )
        assert chain[0] == "metal"
        assert "macos-python" in chain
        assert "ollama-macos" in chain

    def test_macos_intel_falls_back_to_cpu(self) -> None:
        chain = chain_for(
            _profile(
                os_family="macos",
                arch="x86_64",
                gpu_vendor="intel",
                cuda_compatible=False,
                metal_compatible=False,
            )
        )
        assert chain[0] == "cpu-only"

    def test_linux_nvidia(self) -> None:
        chain = chain_for(_profile(os_family="linux", target_install_path="/home/x"))
        assert chain[0] == "cuda-linux"
        assert "ollama-linux" in chain

    def test_linux_amd_rocm(self) -> None:
        chain = chain_for(
            _profile(
                os_family="linux",
                gpu_vendor="amd",
                cuda_compatible=False,
                rocm_compatible=True,
            )
        )
        assert chain[0] == "rocm"

    def test_linux_cpu_only(self) -> None:
        chain = chain_for(
            _profile(
                os_family="linux",
                gpu_vendor="none",
                cuda_compatible=False,
                rocm_compatible=False,
            )
        )
        assert chain[0] == "cpu-only"

    def test_unknown_os_returns_cpu_chain(self) -> None:
        chain = chain_for(
            _profile(os_family="unknown", cuda_compatible=False, metal_compatible=False)
        )
        assert chain[0] == "cpu-only"

    def test_unsloth_appended_only_when_opted_in(self) -> None:
        assert "unsloth" not in chain_for(_profile())
        assert chain_for(_profile(), include_unsloth=True)[-1] == "unsloth"
        # v1.10.0 Phase 5: the bundled-baseline provisioner is removed; no host
        # chain may still reference it.
        for profile in (
            _profile(),
            _profile(os_family="macos", metal_compatible=True, cuda_compatible=False),
            _profile(os_family="linux", target_install_path="/home/x"),
            _profile(
                os_family="unknown", cuda_compatible=False, metal_compatible=False
            ),
        ):
            assert "devai-hub" not in chain_for(profile)


class _StubProvisioner:
    def __init__(
        self, name: str, *, succeed: bool = True, raises: bool = False
    ) -> None:
        self.name = name
        self._succeed = succeed
        self._raises = raises
        self.called = False

    def install(self, log) -> bool:
        self.called = True
        if self._raises:
            raise RuntimeError("boom")
        return self._succeed


def _logger(sink: list[tuple[str, str]]):
    return lambda msg, lvl: sink.append((msg, lvl))


class TestRunChain:
    def test_all_succeed(self) -> None:
        logs: list[tuple[str, str]] = []
        provs = {"a": _StubProvisioner("a"), "b": _StubProvisioner("b")}
        done, failed = run_chain(["a", "b"], provs, _logger(logs))
        assert done == ["a", "b"]
        assert failed == []
        assert provs["a"].called and provs["b"].called

    def test_failure_recorded(self) -> None:
        provs = {
            "a": _StubProvisioner("a", succeed=False),
            "b": _StubProvisioner("b"),
        }
        done, failed = run_chain(["a", "b"], provs, lambda msg, lvl: None)
        assert done == ["b"]
        assert failed == ["a"]

    def test_exception_recorded(self) -> None:
        provs = {"a": _StubProvisioner("a", raises=True)}
        logs: list[tuple[str, str]] = []
        done, failed = run_chain(["a"], provs, _logger(logs))
        assert done == []
        assert failed == ["a"]
        assert any(lvl == "error" for _, lvl in logs)

    def test_missing_provisioner_is_skipped(self) -> None:
        logs: list[tuple[str, str]] = []
        done, failed = run_chain(["missing"], {}, _logger(logs))
        assert done == []
        assert failed == []
        assert any("missing" in m for m, _ in logs)
