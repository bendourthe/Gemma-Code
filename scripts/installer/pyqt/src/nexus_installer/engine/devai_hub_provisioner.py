"""Frozen DevAI-Hub baseline provisioner (Phase 9.6).

At install time, the wizard extracts the bundled tarball (`payload/devai-
hub-baseline.tar.gz`) into `~/.nexus/skills/devai-hub/<tag>/` and tells the
local SkillCatalog about it. The pinned tag + sha + content hash are read
from `scripts/installer/devai-hub-baseline.json`.

The baseline lives under a per-tag directory so future `nexus skills sync`
updates land side-by-side and the user can roll back by selecting an older
tag without re-installing the app.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tarfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

LogFn = Callable[[str, str], None]


@dataclass(frozen=True)
class DevAIBaselineManifest:
    tag: str
    sha: str
    content_hash: str
    target_dir: Path
    namespace: str
    register_with_catalog: bool

    @classmethod
    def from_json(cls, path: Path) -> "DevAIBaselineManifest":
        data = json.loads(path.read_text(encoding="utf-8"))
        install = data["install"]
        return cls(
            tag=data["source"]["tag"],
            sha=data["source"]["sha"],
            content_hash=data["artifact"]["contentHash"],
            target_dir=Path(install["targetDir"]).expanduser(),
            namespace=install["namespace"],
            register_with_catalog=bool(install["registerWithSkillCatalog"]),
        )


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            hasher.update(chunk)
    return "sha256:" + hasher.hexdigest()


class DevAIHubProvisioner:
    """Extract the bundled DevAI-Hub tarball into `~/.nexus/skills/devai-hub/`."""

    def __init__(self, payload_dir: Path, manifest_path: Path) -> None:
        self._tarball = payload_dir / "devai-hub-baseline.tar.gz"
        self._manifest = DevAIBaselineManifest.from_json(manifest_path)

    @property
    def manifest(self) -> DevAIBaselineManifest:
        return self._manifest

    @property
    def tarball(self) -> Path:
        return self._tarball

    def payload_exists(self) -> bool:
        return self._tarball.exists() and self._tarball.is_file()

    def verify(self, log: LogFn) -> bool:
        if not self.payload_exists():
            log(f"DevAI-Hub tarball missing at {self._tarball}", "warn")
            return False
        if (
            self._manifest.content_hash
            and not self._manifest.content_hash.endswith("0" * 64)
        ):
            actual = sha256_file(self._tarball)
            if actual != self._manifest.content_hash:
                log(
                    f"DevAI-Hub baseline hash mismatch: "
                    f"expected {self._manifest.content_hash}, got {actual}",
                    "error",
                )
                return False
        return True

    def extract(self, log: LogFn) -> bool:
        if not self.verify(log):
            return False
        target = self._manifest.target_dir
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                log(f"DevAI-Hub baseline target {target} exists; replacing", "info")
                shutil.rmtree(target)
            target.mkdir(parents=True)
            with tarfile.open(self._tarball, "r:gz") as tf:
                _safe_extract(tf, target, log)
        except (OSError, tarfile.TarError, ValueError) as exc:
            log(f"DevAI-Hub extract failed: {exc}", "error")
            return False
        log(
            f"DevAI-Hub baseline {self._manifest.tag} extracted to {target}",
            "success",
        )
        return True

    def install(self, log: LogFn) -> bool:
        return self.extract(log)


def _safe_extract(tf: tarfile.TarFile, target: Path, log: LogFn) -> None:
    """tarfile.extractall hardened against path traversal (CVE-2007-4559)."""
    base = target.resolve()
    for member in tf.getmembers():
        member_path = (target / member.name).resolve()
        try:
            member_path.relative_to(base)
        except ValueError:
            log(f"Refused tarball entry escaping target: {member.name}", "error")
            raise
    # `filter="data"` is the Python 3.12+ recommended safe filter; it also
    # silences the 3.14 deprecation warning that tarfile.extractall emits
    # without an explicit filter.
    tf.extractall(target, filter="data")  # noqa: S202 -- path-traversal guard above
