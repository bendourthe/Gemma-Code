"""Ollama model pull with progress parsing.

v1.11.0 Phase 1 (T101/T102): the reader is byte-mode and indestructible.

The v1.10 text-mode reader died on ollama's braille progress spinner: frame
U+280F encodes to UTF-8 ``e2 a0 8f`` and ``0x8f`` is unmapped in cp1252 (the
Windows locale codec ``text=True`` uses), so ~1s into any real pull the reader
raised UnicodeDecodeError, the ``except ValueError`` swallowed it as a fake
EOF, the loop broke while the download was still running, and ``wait(10)``
timed out -> the pull was terminated and reported as ``exit code -1``
(reproduced under pythonw in the T101 forensics). The reader now:

* reads raw bytes and decodes UTF-8 with ``errors="replace"`` (cannot raise),
* splits on BOTH ``\\n`` and ``\\r`` so carriage-return progress rewrites are
  parsed live for percentages,
* strips ANSI/VT escape sequences and spinner-only fragments before logging,
* reports a reader failure as a reader failure -- never as EOF, and
* stops on the *process* exiting (``poll()``), because ``ollama pull`` can
  leave its stdout pipe held open by children it spawns (the auto-started
  server), so stream EOF and process exit are independent events.
"""

from __future__ import annotations

import queue
import re
import subprocess
import threading
import time
from collections.abc import Callable

from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.installer_state import InstallerState

_PROGRESS_RE = re.compile(r"(\d+)%")

# CSI sequences (incl. private modes like [?25l / [?2026h), OSC sequences, and
# any other lone ESC-prefixed byte ollama's terminal renderer emits.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b.")

# Braille spinner glyphs (U+2800-U+28FF); a fragment that is only spinner +
# whitespace carries no information worth logging.
_BRAILLE_RE = re.compile("[\u2800-\u28ff]")

# Terminate a pull that produces no output for this long while its process is
# still alive (a genuinely stuck download), so the step can never hang forever.
_IDLE_TIMEOUT_S = 1800

# Queue message kinds from the reader thread.
_KIND_LINE = "line"
_KIND_EOF = "eof"
_KIND_READER_ERROR = "reader-error"

# Prefer these phrases over a trailing URL when summarizing a failed pull.
# Ollama's 412 path ends with https://ollama.com/download, which used to become
# last_error and hide the actual "requires a newer version" reason.
_PULL_ERROR_NEEDLES = (
    "requires a newer version",
    "tag is not available",
    "file does not exist",
    "pull model manifest",
    "error:",
)


def clean_terminal_text(raw: str) -> str:
    """Strip ANSI escapes and control characters from one output fragment."""
    text = _ANSI_RE.sub("", raw)
    return "".join(ch for ch in text if ch == "\t" or ord(ch) >= 32).strip()


# v2.2.0 Phase 2 (2.3): failure classes for a pull, so the summary UI can offer
# the right remedy instead of a raw log line.
PULL_FAILURE_VERSION = "ollama-too-old"
PULL_FAILURE_NETWORK = "network"
PULL_FAILURE_DISK = "disk"
PULL_FAILURE_NOT_FOUND = "not-found"
PULL_FAILURE_CANCELLED = "cancelled"
PULL_FAILURE_UNKNOWN = "unknown"


def classify_pull_failure(message: str) -> str:
    """Map a pull failure message onto one of the PULL_FAILURE_* classes.

    The 412 case is why this exists: Ollama answers "requires a newer version"
    and then prints its download URL, so the user previously saw only a bare
    link in the log and the installer continued as if the model were optional.
    """
    text = (message or "").lower()
    if not text:
        return PULL_FAILURE_UNKNOWN
    if "cancelled" in text or "canceled" in text:
        return PULL_FAILURE_CANCELLED
    if "requires a newer version" in text or "412" in text:
        return PULL_FAILURE_VERSION
    if any(
        needle in text
        for needle in ("no space", "disk full", "not enough space", "enospc")
    ):
        return PULL_FAILURE_DISK
    if any(
        needle in text
        for needle in (
            "connection",
            "timeout",
            "timed out",
            "network",
            "dns",
            "unreachable",
            "eof",
            "tls",
        )
    ):
        return PULL_FAILURE_NETWORK
    if "file does not exist" in text or "tag is not available" in text:
        return PULL_FAILURE_NOT_FOUND
    return PULL_FAILURE_UNKNOWN


def remedy_for_failure(failure_class: str) -> str:
    """One actionable sentence per failure class, for the summary UI."""
    return {
        PULL_FAILURE_VERSION: (
            "This model needs a newer Ollama than the one installed. "
            "Re-run the installer to upgrade Ollama, then retry the download."
        ),
        PULL_FAILURE_NETWORK: (
            "The download was interrupted by a network problem. Check the "
            "connection and retry."
        ),
        PULL_FAILURE_DISK: (
            "There is not enough free disk space for this model. Free some "
            "space and retry."
        ),
        PULL_FAILURE_NOT_FOUND: (
            "This model tag is no longer published. Report it so the catalog "
            "can be corrected."
        ),
        PULL_FAILURE_CANCELLED: "The download was cancelled.",
    }.get(failure_class, "Retry the download; if it keeps failing, report the log.")


def summarize_pull_failure(messages: list[str], exit_code: int) -> str:
    """Pick the useful failure line, not a trailing download URL."""
    nonempty = [m.strip() for m in messages if m and m.strip()]
    if not nonempty:
        return f"ollama pull exited with code {exit_code}"
    for needle in _PULL_ERROR_NEEDLES:
        for text in reversed(nonempty):
            if needle in text.lower():
                return text
    for text in reversed(nonempty):
        if not text.lower().startswith("http"):
            return text
    return nonempty[-1]


class ModelPuller:
    """Pulls one Ollama-protocol model via `ollama pull` with progress."""

    def __init__(self) -> None:
        self._process: subprocess.Popen[bytes] | None = None
        self._cancelled = False
        #: Plain-language reason for the most recent failure ("" on success);
        #: surfaced per-model by the router's failure events (T105/T303).
        self.last_error: str = ""
        #: v2.2.0 Phase 2 (2.3): PULL_FAILURE_* class for `last_error`.
        self.last_failure_class: str = ""

    def pull(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
        progress: Callable[[float], None],
    ) -> bool:
        """Pull the selected model. Returns True on success."""
        model = state.selected_model
        if not model:
            log("No model selected. Skipping model pull.", "warn")
            return True
        return self.pull_model(model, log, progress)

    def pull_model(
        self,
        model: str,
        log: Callable[[str, str], None],
        progress: Callable[[float], None],
    ) -> bool:
        """Pull one named model via `ollama pull`. Returns True on success.

        v1.8.0 Phase 3: split out of `pull` so the protocol router can pull
        each ollama-sourced model of a multi-selection individually.
        """
        self.last_error = ""
        log(f"Pulling model {model}... This may take several minutes.", "info")

        try:
            self._process = subprocess.Popen(
                ["ollama", "pull", model],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                **no_window_kwargs(),
            )
        except FileNotFoundError:
            self.last_error = "ollama command not found"
            log("ollama command not found. Ensure Ollama is installed.", "error")
            return False
        except OSError as e:
            self.last_error = f"could not start ollama: {e}"
            log(f"Error pulling model: {e}", "error")
            return False

        proc = self._process
        assert proc.stdout is not None
        q: queue.Queue[tuple[str, str]] = queue.Queue()

        def _reader(stream: object) -> None:
            try:
                buf = b""
                while True:
                    chunk = stream.read1(4096)  # type: ignore[attr-defined]
                    if not chunk:
                        break
                    buf += chunk
                    while True:
                        cuts = [
                            i for i in (buf.find(b"\n"), buf.find(b"\r")) if i != -1
                        ]
                        if not cuts:
                            break
                        cut = min(cuts)
                        segment, buf = buf[:cut], buf[cut + 1 :]
                        q.put((_KIND_LINE, segment.decode("utf-8", errors="replace")))
                if buf:
                    q.put((_KIND_LINE, buf.decode("utf-8", errors="replace")))
            except (OSError, ValueError) as exc:
                # A reader failure is reported as such -- NEVER as EOF (the
                # v1.10 fake-EOF path killed healthy downloads; T101).
                q.put((_KIND_READER_ERROR, f"{type(exc).__name__}: {exc}"))
            finally:
                q.put((_KIND_EOF, ""))

        threading.Thread(target=_reader, args=(proc.stdout,), daemon=True).start()

        last_output = time.monotonic()
        last_message = ""
        messages: list[str] = []
        logged_decile = -1
        while True:
            if self._cancelled:
                proc.terminate()
                self.last_error = "cancelled by user"
                log("Model pull cancelled by user.", "warn")
                return False
            try:
                kind, payload = q.get(timeout=0.5)
            except queue.Empty:
                # No output right now: stop once the pull PROCESS has exited;
                # give up only after a long stretch of true silence.
                if proc.poll() is not None:
                    break
                if time.monotonic() - last_output > _IDLE_TIMEOUT_S:
                    proc.terminate()
                    self.last_error = "download stalled (no output)"
                    log("Model pull stalled (no output); aborting.", "error")
                    return False
                continue

            if kind == _KIND_EOF:
                # Stream closed. The process usually exits right after; keep
                # the loop poll-driven rather than assuming anything.
                continue
            if kind == _KIND_READER_ERROR:
                log(f"Output reader error (pull continues): {payload}", "warn")
                continue

            last_output = time.monotonic()
            text = clean_terminal_text(payload)
            if not text or not _BRAILLE_RE.sub("", text).strip():
                continue  # spinner-only fragment

            match = _PROGRESS_RE.search(text)
            if match:
                pct = min(int(match.group(1)), 100)
                progress(pct / 100.0)
                decile = pct // 10
                if decile > logged_decile:
                    logged_decile = decile
                    log(text, "info")
            else:
                last_message = text
                messages.append(text)
                log(text, "info")

        exit_code = proc.returncode
        if exit_code is None:
            try:
                exit_code = proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.terminate()
                exit_code = -1

        if exit_code == 0:
            log(f"Model {model} pulled successfully.", "success")
            progress(1.0)
            return True
        self.last_error = summarize_pull_failure(messages, exit_code) or (
            last_message or f"ollama pull exited with code {exit_code}"
        )
        self.last_failure_class = classify_pull_failure(self.last_error)
        log(f"Model pull failed (exit code {exit_code}): {self.last_error}", "error")
        log(remedy_for_failure(self.last_failure_class), "warn")
        return False

    def cancel(self) -> None:
        """Request cancellation of the current pull."""
        self._cancelled = True
        if self._process:
            self._process.terminate()
