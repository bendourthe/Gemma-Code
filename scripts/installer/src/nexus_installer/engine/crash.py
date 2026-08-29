"""Shared install-step exception formatting (GUI QThread and headless).

Windowed PyInstaller builds have no usable sys.stderr. Crash text must stay
one line, contain the exception type plus message, and never include a Hugging
Face token or a reconstructed argv list.
"""

from __future__ import annotations

from collections.abc import Callable

ENGINE_EXCEPTION_PREFIX = "Engine exception: "


def redact_crash_text(text: str, secret: str = "") -> str:
    """Strip a known secret from crash copy. Empty secret is a no-op."""
    if not text:
        return ""
    if secret:
        text = text.replace(secret, "[redacted]")
    return text


def format_engine_exception(exc: BaseException, *, secret: str = "") -> str:
    """One-line reason for install_finished and the persisted state log."""
    name = type(exc).__name__
    detail = redact_crash_text(str(exc) or name, secret)
    return f"{ENGINE_EXCEPTION_PREFIX}{name}: {detail}"


def is_engine_exception(message: str) -> bool:
    return message.startswith(ENGINE_EXCEPTION_PREFIX)


def call_step(fn: Callable[[], object]) -> tuple[bool, str]:
    """Run one headless/GUI step. Exceptions become (False, reason)."""
    try:
        return bool(fn()), ""
    except Exception as exc:
        return False, format_engine_exception(exc)
