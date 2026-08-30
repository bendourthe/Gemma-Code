"""Static release guards for the v2.4.1 installed media runtime."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_repair_lock_matches_installer_diffusion_lock() -> None:
    repair_lock = _json(REPO_ROOT / "runtimes" / "diffusion" / "runtime-lock.json")
    installer_lock = _json(
        REPO_ROOT / "scripts" / "installer" / "build" / "versions.lock.json"
    )["diffusion"]
    assert repair_lock["provisionerVersion"] == installer_lock["provisionerVersion"]
    assert repair_lock["runtimeIndexUrl"] == installer_lock["runtimeIndexUrl"]
    assert repair_lock["runtimeRequirements"] == installer_lock["runtimeRequirements"]
    for target, repair_target in repair_lock["targets"].items():
        installer_target = installer_lock["targets"][target]
        assert repair_target["backend"] == installer_target["backend"]
        assert repair_target["torchIndexUrl"] == installer_target["torchIndexUrl"]
        assert (
            repair_target["torchRequirements"] == installer_target["torchRequirements"]
        )
        expected = {
            (item["pythonAbi"], item["filename"], item["size"], item["sha256"])
            for item in installer_target["referenceArtifacts"]
        }
        actual = {
            (item["pythonAbi"], item["filename"], item["size"], item["sha256"])
            for item in repair_target["referenceArtifacts"]
        }
        assert actual == expected


def test_wan_uses_complete_pinned_diffusers_pipeline() -> None:
    catalog = _json(REPO_ROOT / "core" / "registry" / "catalog.json")
    wan = next(model for model in catalog["models"] if model["id"] == "wan2.1-t2v-1.3b")
    assert wan["source"]["repo"] == "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
    assert len(wan["source"]["revision"]) == 40
    files = {item["path"]: item["sha256"] for item in wan["weights"]["files"]}
    required = {
        "model_index.json",
        "scheduler/scheduler_config.json",
        "text_encoder/config.json",
        "text_encoder/model.safetensors.index.json",
        "tokenizer/tokenizer.json",
        "transformer/config.json",
        "transformer/diffusion_pytorch_model.safetensors.index.json",
        "vae/config.json",
        "vae/diffusion_pytorch_model.safetensors",
    }
    assert required.issubset(files)
    assert all(len(digest) == 64 for digest in files.values())


def test_default_images_use_complete_pinned_fp16_pipelines() -> None:
    catalog = _json(REPO_ROOT / "core" / "registry" / "catalog.json")
    by_id = {model["id"]: model for model in catalog["models"]}
    for model_id in ("realvisxl-v5", "juggernaut-xl-v9"):
        model = by_id[model_id]
        assert len(model["source"]["revision"]) == 40
        assert model["weights"]["layoutVersion"] == 2
        files = {item["path"]: item["sha256"] for item in model["weights"]["files"]}
        assert {
            "model_index.json",
            "text_encoder/model.fp16.safetensors",
            "text_encoder_2/model.fp16.safetensors",
            "unet/diffusion_pytorch_model.fp16.safetensors",
            "vae/diffusion_pytorch_model.fp16.safetensors",
        }.issubset(files)
        assert all(len(digest) == 64 for digest in files.values())


def test_frozen_installer_bundles_repair_entrypoints() -> None:
    spec = (
        REPO_ROOT / "scripts" / "installer" / "build" / "nexus-installer.spec"
    ).read_text(encoding="utf-8")
    assert 'datas.append((str(_runtimes_src), "runtimes"))' in spec
    assert (REPO_ROOT / "runtimes" / "diffusion" / "repair.py").is_file()
    assert (REPO_ROOT / "runtimes" / "diffusion" / "runtime-lock.json").is_file()


def test_installed_media_harness_uses_sidecar_and_strict_probes() -> None:
    harness = (
        REPO_ROOT / "scripts" / "installer" / "build" / "smoke-installed-media.ps1"
    ).read_text(encoding="utf-8")
    for contract in (
        "sidecar\\dist\\main.js",
        "diffusion.runtime.status",
        "diffusion.txt2img",
        "diffusion.video.text2video",
        "diffusion.job.drainEvents",
        "NEXUS_DIFFUSION_ALLOW_STUB = '0'",
        "sampledVariance",
        "nb_read_frames",
        "Get-FileHash",
        "nexus-installed-media-smoke/v1",
        "Kill($true)",
    ):
        assert contract in harness
