"""Shared wizard state dataclass threaded through all pages."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - annotation only
    from nexus_installer.engine.installed_models import InstalledReport

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


def _empty_installed_report() -> InstalledReport:
    from nexus_installer.engine.installed_models import InstalledReport

    return InstalledReport()


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
    # Whole-GB system RAM from HostProfile. 0 means the probe failed (unknown),
    # not a proven 0 GB machine. Never reuse free_disk_gb as a stand-in.
    total_ram_gb: int = 0
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
    optional_failed_steps: list[str] = field(default_factory=list)

    # v1.11.0 Phase 3 (T303) -- structured, user-facing failure surfaces.
    # A skipped step is a clear outcome, not an error (e.g. the VS Code
    # extension when VS Code is absent). A step failure carries a one-sentence
    # plain-language summary plus a suggested next action; the installing page
    # (P5) renders these next to the View/Copy/Save log actions, and the
    # headless smoke result includes them verbatim.
    skipped_steps: list[str] = field(default_factory=list)
    step_failures: list[dict[str, Any]] = field(default_factory=list)
    step_results: list[dict[str, Any]] = field(default_factory=list)

    # v1.11.0 Phase 7 (T704) -- resume support. Steps a resumed run treats as
    # already satisfied: the engine marks them done up front and does not
    # re-execute them (the resume plan is derived from the persisted state file
    # by nexus_installer.background.resume). Empty for a normal fresh install.
    completed_steps: list[str] = field(default_factory=list)

    # v1.1.0 Phase 14 -- cross-OS additions.
    free_disk_gb: int = 0
    selected_models_gb: float = 0.0
    disk_reserve_gb: int = DEFAULT_DISK_RESERVE_GB
    install_vscode_extension: bool = True
    # v2.1 DF-15 -- opt-in Unsloth Core venv. Off by default. LGPL zoo notice
    # is shown next to the checkbox.
    install_unsloth: bool = False

    # v1.8.0 Phase 3 -- protocol-routed multi-model selection.
    # `selected_model_ids` (catalog ids, any protocol) wins over the legacy
    # single `selected_model` when non-empty; `failed_models` collects
    # per-model failures for the complete-page summary; `models_root`
    # overrides the default `~/.nexus/models` weights destination.
    selected_model_ids: list[str] = field(default_factory=list)
    failed_models: list[str] = field(default_factory=list)
    models_root: str = ""
    # v1.19.2 -- official precision-variant override (empty = hardware-aware default).
    weights_variant: str = ""

    # v2.4.5 Phase 2 -- which selected models are already on disk. Populated by
    # the picker via `engine.installed_models.probe_installed_models`. Kept as
    # a field rather than recomputed per page so the filesystem is walked once
    # per wizard session, not once per card. `selected_models_gb` deliberately
    # stays the FULL selection total so no existing consumer changes meaning;
    # `pending_models_gb` is the new quantity the disk guard should compare.
    installed_report: InstalledReport = field(
        # Imported lazily: `installed_models` reaches the weights puller, which
        # imports this module back, so a module-level import here is a cycle.
        default_factory=lambda: _empty_installed_report()
    )
    pending_models_gb: float = 0.0

    # v1.15.0 Phase 3 (Issue 2) -- post-install summary + retry surfaces.
    # `model_failures` maps a failed model id to its raw engine reason (mapped to
    # plain language by engine.install_summary); `gated_skipped` collects models
    # the user declined at the guided Hugging Face step so the summary can show
    # them as "skipped - needs token", distinct from a failure.
    model_failures: dict[str, str] = field(default_factory=dict)
    gated_skipped: list[str] = field(default_factory=list)

    # v1.14.0 Phase 2 -- Hugging Face token for gated open-weight opt-ins,
    # captured by the guided auth step (widgets.gated_auth_dialog) or resolved
    # from the environment / HF CLI cache (engine.hf_auth.discover_hf_token).
    # Runtime-only: sent as an Authorization header, never logged or persisted
    # by the installer itself.
    hf_token: str = ""

    # v1.8.0 Phase 2 -- Nexus desktop app provisioning.
    desktop_install_dir: str = ""  # empty = platform installer default
    desktop_bundle_override: str = ""  # local bundle path; skips release fetch
    desktop_installed: bool = False
    desktop_health_ok: bool = False
    # v2.2.0 Phase 3 (3.1): Nexus-Hub catalog provisioning outcome.
    hub_catalog_source: str = ""
    hub_catalog_tag: str = ""
    hub_catalog_error: str = ""
    # v2.2.0 Phase 1 (1.4): human-readable health verdict for the Complete page
    # (sidecar ok + catalog rows, or the failure reason).
    desktop_health_detail: str = ""
    desktop_exe_path: str = ""
    launch_desktop_on_finish: bool = True

    def record_step_failure(
        self,
        step: str,
        summary: str,
        suggestion: str,
        *,
        required: bool = True,
        error_code: str = "STEP_FAILED",
        retryable: bool = False,
    ) -> None:
        """Record a plain-language failure for `step` (T303).

        `summary` is one user-facing sentence stating what happened;
        `suggestion` is the next action a non-technical user can take.
        """
        self.step_failures.append(
            {
                "step": step,
                "summary": summary,
                "suggestion": suggestion,
            }
        )

    def record_step_result(
        self,
        step: str,
        status: str,
        *,
        required: bool,
        error_code: str = "",
        retryable: bool = False,
    ) -> None:
        """Replace the terminal outcome for one step with typed metadata."""
        self.step_results = [r for r in self.step_results if r.get("step") != step]
        self.step_results.append(
            {
                "step": step,
                "status": status,
                "required": required,
                "error_code": error_code,
                "retryable": retryable,
            }
        )

    def record_skipped_step(self, step: str) -> None:
        """Mark `step` as deliberately skipped (a clear outcome, not an error)."""
        if step not in self.skipped_steps:
            self.skipped_steps.append(step)

    def apply_total_ram_gb(self, total_ram_gb: int) -> None:
        """Copy a successful RAM probe. Never overwrite a known value with 0."""
        if total_ram_gb > 0:
            self.total_ram_gb = int(total_ram_gb)

    def apply_disk_free_bytes(self, free_bytes: int) -> None:
        """Write both disk fields from one byte count (host_detect GB floor)."""
        gb = max(0, int(free_bytes // (1024**3)))
        self.free_disk_gb = gb
        self.disk_space_gb = float(gb)

    def apply_disk_free_gb(self, gb_free: float) -> None:
        """Write both disk fields from a GB reading (welcome/prerequisites)."""
        self.disk_space_gb = float(gb_free)
        self.free_disk_gb = max(0, int(gb_free))

    def can_select_model(self, model_gb: float) -> bool:
        """Return True when adding `model_gb` keeps the OS reserve intact."""
        if self.free_disk_gb <= 0:
            # Disk size unknown (probe failed) -- allow selection so the
            # wizard does not lock the user out; the final Install-click
            # guard will re-check.
            return True
        remaining = self.free_disk_gb - self.selected_models_gb - model_gb
        return remaining >= self.disk_reserve_gb
