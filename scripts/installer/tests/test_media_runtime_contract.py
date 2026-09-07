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


def test_sana_video_uses_complete_pinned_diffusers_pipeline() -> None:
    catalog = _json(REPO_ROOT / "core" / "registry" / "catalog.json")
    sana = next(
        model for model in catalog["models"] if model["id"] == "sana-video-2b-720p"
    )
    assert (
        sana["source"]["repo"]
        == "Efficient-Large-Model/SANA-Video_2B_720p_diffusers"
    )
    assert sana["weights"]["layoutVersion"] == 2
    files = {item["path"]: item["sha256"] for item in sana["weights"]["files"]}
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
    assert all(digest != "0" * 64 for digest in files.values())
    wan = next(model for model in catalog["models"] if model["id"] == "wan2.1-t2v-1.3b")
    assert sana["source"]["repo"] != wan["source"]["repo"]


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
        "NEXUS_VIDEO_OUTPUT_DIR",
        "sampledVariance",
        "nb_read_frames",
        "Get-FileHash",
        "nexus-installed-media-smoke/v1",
        "Kill($true)",
    ):
        assert contract in harness
    assert "mode = 'text2video'" not in harness


# --- v2.4.4 Phase 4 (T016): the Diffusers pin must export the SANA classes ---
#
# Field screenshot 4 was an instant `ImportError: cannot import name
# 'SanaVideoPipeline' from 'diffusers'` in the packaged venv. The catalog
# layout and the executor were both correct; the pin was not. `diffusers`
# 0.34.0 and 0.35.x ship `SanaPipeline` but no SANA video pipeline at all --
# 0.36.0 is the first release that carries both.

#: First Diffusers release whose distribution contains `diffusers/pipelines/
#: sana_video/pipeline_sana_video.py` and exports both SANA classes. Verified
#: against the published wheels on 2026-08-31.
MIN_SANA_VIDEO_DIFFUSERS = (0, 36, 0)


def _pinned_version(requirements: list[str], package: str) -> tuple[int, ...]:
    for entry in requirements:
        name, _, version = entry.partition("==")
        if name.strip().lower() == package:
            return tuple(int(part) for part in version.strip().split("."))
    raise AssertionError(f"{package} is not pinned in {requirements}")


def test_diffusers_pin_exports_both_sana_pipelines() -> None:
    repair_lock = _json(REPO_ROOT / "runtimes" / "diffusion" / "runtime-lock.json")
    installer_lock = _json(
        REPO_ROOT / "scripts" / "installer" / "build" / "versions.lock.json"
    )["diffusion"]
    for requirements in (
        repair_lock["runtimeRequirements"],
        installer_lock["runtimeRequirements"],
    ):
        assert _pinned_version(requirements, "diffusers") >= MIN_SANA_VIDEO_DIFFUSERS


def test_diffusers_stays_pinned_never_floating() -> None:
    # An unpinned or range-pinned diffusers would let a future resolver pick a
    # release that drops the class again, reproducing the field error silently.
    for path, key in (
        (REPO_ROOT / "runtimes" / "diffusion" / "runtime-lock.json", None),
        (
            REPO_ROOT / "scripts" / "installer" / "build" / "versions.lock.json",
            "diffusion",
        ),
    ):
        lock = _json(path)
        if key:
            lock = lock[key]
        entries = [
            entry
            for entry in lock["runtimeRequirements"]
            if entry.lower().startswith("diffusers")
        ]
        assert len(entries) == 1
        assert entries[0].startswith("diffusers==")


def test_torch_pin_meets_the_sana_video_minimum() -> None:
    # v2.4.8 Phase 8: diffusers 0.36's SANA-Video pipeline imports
    # torch.nn.RMSNorm (torch 2.4+). The 2.3.0 pin passed every smoke and
    # failed the first video generate on the operator host. Both lock files
    # now pin the 2.5.1 cu121 stack with verified wheels for every CUDA target.
    repair_lock = _json(REPO_ROOT / "runtimes" / "diffusion" / "runtime-lock.json")
    build_lock = _json(
        REPO_ROOT / "scripts" / "installer" / "build" / "versions.lock.json"
    )["diffusion"]
    assert _pinned_version(repair_lock["runtimeRequirements"], "transformers") == (
        4,
        53,
        2,
    )
    for lock in (repair_lock, build_lock):
        for key, target in lock["targets"].items():
            assert "torch==2.5.1" in target["torchRequirements"], key
            assert "torchvision==0.20.1" in target["torchRequirements"], key
            assert "torchaudio==2.5.1" in target["torchRequirements"], key
            if target["backend"] == "cuda":
                names = sorted(a["filename"] for a in target["referenceArtifacts"])
                assert len(names) == 6, key
                assert all("2.5.1+cu121" in n or "0.20.1+cu121" in n for n in names), (
                    key
                )
                assert all(
                    a["size"] > 0 and len(a["sha256"]) == 64
                    for a in target["referenceArtifacts"]
                )
    assert repair_lock["targets"] == build_lock["targets"]
