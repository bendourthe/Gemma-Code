"""v1.11.0 Phase 2 (T202) -- headless-smoke profiles and result contract.

A smoke profile is a small JSON file that drives the headless install engine
without the wizard: which components run, which models are selected, and where
everything lands. The clean-machine harnesses (Windows Sandbox, Docker Linux)
pass a profile in via ``--headless-smoke <profile.json>`` and collect the
machine-readable result written by ``--smoke-output <path>``.

Profile schema (all fields optional except ``name``)::

    {
      "name": "sandbox-minimal",
      "components": ["ollama", "venv"],
      "selected_model_ids": ["nomic-embed-text"],
      "install_path": "C:\\\\NexusSmoke",
      "models_root": "C:\\\\NexusSmoke\\\\models",
      "ollama_url": "http://127.0.0.1:11434",
      "desktop_bundle": ""
    }

The result JSON is versioned (``schema``) so harness runners and CI can
assert against a stable contract.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from nexus_installer.installer_state import InstallerState

SMOKE_RESULT_SCHEMA = "nexus-smoke-result/v1"

VALID_COMPONENTS = ("ollama", "extension", "venv", "model", "desktop")


class SmokeProfileError(ValueError):
    """A smoke profile file is missing or malformed."""


def load_smoke_profile(path: str | Path) -> dict[str, Any]:
    """Read and validate a smoke profile JSON. Raises SmokeProfileError."""
    p = Path(path)
    try:
        # utf-8-sig: tolerate the BOM that Windows PowerShell's
        # `Out-File -Encoding utf8` prepends to operator-authored profiles.
        data = json.loads(p.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise SmokeProfileError(f"cannot read profile {p}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SmokeProfileError(f"profile {p} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SmokeProfileError(f"profile {p} must be a JSON object")
    name = data.get("name")
    if not isinstance(name, str) or not name:
        raise SmokeProfileError(f"profile {p} needs a non-empty 'name'")
    components = data.get("components")
    if components is not None and (
        not isinstance(components, list)
        or not all(
            isinstance(c, str) and c in VALID_COMPONENTS for c in components
        )
    ):
        raise SmokeProfileError(
            f"profile {p}: 'components' must be a list drawn from "
            f"{VALID_COMPONENTS}"
        )
    models = data.get("selected_model_ids")
    if models is not None and (
        not isinstance(models, list) or not all(isinstance(m, str) for m in models)
    ):
        raise SmokeProfileError(
            f"profile {p}: 'selected_model_ids' must be a list of strings"
        )
    return data


def apply_smoke_profile(state: InstallerState, profile: dict[str, Any]) -> None:
    """Apply a validated profile onto the installer state (profile wins)."""
    if isinstance(profile.get("components"), list):
        state.components_to_install = list(profile["components"])
    if isinstance(profile.get("selected_model_ids"), list):
        state.selected_model_ids = list(profile["selected_model_ids"])
        # The legacy single-model default must not leak into a profile run.
        state.selected_model = ""
    for state_field, key in (
        ("install_path", "install_path"),
        ("models_root", "models_root"),
        ("ollama_url", "ollama_url"),
        ("desktop_bundle_override", "desktop_bundle"),
    ):
        value = profile.get(key)
        if isinstance(value, str) and value:
            setattr(state, state_field, value)


def build_smoke_result(
    profile_name: str,
    state: InstallerState,
    steps_done: list[str],
    steps_failed: list[str],
    log_entries: list[dict[str, str]],
) -> dict[str, Any]:
    """Assemble the versioned machine-readable result object."""
    return {
        "schema": SMOKE_RESULT_SCHEMA,
        "profile": profile_name,
        "success": not steps_failed,
        "steps_done": steps_done,
        "steps_failed": steps_failed,
        "skipped_steps": list(state.skipped_steps),
        "failed_models": list(state.failed_models),
        # T303: one plain-language sentence + suggested action per failure.
        "step_failures": list(state.step_failures),
        "install_path": state.install_path,
        "components": list(state.components_to_install),
        "logs": log_entries,
    }


def write_smoke_result(path: str | Path, result: dict[str, Any]) -> None:
    """Write the result JSON (parents created; UTF-8; trailing newline)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
