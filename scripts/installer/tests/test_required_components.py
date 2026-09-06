"""v2.4.7 Phase 2 (T009) -- components derived from the model selection.

The Configuration step asked eight questions. Three were load-bearing:
unchecking Ollama, the Python environment, or the desktop app silently broke
models the user had chosen two steps earlier. Two were not install decisions
at all. These tests pin the resolver that replaced the three, and the
additive fold that keeps the genuinely optional choices intact.
"""

from __future__ import annotations

from nexus_installer.engine.required_components import (
    apply_required_components,
    required_components,
)
from nexus_installer.installer_state import InstallerState

OLLAMA_MODEL = {"id": "gemma4:12b", "source": {"protocol": "ollama"}}
HF_IMAGE_MODEL = {"id": "realvisxl-v5", "source": {"protocol": "huggingface"}}
HF_AUDIO_MODEL = {"id": "kokoro-82m", "source": {"protocol": "huggingface"}}

CATALOG = {
    "gemma4:12b": OLLAMA_MODEL,
    "realvisxl-v5": HF_IMAGE_MODEL,
    "kokoro-82m": HF_AUDIO_MODEL,
}


class TestRequiredComponents:
    def test_desktop_is_always_required(self) -> None:
        # The desktop app is the product. An install without it is a VS Code
        # extension install, which the extension checkbox already expresses.
        assert required_components([], {}).requires("desktop") is True

    def test_a_chat_selection_requires_ollama_not_the_python_env(self) -> None:
        resolved = required_components(["gemma4:12b"], CATALOG)
        assert resolved.requires("ollama") is True
        assert resolved.requires("venv") is False

    def test_an_image_selection_requires_the_python_env_not_ollama(self) -> None:
        resolved = required_components(["realvisxl-v5"], CATALOG)
        assert resolved.requires("venv") is True
        assert resolved.requires("ollama") is False

    def test_a_mixed_selection_requires_both(self) -> None:
        resolved = required_components(["gemma4:12b", "kokoro-82m"], CATALOG)
        assert resolved.requires("ollama") is True
        assert resolved.requires("venv") is True

    def test_an_uncatalogued_id_still_requires_ollama(self) -> None:
        # Unknown ids route to `ollama pull` verbatim (the --model override
        # contract), so they need the daemon exactly as a catalogued chat
        # model does. Missing this would ship an install whose only model
        # cannot be served.
        resolved = required_components(["qwen3-coding:30b-a3b-offload"], {})
        assert resolved.requires("ollama") is True

    def test_an_empty_selection_still_requires_the_desktop_app(self) -> None:
        resolved = required_components([], CATALOG)
        assert resolved.ids == ("desktop",)

    def test_every_required_component_carries_a_reason(self) -> None:
        # The list is shown instead of asked, so each row has to explain
        # itself; an unexplained "will be installed" is just a different
        # opaque decision.
        resolved = required_components(["gemma4:12b", "realvisxl-v5"], CATALOG)
        assert len(resolved.items) == 3
        for item in resolved.items:
            assert item.reason.strip()
            assert item.label.strip()

    def test_ollama_is_ordered_after_the_python_env(self) -> None:
        # Install order is preserved so the engine's step sequence does not
        # change with this refactor.
        resolved = required_components(["gemma4:12b", "realvisxl-v5"], CATALOG)
        assert resolved.ids == ("desktop", "venv", "ollama")


class TestApplyRequiredComponents:
    def test_folds_required_components_into_state(self) -> None:
        state = InstallerState()
        state.components_to_install = []
        state.selected_model_ids = ["gemma4:12b"]
        apply_required_components(state, CATALOG)
        assert "desktop" in state.components_to_install
        assert "ollama" in state.components_to_install

    def test_is_additive_and_keeps_optional_choices(self) -> None:
        # The user's optional picks live in the same list and must survive.
        state = InstallerState()
        state.components_to_install = ["extension", "shortcut"]
        state.selected_model_ids = ["realvisxl-v5"]
        apply_required_components(state, CATALOG)
        assert "extension" in state.components_to_install
        assert "shortcut" in state.components_to_install
        assert "venv" in state.components_to_install

    def test_is_idempotent(self) -> None:
        # The page recomputes on every show; a duplicate entry would make the
        # installer run a step twice.
        state = InstallerState()
        state.components_to_install = []
        state.selected_model_ids = ["gemma4:12b"]
        apply_required_components(state, CATALOG)
        apply_required_components(state, CATALOG)
        assert state.components_to_install.count("ollama") == 1
        assert state.components_to_install.count("desktop") == 1

    def test_reflects_a_changed_selection(self) -> None:
        state = InstallerState()
        state.components_to_install = []
        state.selected_model_ids = ["gemma4:12b"]
        apply_required_components(state, CATALOG)
        state.selected_model_ids = ["gemma4:12b", "realvisxl-v5"]
        resolved = apply_required_components(state, CATALOG)
        assert resolved.requires("venv") is True
        assert "venv" in state.components_to_install
