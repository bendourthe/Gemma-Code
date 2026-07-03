"""Tests for the Hugging Face weights puller (v1.8.0 Phase 3, T304).

Mirrors the desktop provisioner suite: mocked httpx over real temp files
for download / resume / verify, fail-closed hash handling, and an
env-gated integration smoke that downloads the smallest real catalog
entry (operator-run on the GPU box).
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx as real_httpx
import pytest

from nexus_installer.engine.hf_weights_puller import (
    PLACEHOLDER_SHA256,
    HFWeightsPuller,
    ManifestError,
    load_weights_manifest,
    model_weights_dir,
    resolve_models_root,
    safe_dir_name,
)
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.hf_weights_puller"


def _entry(
    model_id: str = "sana-1.6b-int4",
    repo: str = "Efficient-Large-Model/SANA1.5_1.6B_1024px_int4",
    files: list[dict[str, str]] | None = None,
    size_gb: float = 1.4,
) -> dict[str, object]:
    """A minimal huggingface catalog entry with a weights manifest."""
    if files is None:
        files = [
            {
                "path": "transformer/diffusion_pytorch_model.safetensors",
                "sha256": PLACEHOLDER_SHA256,
            }
        ]
    return {
        "id": model_id,
        "sizeGB": size_gb,
        "source": {"protocol": "huggingface", "repo": repo, "url": ""},
        "weights": {"layoutVersion": 1, "files": files},
    }


def _mock_stream_response(
    chunks: list[bytes], status_code: int = 200, headers: dict | None = None
) -> MagicMock:
    """Build a context-manager mock for httpx.stream()."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {"content-length": str(sum(len(c) for c in chunks))}
    resp.iter_bytes.return_value = iter(chunks)
    resp.__enter__ = lambda s: resp
    resp.__exit__ = MagicMock(return_value=False)
    return resp


class TestSafeDirName:
    def test_safe_id_unchanged(self) -> None:
        assert safe_dir_name("sana-1.6b-int4") == "sana-1.6b-int4"

    def test_colon_and_slash_replaced(self) -> None:
        assert safe_dir_name("gemma4:e4b") == "gemma4-e4b"
        assert safe_dir_name("a/b") == "a-b"


class TestModelsRoot:
    def test_default_under_nexus_home(self) -> None:
        root = resolve_models_root(InstallerState())
        assert root == Path.home() / ".nexus" / "models"

    def test_state_override_wins(self, tmp_path: Path) -> None:
        state = InstallerState(models_root=str(tmp_path))
        assert resolve_models_root(state) == tmp_path

    def test_model_weights_dir_layout(self, tmp_path: Path) -> None:
        target = model_weights_dir(tmp_path, "gemma4:e4b")
        assert target == tmp_path / "weights" / "gemma4-e4b"


class TestLoadWeightsManifest:
    def test_parses_explicit_files(self) -> None:
        manifest = load_weights_manifest(_entry())
        assert manifest.model_id == "sana-1.6b-int4"
        assert manifest.repo == "Efficient-Large-Model/SANA1.5_1.6B_1024px_int4"
        assert manifest.size_gb == 1.4
        assert manifest.files[0].path == (
            "transformer/diffusion_pytorch_model.safetensors"
        )
        assert manifest.files[0].is_placeholder

    def test_derives_single_file_from_source_url(self) -> None:
        entry = _entry()
        del entry["weights"]
        entry["source"] = {  # type: ignore[assignment]
            "protocol": "huggingface",
            "repo": "stabilityai/sdxl-turbo",
            "url": (
                "https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/"
                "sd_xl_turbo_1.0_fp16.safetensors"
            ),
            "sha256": "a" * 64,
        }
        manifest = load_weights_manifest(entry)
        assert manifest.files[0].path == "sd_xl_turbo_1.0_fp16.safetensors"
        assert manifest.files[0].sha256 == "a" * 64

    def test_non_huggingface_protocol_rejected(self) -> None:
        entry = _entry()
        entry["source"] = {"protocol": "ollama", "url": "ollama://x"}  # type: ignore[assignment]
        with pytest.raises(ManifestError):
            load_weights_manifest(entry)

    def test_missing_repo_rejected(self) -> None:
        entry = _entry()
        entry["source"] = {"protocol": "huggingface"}  # type: ignore[assignment]
        with pytest.raises(ManifestError):
            load_weights_manifest(entry)

    def test_empty_files_rejected(self) -> None:
        with pytest.raises(ManifestError):
            load_weights_manifest(_entry(files=[]))

    @pytest.mark.parametrize(
        "bad_path",
        [
            "../escape.safetensors",
            "a/../../escape.safetensors",
            "/absolute.safetensors",
            "sub\\windows.safetensors",
            "C:evil.safetensors",
            "",
            " padded.safetensors",
        ],
    )
    def test_unsafe_paths_rejected(self, bad_path: str) -> None:
        files = [{"path": bad_path, "sha256": PLACEHOLDER_SHA256}]
        with pytest.raises(ManifestError):
            load_weights_manifest(_entry(files=files))

    def test_malformed_sha256_rejected(self) -> None:
        files = [{"path": "ok.safetensors", "sha256": "nothex"}]
        with pytest.raises(ManifestError):
            load_weights_manifest(_entry(files=files))

    def test_missing_size_defaults_to_zero(self) -> None:
        entry = _entry()
        del entry["sizeGB"]
        assert load_weights_manifest(entry).size_gb == 0.0


class TestDiskPrecheck:
    def _manifest(self, size_gb: float):
        return load_weights_manifest(_entry(size_gb=size_gb))

    def test_insufficient_space_fails(self, tmp_path: Path) -> None:
        log = MagicMock()
        usage = MagicMock()
        usage.free = 5 * 2**30  # 5 GB free vs 1.4 GB + 10 GB reserve
        with patch(f"{_MOD}.shutil.disk_usage", return_value=usage):
            ok = HFWeightsPuller()._disk_precheck(
                tmp_path, self._manifest(1.4), InstallerState(), log
            )
        assert ok is False
        assert any(
            "not enough disk space" in call.args[0].lower()
            for call in log.call_args_list
        )

    def test_ample_space_passes(self, tmp_path: Path) -> None:
        usage = MagicMock()
        usage.free = 100 * 2**30
        with patch(f"{_MOD}.shutil.disk_usage", return_value=usage):
            ok = HFWeightsPuller()._disk_precheck(
                tmp_path, self._manifest(1.4), InstallerState(), MagicMock()
            )
        assert ok is True

    def test_probe_failure_warns_and_continues(self, tmp_path: Path) -> None:
        log = MagicMock()
        with patch(f"{_MOD}.shutil.disk_usage", side_effect=OSError("no probe")):
            ok = HFWeightsPuller()._disk_precheck(
                tmp_path, self._manifest(1.4), InstallerState(), log
            )
        assert ok is True
        assert any("warn" in call.args[1] for call in log.call_args_list)


class TestInstallModel:
    def _install(
        self,
        tmp_path: Path,
        entry: dict[str, object],
        responses: list[object],
        puller: HFWeightsPuller | None = None,
    ) -> tuple[bool, MagicMock, list[float]]:
        state = InstallerState(models_root=str(tmp_path))
        log = MagicMock()
        fractions: list[float] = []
        puller = puller or HFWeightsPuller(sleep=lambda _s: None)
        with patch(f"{_MOD}.httpx") as mock_httpx:
            mock_httpx.HTTPError = real_httpx.HTTPError
            mock_httpx.stream.side_effect = responses
            ok = puller.install_model(entry, state, log, fractions.append)
        return ok, log, fractions

    def _logged(self, log: MagicMock, needle: str) -> bool:
        return any(
            needle in call.args[0].lower()
            for call in log.call_args_list
            if call.args
        )

    def test_invalid_manifest_fails(self, tmp_path: Path) -> None:
        entry = _entry()
        entry["source"] = {"protocol": "ollama"}  # type: ignore[assignment]
        ok, log, _ = self._install(tmp_path, entry, [])
        assert ok is False
        assert self._logged(log, "invalid weights manifest")

    def test_placeholder_pin_downloads_and_logs_digest(
        self, tmp_path: Path
    ) -> None:
        payload = b"weights-bytes"
        digest = hashlib.sha256(payload).hexdigest()
        ok, log, fractions = self._install(
            tmp_path, _entry(), [_mock_stream_response([payload])]
        )
        assert ok is True
        dest = (
            tmp_path
            / "weights"
            / "sana-1.6b-int4"
            / "transformer"
            / "diffusion_pytorch_model.safetensors"
        )
        assert dest.read_bytes() == payload
        assert self._logged(log, "placeholder pin")
        assert self._logged(log, digest)
        assert self._logged(log, "pin-hf-weights.py")
        assert fractions[-1] == 1.0

    def test_real_pin_match_verifies(self, tmp_path: Path) -> None:
        payload = b"pinned-weights"
        digest = hashlib.sha256(payload).hexdigest()
        entry = _entry(files=[{"path": "model.safetensors", "sha256": digest}])
        ok, log, _ = self._install(
            tmp_path, entry, [_mock_stream_response([payload])]
        )
        assert ok is True
        assert self._logged(log, "verified")

    def test_real_pin_mismatch_fails_closed_and_deletes(
        self, tmp_path: Path
    ) -> None:
        entry = _entry(files=[{"path": "model.safetensors", "sha256": "b" * 64}])
        ok, log, _ = self._install(
            tmp_path, entry, [_mock_stream_response([b"tampered"])]
        )
        assert ok is False
        assert self._logged(log, "checksum mismatch")
        dest = tmp_path / "weights" / "sana-1.6b-int4" / "model.safetensors"
        assert not dest.exists()

    def test_already_present_verified_skips_download(self, tmp_path: Path) -> None:
        payload = b"already-here"
        digest = hashlib.sha256(payload).hexdigest()
        dest = tmp_path / "weights" / "sana-1.6b-int4" / "model.safetensors"
        dest.parent.mkdir(parents=True)
        dest.write_bytes(payload)
        entry = _entry(files=[{"path": "model.safetensors", "sha256": digest}])

        state = InstallerState(models_root=str(tmp_path))
        log = MagicMock()
        with patch(f"{_MOD}.httpx") as mock_httpx:
            mock_httpx.HTTPError = real_httpx.HTTPError
            ok = HFWeightsPuller().install_model(entry, state, log)
            mock_httpx.stream.assert_not_called()
        assert ok is True
        assert self._logged(log, "already present")

    def test_present_but_mismatched_is_redownloaded(self, tmp_path: Path) -> None:
        payload = b"fresh-weights"
        digest = hashlib.sha256(payload).hexdigest()
        dest = tmp_path / "weights" / "sana-1.6b-int4" / "model.safetensors"
        dest.parent.mkdir(parents=True)
        dest.write_bytes(b"stale-bytes")
        entry = _entry(files=[{"path": "model.safetensors", "sha256": digest}])
        ok, log, _ = self._install(
            tmp_path, entry, [_mock_stream_response([payload])]
        )
        assert ok is True
        assert dest.read_bytes() == payload
        assert self._logged(log, "re-downloading")

    def test_multi_file_progress_is_monotonic_per_file(
        self, tmp_path: Path
    ) -> None:
        files = [
            {"path": "transformer/a.safetensors", "sha256": PLACEHOLDER_SHA256},
            {"path": "vae/b.safetensors", "sha256": PLACEHOLDER_SHA256},
        ]
        ok, _log, fractions = self._install(
            tmp_path,
            _entry(files=files),
            [_mock_stream_response([b"aa"]), _mock_stream_response([b"bb"])],
        )
        assert ok is True
        assert fractions == sorted(fractions)
        assert 0.5 in fractions
        assert fractions[-1] == 1.0

    def test_retry_after_network_error_succeeds(self, tmp_path: Path) -> None:
        payload = b"retried-weights"
        sleeps: list[float] = []
        puller = HFWeightsPuller(sleep=sleeps.append)
        ok, log, _ = self._install(
            tmp_path,
            _entry(),
            [
                real_httpx.ConnectError("flaky network"),
                _mock_stream_response([payload]),
            ],
            puller=puller,
        )
        assert ok is True
        assert sleeps  # backed off between attempts
        assert self._logged(log, "retrying")

    def test_retries_exhausted_fails(self, tmp_path: Path) -> None:
        errors = [real_httpx.ConnectError("down")] * 3
        ok, log, _ = self._install(
            tmp_path, _entry(), errors, puller=HFWeightsPuller(sleep=lambda _s: None)
        )
        assert ok is False
        assert self._logged(log, "failed to download")

    def test_cancelled_puller_aborts(self, tmp_path: Path) -> None:
        puller = HFWeightsPuller()
        puller.cancel()
        ok, log, _ = self._install(tmp_path, _entry(), [], puller=puller)
        assert ok is False
        assert self._logged(log, "cancelled")


class TestDownloadResume:
    def _download(
        self,
        tmp_path: Path,
        response: MagicMock,
        partial_content: bytes | None = None,
        puller: HFWeightsPuller | None = None,
    ) -> tuple[bool, Path]:
        dest = tmp_path / "weights.bin"
        if partial_content is not None:
            (tmp_path / "weights.bin.partial").write_bytes(partial_content)
        puller = puller or HFWeightsPuller()
        with patch(f"{_MOD}.httpx") as mock_httpx:
            mock_httpx.stream.return_value = response
            mock_httpx.HTTPError = real_httpx.HTTPError
            ok = puller._download_with_resume(
                "https://huggingface.co/x/resolve/main/weights.bin",
                dest,
                MagicMock(),
                lambda _p: None,
            )
        return ok, dest

    def test_full_download_promotes_partial(self, tmp_path: Path) -> None:
        ok, dest = self._download(tmp_path, _mock_stream_response([b"abc", b"def"]))
        assert ok is True
        assert dest.read_bytes() == b"abcdef"
        assert not (tmp_path / "weights.bin.partial").exists()

    def test_resume_appends_to_partial(self, tmp_path: Path) -> None:
        resp = _mock_stream_response(
            [b"def"], status_code=206, headers={"content-length": "3"}
        )
        ok, dest = self._download(tmp_path, resp, partial_content=b"abc")
        assert ok is True
        assert dest.read_bytes() == b"abcdef"

    def test_range_ignored_restarts_from_scratch(self, tmp_path: Path) -> None:
        resp = _mock_stream_response([b"fresh"], status_code=200)
        ok, dest = self._download(tmp_path, resp, partial_content=b"stale")
        assert ok is True
        assert dest.read_bytes() == b"fresh"

    def test_416_promotes_complete_partial(self, tmp_path: Path) -> None:
        resp = _mock_stream_response([], status_code=416)
        ok, dest = self._download(tmp_path, resp, partial_content=b"complete")
        assert ok is True
        assert dest.read_bytes() == b"complete"

    def test_cancel_mid_download_keeps_partial(self, tmp_path: Path) -> None:
        puller = HFWeightsPuller()
        puller.cancel()
        ok, dest = self._download(
            tmp_path, _mock_stream_response([b"chunk"]), puller=puller
        )
        assert ok is False
        assert not dest.exists()
        assert (tmp_path / "weights.bin.partial").exists()

    def test_network_error_returns_false(self, tmp_path: Path) -> None:
        with patch(f"{_MOD}.httpx") as mock_httpx:
            mock_httpx.stream.side_effect = real_httpx.ConnectError("offline")
            mock_httpx.HTTPError = real_httpx.HTTPError
            ok = HFWeightsPuller()._download_with_resume(
                "https://huggingface.co/x/resolve/main/w.bin",
                tmp_path / "w.bin",
                MagicMock(),
                lambda _p: None,
            )
        assert ok is False


_SMOKE_MODEL = os.environ.get("NEXUS_HF_SMOKE_MODEL", "sana-1.6b-int4")


@pytest.mark.skipif(
    os.environ.get("NEXUS_HF_WEIGHTS_SMOKE") != "1",
    reason=(
        "real multi-GB Hugging Face download (T304 GPU-box smoke); "
        "opt in with NEXUS_HF_WEIGHTS_SMOKE=1"
    ),
)
class TestHfWeightsSmokeIntegration:
    def test_downloads_smallest_real_entry(self, tmp_path: Path) -> None:
        from nexus_installer.engine.model_router import (
            default_catalog_path,
            load_catalog_index,
        )

        catalog = load_catalog_index(default_catalog_path())
        assert _SMOKE_MODEL in catalog, f"{_SMOKE_MODEL} missing from catalog"
        entry = catalog[_SMOKE_MODEL]

        state = InstallerState(models_root=str(tmp_path))
        logs: list[tuple[str, str]] = []
        ok = HFWeightsPuller().install_model(
            entry, state, lambda msg, lvl: logs.append((lvl, msg))
        )
        assert ok is True, logs

        manifest = load_weights_manifest(entry)
        model_dir = model_weights_dir(tmp_path, _SMOKE_MODEL)
        for weights_file in manifest.files:
            dest = model_dir.joinpath(*weights_file.path.split("/"))
            assert dest.is_file()
            assert dest.stat().st_size > 0
