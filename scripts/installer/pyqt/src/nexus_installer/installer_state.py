"""Shared wizard state dataclass threaded through all pages."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field


def _default_install_path() -> str:
    if sys.platform == "win32":
        return r"C:\Program Files\GemmaCode"
    if sys.platform == "darwin":
        return "/Applications/GemmaCode"
    return "/usr/local/share/gemma-code"


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
        default_factory=lambda: ["extension", "ollama", "venv", "model"]
    )
    ollama_url: str = "http://localhost:11434"
    enable_thinking: bool = True
    enable_memory: bool = True
    install_log: list[str] = field(default_factory=list)
    failed_steps: list[str] = field(default_factory=list)
