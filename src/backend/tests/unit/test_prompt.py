"""Unit tests for prompt assembly and Gemma 4 chat template formatting."""

from __future__ import annotations

from backend.models.schemas import Message
from backend.services.prompt import (
    apply_gemma_template,
    assemble_prompt,
    clear_old_tool_results,
    is_gemma_model,
    sliding_window,
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
    assert result == "<|turn>user\nHello\n<turn|>\n<|turn>model\n"


def test_gemma_template_multi_turn() -> None:
    messages = [
        Message(role="user", content="Hi"),
        Message(role="assistant", content="Hello!"),
        Message(role="user", content="How are you?"),
    ]
    result = apply_gemma_template(messages)
    assert "<|turn>user\nHi\n<turn|>" in result
    assert "<|turn>model\nHello!\n<turn|>" in result
    assert "<|turn>user\nHow are you?\n<turn|>" in result
    assert result.endswith("<|turn>model\n")


def test_gemma_template_system_message_as_native_turn() -> None:
    """Gemma 4 supports native system role as a separate turn."""
    messages = [
        Message(role="system", content="You are a helpful assistant."),
        Message(role="user", content="What time is it?"),
    ]
    result = apply_gemma_template(messages)
    assert "<|turn>system\nYou are a helpful assistant.\n<turn|>" in result
    assert "<|turn>user\nWhat time is it?\n<turn|>" in result


def test_gemma_template_system_only_produces_model_prefix() -> None:
    """System message with no user turn should still produce model prefix."""
    messages = [Message(role="system", content="Setup.")]
    result = apply_gemma_template(messages)
    assert "<|turn>system\nSetup.\n<turn|>" in result
    assert result.endswith("<|turn>model\n")


def test_gemma_template_system_message_is_separate_turn() -> None:
    """In Gemma 4, system message is a standalone turn (not injected into user turn)."""
    messages = [
        Message(role="system", content="Be brief."),
        Message(role="user", content="Summarise."),
    ]
    result = apply_gemma_template(messages)
    # System and user are separate turns in Gemma 4.
    assert result.count("<|turn>user") == 1
    assert result.count("<|turn>system") == 1
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
    assert "<|turn>" in result[0].content


def test_assemble_prompt_non_gemma_model_returns_list_unchanged() -> None:
    messages = [
        Message(role="user", content="Hello"),
        Message(role="assistant", content="Hi"),
        Message(role="user", content="How are you?"),
    ]
    result = assemble_prompt(messages, model_name="llama3")
    assert len(result) == 3
    assert result[0].role == "user"


# ---------------------------------------------------------------------------
# Helper: build a tool result content block.
# ---------------------------------------------------------------------------


def _make_tool_result(name: str = "read_file", success: bool = True) -> str:
    import json

    payload = {"name": name, "response": {"success": success, "output": "data"}}
    return f"<|tool_result>\n{json.dumps(payload)}\n<tool_result|>"


# ---------------------------------------------------------------------------
# clear_old_tool_results
# ---------------------------------------------------------------------------


def test_clear_old_tool_results_no_tool_results() -> None:
    messages = [
        Message(role="user", content="Hello"),
        Message(role="assistant", content="Hi"),
    ]
    result = clear_old_tool_results(messages, keep_recent=8)
    assert result == messages


def test_clear_old_tool_results_within_keep_limit() -> None:
    messages = [
        Message(role="assistant", content=_make_tool_result("read_file"))
        for _ in range(5)
    ]
    result = clear_old_tool_results(messages, keep_recent=8)
    assert result == messages


def test_clear_old_tool_results_clears_oldest() -> None:
    messages = [
        Message(role="assistant", content=_make_tool_result(f"tool_{i}"))
        for i in range(12)
    ]
    result = clear_old_tool_results(messages, keep_recent=8)
    # First 4 should be cleared, last 8 untouched.
    for i in range(4):
        assert "[Tool result cleared:" in result[i].content
        assert "<|tool_result>" not in result[i].content
    for i in range(4, 12):
        assert "<|tool_result>" in result[i].content


def test_clear_old_tool_results_summary_format() -> None:
    messages = [
        Message(role="assistant", content=_make_tool_result("read_file", True)),
        Message(role="assistant", content=_make_tool_result("write_file", True)),
    ]
    result = clear_old_tool_results(messages, keep_recent=1)
    assert result[0].content == "[Tool result cleared: read_file succeeded]"


def test_clear_old_tool_results_failed_status() -> None:
    messages = [
        Message(role="assistant", content=_make_tool_result("delete_file", False)),
        Message(role="assistant", content=_make_tool_result("read_file", True)),
    ]
    result = clear_old_tool_results(messages, keep_recent=1)
    assert "failed" in result[0].content


def test_clear_old_tool_results_malformed_json() -> None:
    messages = [
        Message(role="assistant", content="<|tool_result>\nnot json\n<tool_result|>"),
        Message(role="assistant", content=_make_tool_result("read_file")),
    ]
    result = clear_old_tool_results(messages, keep_recent=1)
    assert result[0].content == "[Tool result cleared]"


# ---------------------------------------------------------------------------
# sliding_window
# ---------------------------------------------------------------------------


def test_sliding_window_no_trimming_needed() -> None:
    messages = [
        Message(role="user", content="Hello"),
        Message(role="assistant", content="Hi"),
    ]
    result = sliding_window(messages, keep_recent=10)
    assert result == messages


def test_sliding_window_keeps_system_messages() -> None:
    messages = [
        Message(role="system", content="System prompt"),
        *[Message(role="user", content=f"msg {i}") for i in range(20)],
    ]
    result = sliding_window(messages, keep_recent=5)
    system_msgs = [m for m in result if m.role == "system"]
    assert len(system_msgs) == 1
    assert system_msgs[0].content == "System prompt"


def test_sliding_window_keeps_first_message_as_anchor() -> None:
    messages = [
        Message(role="user", content="First message"),
        *[Message(role="assistant", content=f"reply {i}") for i in range(20)],
    ]
    result = sliding_window(messages, keep_recent=5)
    assert result[0].content == "First message"


def test_sliding_window_keeps_conversation_summary() -> None:
    messages = [
        Message(role="user", content="First message"),
        Message(
            role="assistant",
            content="[Conversation summary]\n\nSummary of prior context.",
        ),
        *[Message(role="user", content=f"msg {i}") for i in range(20)],
    ]
    result = sliding_window(messages, keep_recent=5)
    summaries = [m for m in result if m.content.startswith("[Conversation summary]")]
    assert len(summaries) == 1


def test_sliding_window_trims_middle_messages() -> None:
    messages = [
        Message(role="user", content=f"msg {i}") for i in range(20)
    ]
    result = sliding_window(messages, keep_recent=5)
    non_system = [m for m in result if m.role != "system"]
    # Anchor (msg 0) + last 5 (msg 15-19) = 6 messages.
    assert len(non_system) == 6
    assert non_system[0].content == "msg 0"
    assert non_system[-1].content == "msg 19"


# ---------------------------------------------------------------------------
# assemble_prompt — system_prompt injection
# ---------------------------------------------------------------------------


def test_assemble_prompt_injects_system_prompt() -> None:
    messages = [Message(role="user", content="Hello")]
    result = assemble_prompt(
        messages, model_name="llama3", system_prompt="Be helpful."
    )
    assert result[0].role == "system"
    assert result[0].content == "Be helpful."
    assert result[1].role == "user"


def test_assemble_prompt_no_duplicate_system_prompt() -> None:
    messages = [
        Message(role="system", content="Already here."),
        Message(role="user", content="Hello"),
    ]
    result = assemble_prompt(
        messages, model_name="llama3", system_prompt="Should not inject."
    )
    system_msgs = [m for m in result if m.role == "system"]
    assert len(system_msgs) == 1
    assert system_msgs[0].content == "Already here."
