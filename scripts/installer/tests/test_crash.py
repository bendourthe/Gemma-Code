"""Crash formatting, redaction, and shared call_step helper."""

from __future__ import annotations

from nexus_installer.engine.crash import (
    ENGINE_EXCEPTION_PREFIX,
    call_step,
    format_engine_exception,
    is_engine_exception,
    redact_crash_text,
)

_TOKEN = "hf_secret_token_xyz"


class TestRedactAndFormat:
    def test_empty_secret_is_noop(self) -> None:
        assert redact_crash_text("boom", "") == "boom"

    def test_redacts_token(self) -> None:
        assert _TOKEN not in redact_crash_text(f"boom {_TOKEN}", _TOKEN)

    def test_format_includes_type_and_prefix(self) -> None:
        reason = format_engine_exception(RuntimeError("pull exploded"))
        assert reason.startswith(ENGINE_EXCEPTION_PREFIX)
        assert "RuntimeError" in reason
        assert "pull exploded" in reason

    def test_format_strips_token(self) -> None:
        reason = format_engine_exception(RuntimeError(f"using {_TOKEN}"), secret=_TOKEN)
        assert _TOKEN not in reason
        assert "[redacted]" in reason

    def test_is_engine_exception(self) -> None:
        assert is_engine_exception("Engine exception: RuntimeError: x")
        assert not is_engine_exception("Installation completed with failures: ollama")


class TestCallStep:
    def test_success(self) -> None:
        ok, reason = call_step(lambda: True)
        assert ok is True
        assert reason == ""

    def test_false_without_exception(self) -> None:
        ok, reason = call_step(lambda: False)
        assert ok is False
        assert reason == ""

    def test_exception_becomes_reason(self) -> None:
        def boom() -> bool:
            raise RuntimeError("no argv here")

        ok, reason = call_step(boom)
        assert ok is False
        assert is_engine_exception(reason)
        assert "RuntimeError" in reason
        assert "no argv here" in reason
