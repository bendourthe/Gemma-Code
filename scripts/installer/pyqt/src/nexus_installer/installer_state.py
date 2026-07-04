"""Shared wizard state dataclass threaded through all pages."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field

# v1.1.0 Phase 14.5 -- the 10 GB OS reserve floor used by the disk-aware
# selection guard. Configurable via the `--disk-reserve-gb` CLI flag.
DEFAULT_DISK_RESERVE_GB = 10


def _default_install_path() -> str:
    # v1.9.0 Phase 3 (T305): the product installs as "Nexus AI Studio"; the
    # default path is NexusAI on every OS (never the legacy GemmaCode).
    if sys.platform == "win32":
        return r"C:\Program Files\NexusAI"
    if sys.platform == "darwin":
        return "/Applications/NexusAI"
    return "/usr/local/share/nexus-ai"


@dataclass
class InstallerState:
    """Mutable state shared across all wizard pages."""

    install_path: str = field(default_factory=_default_install_path)
    vscode_path: str = ""
    python_path: str = ""
    ollama_installed: bool = False
    gpu_vendor: str = ""  # "nvidia", "amd", "apple", "intel", "none"
    gpu_name: str = ""
    vram_mb: int = 0
    recommended_model: str = ""
    selected_model: str = ""
    disk_space_gb: float = 0.0
    platform: str = field(default_factory=lambda: sys.platform)
    components_to_install: list[str] = field(
        default_factory=lambda: ["extension", "ollama", "venv", "model", "desktop"]
    )
    ollama_url: str = "http://localhost:11434"
    enable_thinking: bool = True
    enable_memory: bool = True
    install_log: list[str] = field(default_factory=list)
    failed_steps: list[str] = field(default_factory=list)

    # v1.1.0 Phase 14 -- cross-OS additions.
    free_disk_gb: int = 0
    selected_models_gb: float = 0.0
    disk_reserve_gb: int = DEFAULT_DISK_RESERVE_GB
    install_vscode_extension: bool = True

    # v1.8.0 Phase 3 -- protocol-routed multi-model selection.
    # `selected_model_ids` (catalog ids, any protocol) wins over the legacy
    # single `selected_model` when non-empty; `failed_models` collects
    # per-model failures for the complete-page summary; `models_root`
    # overrides the default `~/.nexus/models` weights destination.
    selected_model_ids: list[str] = field(default_factory=list)
    failed_models: list[str] = field(default_factory=list)
    models_root: str = ""

    # v1.8.0 Phase 2 -- Nexus desktop app provisioning.
    desktop_install_dir: str = ""  # empty = platform installer default
    desktop_bundle_override: str = ""  # local bundle path; skips release fetch
    desktop_installed: bool = False
    desktop_health_ok: bool = False
    desktop_exe_path: str = ""
    launch_desktop_on_finish: bool = True

    def can_select_model(self, model_gb: float) -> bool:
        """Return True when adding `model_gb` keeps the OS reserve intact."""
        if self.free_disk_gb <= 0:
            # Disk size unknown (probe failed) -- allow selection so the
            # wizard does not lock the user out; the final Install-click
            # guard will re-check.
            return True
        remaining = self.free_disk_gb - self.selected_models_gb - model_gb
        return remaining >= self.disk_reserve_gb
