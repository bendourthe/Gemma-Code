"""v1.16.0 Phase 3 (adoption item A5) -- HuggingFace revision pinning.

Pinning is the real integrity control for catalog entries whose `sha256` values
are still placeholders, and it is MANDATORY for a model that ships executable
code (`trust_remote_code`): without it, every install could fetch different code
from a moved `main`.

The load-bearing assertions are the fail-closed ones -- a malformed revision and
an unpinned `trustRemoteCode` entry must both raise rather than silently
resolving `main`.
"""

from __future__ import annotations

import pytest

from nexus_installer.engine.hf_weights_puller import (
    HF_DEFAULT_REVISION,
    ManifestError,
    load_weights_manifest,
)
from nexus_installer.engine.model_preflight import _hf_probe_url

PINNED = "07dea832e22aefee32ad281d4b80551282e1c168"


def _entry(**over: object) -> dict[str, object]:
    entry: dict[str, object] = {
        "id": "unlimited-ocr-3b",
        "sizeGB": 6.7,
        "source": {
            "protocol": "huggingface",
            "repo": "baidu/Unlimited-OCR",
            "url": "https://huggingface.co/baidu/Unlimited-OCR/resolve/main/model.safetensors",
            "sha256": "0" * 64,
        },
        "weights": {
            "layoutVersion": 1,
            "files": [{"path": "model.safetensors", "sha256": "0" * 64}],
        },
    }
    source_over = over.pop("source", None)
    if isinstance(source_over, dict):
        entry["source"] = {**entry["source"], **source_over}  # type: ignore[dict-item]
    entry.update(over)
    return entry


class TestRevisionParsing:
    def test_defaults_to_main_when_unpinned(self):
        manifest = load_weights_manifest(_entry())
        assert manifest.revision == HF_DEFAULT_REVISION
        assert manifest.is_pinned is False

    def test_reads_a_pinned_commit_sha(self):
        manifest = load_weights_manifest(_entry(source={"revision": PINNED}))
        assert manifest.revision == PINNED
        assert manifest.is_pinned is True

    @pytest.mark.parametrize(
        "bad",
        ["main", "v1.0", "abc123", PINNED.upper(), PINNED[:-1], 42, ""],
    )
    def test_rejects_anything_that_is_not_a_commit_sha(self, bad):
        # A branch or tag is MUTABLE, which is exactly what pinning prevents --
        # so it is a hard error, not a silent fall back to main.
        with pytest.raises(ManifestError) as excinfo:
            load_weights_manifest(_entry(source={"revision": bad}))
        assert "revision" in str(excinfo.value)


class TestTrustRemoteCodeGate:
    def test_trust_remote_code_requires_a_pin(self):
        with pytest.raises(ManifestError) as excinfo:
            load_weights_manifest(_entry(trustRemoteCode=True))
        assert "pinned source.revision" in str(excinfo.value)

    def test_trust_remote_code_with_a_pin_is_accepted(self):
        manifest = load_weights_manifest(
            _entry(trustRemoteCode=True, source={"revision": PINNED})
        )
        assert manifest.revision == PINNED

    def test_an_ordinary_entry_needs_no_pin(self):
        assert load_weights_manifest(_entry(trustRemoteCode=False)).revision == "main"


class TestProbeUrl:
    def test_preflight_probes_the_pinned_revision(self):
        # The reachability check must target the SAME commit the download will,
        # or a probe could pass against `main` while the pinned commit is gated.
        assert _hf_probe_url(_entry(source={"revision": PINNED})) == (
            f"https://huggingface.co/baidu/Unlimited-OCR/resolve/{PINNED}/model.safetensors"
        )

    def test_preflight_probes_main_when_unpinned(self):
        url = _hf_probe_url(_entry())
        assert url is not None and "/resolve/main/" in url


class TestCatalogEntriesArePinned:
    """The two v1.16.0 document models must ship pinned."""

    def _catalog_entry(self, model_id: str) -> dict[str, object]:
        import json
        from pathlib import Path

        root = Path(__file__).resolve().parents[3]
        catalog = json.loads(
            (root / "core" / "registry" / "catalog.json").read_text("utf-8")
        )
        for entry in catalog["models"]:
            if entry["id"] == model_id:
                return entry
        raise AssertionError(f"{model_id} missing from catalog.json")

    @pytest.mark.parametrize("model_id", ["unlimited-ocr-3b", "rapidocr-ppocrv4"])
    def test_document_models_pin_a_commit(self, model_id):
        manifest = load_weights_manifest(self._catalog_entry(model_id))
        assert manifest.is_pinned, f"{model_id} must pin source.revision"

    def test_the_trust_remote_code_model_is_declared_and_pinned(self):
        entry = self._catalog_entry("unlimited-ocr-3b")
        assert entry.get("trustRemoteCode") is True
        # load_weights_manifest enforces the pin; this asserts it parses at all.
        assert load_weights_manifest(entry).is_pinned
