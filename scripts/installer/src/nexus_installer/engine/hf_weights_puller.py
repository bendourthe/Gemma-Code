"""v1.8.0 Phase 3 -- Hugging Face weights puller (closes plan gap G2).

Downloads the per-model `weights` manifest of a `core/registry/catalog.json`
entry whose `source.protocol` is "huggingface": every listed file is fetched
from `https://huggingface.co/{repo}/resolve/main/{path}` with resumable
download + retry, verified against its pinned SHA-256, and written to
`<models_root>/weights/<model-id>/{path}`.

That per-model directory is the diffusion runtime's model-path contract
(documented in catalog.json `_meta`): the runtime loads the directory via
diffusers `from_pretrained`, so repo-relative subpaths (`transformer/`,
`vae/`, ...) are preserved on disk. `models_root` defaults to
`~/.nexus/models` and is overridable via `InstallerState.models_root`.

Digest pins follow the `fetch-payload.py` placeholder discipline: an
all-zero sha256 logs a warning, skips verification, and logs the computed
digest so the operator can rotate the pin
(`scripts/installer/build/pin-hf-weights.py`). A real pin that mismatches
fails closed: the file is deleted and the model is reported failed.

v1.13.0 Phase 1 (installer reliability):

* **Gated repos handled, not blindly retried.** A repo the catalog marks
  `"gated": true` is skipped fast with its `gatedReason` when no Hugging Face
  token is configured (it can never succeed unauthenticated). This is the
  class behind the real 401 failure of `sana-1.6b-int4`.
* **Optional Hugging Face token.** A token read from the environment
  (`HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN`) is sent as an `Authorization: Bearer`
  header; never required for public models, never logged.
* **Permanent vs transient errors.** A 401/403/404 is permanent for the
  current credentials, so the puller stops immediately with a clear message
  instead of burning its 3-attempt retry budget on an un-authable request;
  5xx / network / timeout errors stay retryable with resume + backoff.

v1.19.2 Phase 1: a catalog entry may declare official `weights.variants`
(fp16/int8/fp8/GGUF), each with its own file list and per-file sha256.
Selection is hardware-aware with an explicit override
(`InstallerState.weights_variant` / `NEXUS_WEIGHTS_VARIANT`). Unofficial
community re-quantizations are rejected at parse time.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from pathlib import Path, PurePosixPath

import httpx

from nexus_installer.engine.hf_auth import (
    HF_TOKEN_ENV_VARS,
    discover_hf_token,
    hf_token_from_env,
)
from nexus_installer.installer_state import InstallerState

__all__ = [
    "HF_TOKEN_ENV_VARS",
    "MODEL_ID_MARKER",
    "WEIGHTS_VARIANT_ENV",
    "discover_hf_token",
    "hf_token_from_env",
    "load_weights_manifest",
    "select_weights_variant",
    "write_model_id_marker",
]

# Bind httpx's exception classes at import time so the `except` clauses below
# stay valid even when a test patches the module reference `httpx` with a mock:
# the download path calls the (patchable) `httpx.stream`, but error handling
# must still match against the real exception types.
_HTTPError = httpx.HTTPError
_HTTPStatusError = httpx.HTTPStatusError

LogFn = Callable[[str, str], None]
ProgressFn = Callable[[float], None]

HF_RESOLVE_URL = "https://huggingface.co/{repo}/resolve/{revision}/{path}"
HF_URL_MARKER = "/resolve/main/"
# v1.16.0 Phase 3 (adoption item A5): a catalog entry may pin `source.revision`
# to a commit sha. Entries without one keep resolving the floating `main`, which
# is what every pre-v1.16 entry does.
HF_DEFAULT_REVISION = "main"
_REVISION_RE = re.compile(r"^[a-f0-9]{40}$")
PLACEHOLDER_SHA256 = "0" * 64
DOWNLOAD_CHUNK_SIZE = 65536
MAX_DOWNLOAD_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2.0
PIN_SCRIPT = "scripts/installer/build/pin-hf-weights.py"

# HTTP statuses that can never succeed on retry for the current credentials, so
# the puller stops immediately instead of consuming its retry budget.
PERMANENT_HTTP_STATUSES = frozenset({401, 403, 404})

_SAFE_DIR_CHAR_RE = re.compile(r"[^A-Za-z0-9._-]")


class _DownloadOutcome(Enum):
    """Result of one download attempt; the caller retries only on TRANSIENT."""

    OK = "ok"
    TRANSIENT = "transient"
    PERMANENT = "permanent"


class ManifestError(ValueError):
    """A catalog entry's weights manifest is missing or malformed."""


@dataclass(frozen=True)
class WeightsFile:
    """One file of a per-model weights manifest."""

    path: str
    sha256: str

    @property
    def is_placeholder(self) -> bool:
        return self.sha256 == PLACEHOLDER_SHA256


# v1.19.2 -- official precision lines only. Community re-quantizations are
# rejected at parse time (LongCat comparison N2).
OFFICIAL_PRECISIONS = frozenset({"fp16", "bf16", "fp8", "int8", "gguf"})
# Higher quality first. Used when hardware-aware selection picks among fitting
# official variants.
PRECISION_QUALITY_RANK = {
    "fp16": 0,
    "bf16": 1,
    "fp8": 2,
    "int8": 3,
    "gguf": 4,
}
WEIGHTS_VARIANT_ENV = "NEXUS_WEIGHTS_VARIANT"


@dataclass(frozen=True)
class WeightsVariant:
    """One official precision-variant file set."""

    id: str
    precision: str
    official: bool
    files: tuple[WeightsFile, ...]
    size_gb: float
    vram_gb: float | None
    quant: str | None = None


@dataclass(frozen=True)
class WeightsManifest:
    """Parsed weights manifest of one huggingface catalog entry."""

    model_id: str
    repo: str
    files: tuple[WeightsFile, ...]
    size_gb: float
    # v1.16.0 Phase 3 (A5): pinned commit sha, or "main" when the entry does not
    # pin one. Pinning is the real integrity control for entries whose
    # `sha256` values are still placeholders, and it is mandatory for a model
    # that ships executable code (trust_remote_code).
    revision: str = HF_DEFAULT_REVISION
    variant_id: str | None = None

    @property
    def is_pinned(self) -> bool:
        return self.revision != HF_DEFAULT_REVISION


def safe_dir_name(model_id: str) -> str:
    """Map a catalog model id onto a filesystem-safe directory name.

    Mirrored by `scripts/installer/build/pin-hf-weights.py` (--from-dir);
    keep the two in sync.
    """
    return _SAFE_DIR_CHAR_RE.sub("-", model_id)


# v2.2.0 Phase 2 (2.1): marker file naming the true catalog id, read by the
# app's installed-probe (`core/registry/installedProbe.ts`). Keep the name in
# sync with `MODEL_ID_MARKER` in `desktop/sidecar/src/models/modelsService.ts`.
MODEL_ID_MARKER = ".nexus-model-id"


def write_model_id_marker(model_dir: Path, model_id: str, log: LogFn) -> bool:
    """Write `.nexus-model-id` inside a verified weights dir. Best-effort."""
    try:
        (model_dir / MODEL_ID_MARKER).write_text(f"{model_id}\n", encoding="utf-8")
        return True
    except OSError as exc:
        # Non-fatal: the probe falls back to sanitized directory-name matching.
        log(f"Could not write the model-id marker for {model_id}: {exc}", "warn")
        return False


def default_models_root() -> Path:
    """The runtime's model store root (see catalog.json `_meta`)."""
    return Path.home() / ".nexus" / "models"


def resolve_models_root(state: InstallerState) -> Path:
    """Return the models root from state, falling back to the default."""
    if state.models_root:
        return Path(state.models_root).expanduser()
    return default_models_root()


def model_weights_dir(models_root: Path, model_id: str) -> Path:
    """Destination directory for one model's weights."""
    return models_root / "weights" / safe_dir_name(model_id)


def _validate_file_path(path: str) -> str:
    """Reject manifest file paths that could escape the model directory."""
    if not path or path != path.strip():
        raise ManifestError(f"empty or padded weights file path: {path!r}")
    if "\\" in path or ":" in path:
        raise ManifestError(f"unsafe weights file path: {path!r}")
    parts = PurePosixPath(path).parts
    if not parts or path.startswith("/") or ".." in parts or "." in parts:
        raise ManifestError(f"unsafe weights file path: {path!r}")
    return path


def _validate_sha256(digest: object, path: str) -> str:
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ManifestError(f"malformed sha256 for weights file {path!r}")
    return digest


def _parse_weights_files(
    model_id: str, raw_files: list[object]
) -> tuple[WeightsFile, ...]:
    files: list[WeightsFile] = []
    for raw in raw_files:
        if not isinstance(raw, dict):
            raise ManifestError(f"{model_id}: malformed weights file entry")
        path = raw.get("path")
        if not isinstance(path, str):
            raise ManifestError(f"{model_id}: weights file entry has no path")
        files.append(
            WeightsFile(
                path=_validate_file_path(path),
                sha256=_validate_sha256(raw.get("sha256"), path),
            )
        )
    if not files:
        raise ManifestError(f"{model_id}: weights file list is empty")
    return tuple(files)


def _parse_weights_variants(
    model_id: str, raw_variants: object
) -> tuple[WeightsVariant, ...]:
    if not isinstance(raw_variants, list) or not raw_variants:
        raise ManifestError(f"{model_id}: weights.variants must be a non-empty list")
    variants: list[WeightsVariant] = []
    seen: set[str] = set()
    for raw in raw_variants:
        if not isinstance(raw, dict):
            raise ManifestError(f"{model_id}: malformed weights variant entry")
        variant_id = raw.get("id")
        if not isinstance(variant_id, str) or not variant_id.strip():
            raise ManifestError(f"{model_id}: weights variant is missing id")
        if variant_id in seen:
            raise ManifestError(
                f"{model_id}: duplicate weights variant id {variant_id}"
            )
        seen.add(variant_id)
        if raw.get("official") is not True:
            raise ManifestError(
                f"{model_id}: variant {variant_id} is not official; unvetted "
                "community quantizations are not eligible"
            )
        precision = raw.get("precision")
        if not isinstance(precision, str) or precision not in OFFICIAL_PRECISIONS:
            raise ManifestError(
                f"{model_id}: variant {variant_id} has invalid precision {precision!r}"
            )
        files_value = raw.get("files")
        if not isinstance(files_value, list):
            raise ManifestError(f"{model_id}: variant {variant_id} has no files")
        size_value = raw.get("sizeGB")
        size_gb = float(size_value) if isinstance(size_value, (int, float)) else 0.0
        vram_value = raw.get("vramGB")
        vram_gb = float(vram_value) if isinstance(vram_value, (int, float)) else None
        quant_value = raw.get("quant")
        quant = quant_value if isinstance(quant_value, str) and quant_value else None
        variants.append(
            WeightsVariant(
                id=variant_id,
                precision=precision,
                official=True,
                files=_parse_weights_files(model_id, list(files_value)),
                size_gb=size_gb,
                vram_gb=vram_gb,
                quant=quant,
            )
        )
    return tuple(variants)


def select_weights_variant(
    variants: tuple[WeightsVariant, ...],
    *,
    override: str | None = None,
    default_id: str | None = None,
    vram_gb: float | None = None,
) -> WeightsVariant:
    """Pick one official precision variant.

    Explicit override (installer state / NEXUS_WEIGHTS_VARIANT) wins. Otherwise
    a catalog defaultVariant that still fits the host VRAM is used. Otherwise
    the highest-quality official variant that fits detected VRAM (or the
    smallest if none declare a VRAM need).
    """
    if not variants:
        raise ManifestError("no official weights variants to select")
    if override:
        for variant in variants:
            if variant.id == override or variant.precision == override:
                return variant
            if variant.quant and variant.quant.lower() == override.lower():
                return variant
        known = ", ".join(v.id for v in variants)
        raise ManifestError(
            f"weights variant {override!r} is not an official declared variant "
            f"(known: {known})"
        )
    if default_id:
        for variant in variants:
            if variant.id != default_id:
                continue
            if vram_gb is None or variant.vram_gb is None or variant.vram_gb <= vram_gb:
                return variant
            break
    fitting = [
        v
        for v in variants
        if vram_gb is None or v.vram_gb is None or v.vram_gb <= vram_gb
    ]
    pool = fitting if fitting else list(variants)
    return min(
        pool,
        key=lambda v: (
            PRECISION_QUALITY_RANK.get(v.precision, 99),
            v.size_gb if v.size_gb > 0 else 1e12,
        ),
    )


def resolve_weights_variant_override(state: InstallerState) -> str | None:
    """Explicit user override from installer state, then the env var."""
    if state.weights_variant.strip():
        return state.weights_variant.strip()
    env = os.environ.get(WEIGHTS_VARIANT_ENV, "").strip()
    return env or None


def resolve_host_vram_gb(state: InstallerState) -> float | None:
    """Detected GPU VRAM in GB, or None when unknown / CPU-only."""
    if state.vram_mb <= 0:
        return None
    return state.vram_mb / 1024.0


def load_weights_manifest(
    entry: dict[str, object],
    *,
    variant_override: str | None = None,
    vram_gb: float | None = None,
) -> WeightsManifest:
    """Parse a catalog entry into a `WeightsManifest`.

    Entries without an explicit `weights` block fall back to a single-file
    manifest derived from `source.url` (older catalog snapshots), keeping
    the puller usable across catalog drift.

    When `weights.variants` is present, the puller selects one official
    precision line (explicit override, then hardware-aware default) and
    downloads that file set only.
    """
    model_id = entry.get("id")
    if not isinstance(model_id, str) or not model_id:
        raise ManifestError("catalog entry has no id")
    source = entry.get("source")
    if not isinstance(source, dict):
        raise ManifestError(f"{model_id}: catalog entry has no source")
    if source.get("protocol") != "huggingface":
        raise ManifestError(f"{model_id}: source.protocol is not huggingface")
    repo = source.get("repo")
    if not isinstance(repo, str) or not repo:
        raise ManifestError(f"{model_id}: huggingface source has no repo")

    size_gb = entry.get("sizeGB")
    size = float(size_gb) if isinstance(size_gb, (int, float)) else 0.0
    variant_id: str | None = None
    files: tuple[WeightsFile, ...]

    weights = entry.get("weights")
    if (
        isinstance(weights, dict)
        and isinstance(weights.get("variants"), list)
        and weights.get("variants")
    ):
        variants = _parse_weights_variants(model_id, weights.get("variants"))
        default_id = weights.get("defaultVariant")
        default = default_id if isinstance(default_id, str) else None
        selected = select_weights_variant(
            variants,
            override=variant_override,
            default_id=default,
            vram_gb=vram_gb,
        )
        files = selected.files
        variant_id = selected.id
        if selected.size_gb > 0:
            size = selected.size_gb
    elif isinstance(weights, dict):
        files_value = weights.get("files")
        if not isinstance(files_value, list) or not files_value:
            raise ManifestError(f"{model_id}: weights manifest has no files")
        files = _parse_weights_files(model_id, list(files_value))
    else:
        url = source.get("url")
        if not isinstance(url, str) or HF_URL_MARKER not in url:
            raise ManifestError(
                f"{model_id}: no weights manifest and no derivable source.url"
            )
        files = _parse_weights_files(
            model_id,
            [
                {
                    "path": url.split(HF_URL_MARKER, 1)[1],
                    "sha256": source.get("sha256", PLACEHOLDER_SHA256),
                }
            ],
        )

    # v1.16.0 Phase 3 (A5): honour a pinned commit sha. A malformed value is a
    # hard error rather than a silent fall back to `main` -- silently unpinning
    # is precisely the failure this field exists to prevent.
    revision_value = source.get("revision")
    if revision_value is None:
        revision = HF_DEFAULT_REVISION
    elif isinstance(revision_value, str) and _REVISION_RE.fullmatch(revision_value):
        revision = revision_value
    else:
        raise ManifestError(
            f"{model_id}: source.revision must be a 40-hex commit sha, "
            f"got {revision_value!r}"
        )
    if entry.get("trustRemoteCode") is True and revision == HF_DEFAULT_REVISION:
        raise ManifestError(
            f"{model_id}: trustRemoteCode requires a pinned source.revision"
        )

    return WeightsManifest(
        model_id=model_id,
        repo=repo,
        files=files,
        size_gb=size,
        revision=revision,
        variant_id=variant_id,
    )


def _sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(DOWNLOAD_CHUNK_SIZE), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class HFWeightsPuller:
    """Downloads and verifies one huggingface catalog entry's weights."""

    def __init__(self, sleep: Callable[[float], None] = time.sleep) -> None:
        self._cancelled = False
        self._sleep = sleep

    def cancel(self) -> None:
        """Request cancellation; in-flight partial files are kept for resume."""
        self._cancelled = True

    def install_model(
        self,
        entry: dict[str, object],
        state: InstallerState,
        log: LogFn,
        progress: ProgressFn | None = None,
    ) -> bool:
        """Download + verify every manifest file. Returns True on success."""
        progress = progress or (lambda _pct: None)

        try:
            manifest = load_weights_manifest(
                entry,
                variant_override=resolve_weights_variant_override(state),
                vram_gb=resolve_host_vram_gb(state),
            )
        except ManifestError as exc:
            log(f"Invalid weights manifest: {exc}", "error")
            return False

        # A gated repo can never be fetched by an unauthenticated client; fail
        # fast with the catalog's reason instead of three 401 retries. The token
        # is resolved from state (guided step) / env / HF CLI cache.
        token = discover_hf_token(state)
        if entry.get("gated") and not token:
            reason = entry.get("gatedReason")
            hint = (
                str(reason)
                if isinstance(reason, str) and reason
                else "Set the HF_TOKEN environment variable to enable it."
            )
            log(
                f"{manifest.model_id} is a gated Hugging Face model and no "
                f"Hugging Face token is configured; skipping. {hint}",
                "error",
            )
            return False

        models_root = resolve_models_root(state)
        model_dir = model_weights_dir(models_root, manifest.model_id)
        try:
            model_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            log(f"Cannot create {model_dir}: {exc}", "error")
            return False

        if not self._disk_precheck(models_root, manifest, state, log):
            return False

        total = len(manifest.files)
        variant_note = f", variant {manifest.variant_id}" if manifest.variant_id else ""
        log(
            f"Downloading {manifest.model_id} ({total} file(s), "
            f"~{manifest.size_gb:.1f} GB{variant_note}) "
            f"from huggingface.co/{manifest.repo}...",
            "info",
        )
        for index, weights_file in enumerate(manifest.files):
            if self._cancelled:
                log("Model download cancelled by user.", "warn")
                return False

            def file_progress(
                fraction: float, _index: int = index, _total: int = total
            ) -> None:
                progress((_index + min(max(fraction, 0.0), 1.0)) / _total)

            dest = model_dir.joinpath(*PurePosixPath(weights_file.path).parts)
            if not self._install_file(
                manifest, weights_file, dest, log, file_progress, token
            ):
                return False

        # v2.2.0 Phase 2 (2.1): stamp the true catalog id inside the weights
        # dir. The directory name is `safe_dir_name(id)`, so an id containing
        # ":" or "/" cannot be recovered from the path alone; the app's probe
        # prefers this marker over directory-name matching.
        write_model_id_marker(model_dir, manifest.model_id, log)

        progress(1.0)
        log(f"Model {manifest.model_id} downloaded and verified.", "success")
        return True

    # -- internals ---------------------------------------------------------

    def _disk_precheck(
        self,
        models_root: Path,
        manifest: WeightsManifest,
        state: InstallerState,
        log: LogFn,
    ) -> bool:
        """Refuse to start a download that would breach the OS disk reserve."""
        try:
            free_gb = shutil.disk_usage(models_root).free / 2**30
        except OSError:
            log(
                "Could not probe free disk space; continuing without the pre-check.",
                "warn",
            )
            return True
        needed_gb = manifest.size_gb + state.disk_reserve_gb
        if free_gb < needed_gb:
            log(
                f"Not enough disk space for {manifest.model_id}: "
                f"{free_gb:.1f} GB free, need ~{manifest.size_gb:.1f} GB plus "
                f"the {state.disk_reserve_gb} GB OS reserve.",
                "error",
            )
            return False
        return True

    def _install_file(
        self,
        manifest: WeightsManifest,
        weights_file: WeightsFile,
        dest: Path,
        log: LogFn,
        progress: ProgressFn,
        token: str | None = None,
    ) -> bool:
        label = f"{manifest.model_id}/{weights_file.path}"

        if dest.is_file():
            digest = _sha256_file(dest)
            if weights_file.is_placeholder:
                self._log_placeholder(label, digest, log)
                progress(1.0)
                return True
            if digest == weights_file.sha256:
                log(f"{label} already present and verified; skipping.", "info")
                progress(1.0)
                return True
            log(
                f"{label} exists but does not match its pin; re-downloading.",
                "warn",
            )
            with contextlib.suppress(OSError):
                dest.unlink()

        url = HF_RESOLVE_URL.format(
            repo=manifest.repo, revision=manifest.revision, path=weights_file.path
        )
        dest.parent.mkdir(parents=True, exist_ok=True)
        downloaded = False
        for attempt in range(1, MAX_DOWNLOAD_ATTEMPTS + 1):
            if self._cancelled:
                log("Model download cancelled by user.", "warn")
                return False
            outcome = self._download_with_resume(url, dest, log, progress, token)
            if outcome is _DownloadOutcome.OK:
                downloaded = True
                break
            if outcome is _DownloadOutcome.PERMANENT:
                suffix = (
                    "."
                    if token
                    else "; a Hugging Face token may be required (set HF_TOKEN)."
                )
                log(
                    f"Cannot download {label}: the server refused the request "
                    f"(gated, moved, or not found). Not retrying{suffix}",
                    "error",
                )
                return False
            if attempt < MAX_DOWNLOAD_ATTEMPTS and not self._cancelled:
                delay = RETRY_BACKOFF_SECONDS * attempt
                log(
                    f"Retrying {label} in {delay:.0f}s "
                    f"(attempt {attempt + 1} of {MAX_DOWNLOAD_ATTEMPTS})...",
                    "warn",
                )
                self._sleep(delay)
        if not downloaded:
            log(f"Failed to download {label}.", "error")
            return False

        digest = _sha256_file(dest)
        if weights_file.is_placeholder:
            self._log_placeholder(label, digest, log)
            return True
        if digest != weights_file.sha256:
            log(
                f"Checksum mismatch for {label}. Deleting the file to "
                "prevent loading unverified weights.",
                "error",
            )
            with contextlib.suppress(OSError):
                dest.unlink()
            return False
        log(f"{label} verified.", "success")
        return True

    @staticmethod
    def _log_placeholder(label: str, digest: str, log: LogFn) -> None:
        log(
            f"{label} has a placeholder pin; verification skipped. "
            f"Computed sha256 {digest} -- rotate the pin via {PIN_SCRIPT}.",
            "warn",
        )

    def _download_with_resume(
        self,
        url: str,
        dest: Path,
        log: LogFn,
        progress: ProgressFn,
        token: str | None = None,
    ) -> _DownloadOutcome:
        """Download `url` to `dest` via a resumable .partial file.

        Returns an outcome the caller retries only when TRANSIENT; a PERMANENT
        status (401/403/404) is never retried. A token, when provided, is sent
        as an `Authorization: Bearer` header for gated repos.
        """
        partial = Path(str(dest) + ".partial")
        existing = partial.stat().st_size if partial.exists() else 0
        headers = {"Range": f"bytes={existing}-"} if existing else {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if existing:
            log(f"Resuming download from byte {existing}...", "info")

        try:
            with httpx.stream(
                "GET", url, headers=headers, follow_redirects=True, timeout=300
            ) as resp:
                if resp.status_code == 416:
                    # The partial file already covers the full asset.
                    os.replace(partial, dest)
                    progress(1.0)
                    return _DownloadOutcome.OK
                resp.raise_for_status()

                if resp.status_code == 206:
                    mode = "ab"
                    total = existing + int(resp.headers.get("content-length", 0) or 0)
                else:
                    # Server ignored the Range header: restart from scratch.
                    mode = "wb"
                    existing = 0
                    total = int(resp.headers.get("content-length", 0) or 0)

                received = existing
                with partial.open(mode) as handle:
                    for chunk in resp.iter_bytes(DOWNLOAD_CHUNK_SIZE):
                        if self._cancelled:
                            log(
                                "Download cancelled; partial file kept for resume.",
                                "warn",
                            )
                            return _DownloadOutcome.TRANSIENT
                        handle.write(chunk)
                        received += len(chunk)
                        if total > 0:
                            progress(min(received / total, 1.0))
        except _HTTPStatusError as exc:
            log(f"Download error for {url}: {exc}", "error")
            if exc.response.status_code in PERMANENT_HTTP_STATUSES:
                return _DownloadOutcome.PERMANENT
            return _DownloadOutcome.TRANSIENT
        except (_HTTPError, OSError) as exc:
            log(f"Download error for {url}: {exc}", "error")
            return _DownloadOutcome.TRANSIENT

        os.replace(partial, dest)
        return _DownloadOutcome.OK
