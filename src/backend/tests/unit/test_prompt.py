"""Unit tests for prompt assembly and Gemma 4 chat template formatting."""

from __future__ import annotations

from backend.models.schemas import Message
from backend.services.prompt import (
    apply_gemma_template,
    assemble_prompt,
    is_gemma_model,
    trim_history,
)

# ---------------------------------------------------------------------------
# is_gemma_model
# ---------------------------------------------------------------------------


def test_is_gemma_model_matches_gemma3() -> None:
    assert is_gemma_model("gemma3:27b") is True


def test_is_gemma_model_matches_gemma4() -> None:
    assert is_gemma_model("gemma4") is True


def test_is_gemma_model_case_insensitive() -> None:
    assert is_gemma_model("Gemma3:2b") is True


def test_is_gemma_model_rejects_llama() -> None:
    assert is_gemma_model("llama3") is False


# ---------------------------------------------------------------------------
# apply_gemma_template
# ---------------------------------------------------------------------------


def test_gemma_template_single_user_turn() -> None:
    messages = [Message(role="user", content="Hello")]
    result = apply_gemma_template(messages)
    assert result == "<start_of_turn>user\nHello<end_of_turn>\n<start_of_turn>model\n"


def test_gemma_template_multi_turn() -> None:
    messages = [
        Message(role="user", content="Hi"),
        Message(role="assistant", content="Hello!"),
        Message(role="user", content="How are you?"),
    ]
    result = apply_gemma_template(messages)
    assert "<start_of_turn>user\nHi<end_of_turn>" in result
    assert "<start_of_turn>model\nHello!<end_of_turn>" in result
    assert "<start_of_turn>user\nHow are you?<end_of_turn>" in result
    assert result.endswith("<start_of_turn>model\n")


def test_gemma_template_system_message_injected_into_first_user_turn() -> None:
    messages = [
        Message(role="system", content="You are a helpful assistant."),
        Message(role="user", content="What time is it?"),
    ]
    result = apply_gemma_template(messages)
    expected = (
        "<start_of_turn>user\n"
        "You are a helpful assistant.\n\nWhat time is it?"
        "<end_of_turn>"
    )
    assert expected in result


def test_gemma_template_system_only_no_user_turn() -> None:
    """System message with no user turn should still produce model prefix."""
    messages = [Message(role="system", content="Setup.")]
    result = apply_gemma_template(messages)
    # No user turn, so pending_system never gets flushed into a turn.
    assert result == "<start_of_turn>model\n"


def test_gemma_template_no_system_message_preserved() -> None:
    """Verify the system message is NOT emitted as a standalone turn."""
    messages = [
        Message(role="system", content="Be brief."),
        Message(role="user", content="Summarise."),
    ]
    result = apply_gemma_template(messages)
    # There should be exactly one user turn (the system content injected into it).
    assert result.count("<start_of_turn>user") == 1
    assert "Be brief." in result


# ---------------------------------------------------------------------------
# trim_history
# ---------------------------------------------------------------------------


def test_trim_history_no_trim_needed() -> None:
    messages = [
        Message(role="user", content="Hi"),
        Message(role="assistant", content="Hello"),
    ]
    result = trim_history(messages, max_tokens=8192)
    assert result == messages


def test_trim_history_removes_oldest_first() -> None:
    # Each message is ~10 chars = ~2 tokens. Budget = 3 tokens → keep last 1 conv msg.
    messages = [
        Message(role="user", content="Message one"),  # ~2 tokens
        Message(role="assistant", content="Message two"),  # ~2 tokens
        Message(role="user", content="Message three"),  # ~3 tokens
    ]
    result = trim_history(messages, max_tokens=4)
    # Only the most recent message(s) that fit should remain.
    assert result[-1].content == "Message three"
    assert len(result) < len(messages)


def test_trim_history_always_keeps_last_message() -> None:
    long_content = "x" * 10_000  # ~2500 tokens
    messages = [
        Message(role="user", content=long_content),
    ]
    result = trim_history(messages, max_tokens=10)
    assert len(result) == 1
    assert result[0].content == long_content


def test_trim_history_preserves_system_message() -> None:
    messages = [
        Message(role="system", content="System prompt."),
        Message(role="user", content="A" * 4000),  # 1000 tokens
        Message(role="assistant", content="B" * 4000),  # 1000 tokens
        Message(role="user", content="Latest"),
    ]
    result = trim_history(messages, max_tokens=500)
    system_msgs = [m for m in result if m.role == "system"]
    assert len(system_msgs) == 1
    assert system_msgs[0].content == "System prompt."


def test_trim_history_empty_list() -> None:
    assert trim_history([], max_tokens=8192) == []


# ---------------------------------------------------------------------------
# assemble_prompt
# ---------------------------------------------------------------------------


def test_assemble_prompt_gemma_model_returns_single_message() -> None:
    messages = [
        Message(role="user", content="Hello"),
    ]
    result = assemble_prompt(messages, model_name="gemma4")
    assert len(result) == 1
    assert result[0].role == "user"
    assert "<start_of_turn>" in result[0].content


def test_assemble_prompt_non_gemma_model_returns_list_unchanged() -> None:
    messages = [
        Message(role="user", content="Hello"),
        Message(role="assistant", content="Hi"),
        Message(role="user", content="How are you?"),
    ]
    result = assemble_prompt(messages, model_name="llama3")
    assert len(result) == 3
    assert result[0].role == "user"
