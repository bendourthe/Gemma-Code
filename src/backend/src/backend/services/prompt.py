"""Prompt assembly and Gemma 4 chat template formatting."""

from __future__ import annotations

import json
import re

from backend.models.schemas import Message

# Approximate chars-per-token ratio used for context trimming heuristics.
_CHARS_PER_TOKEN = 4

# Maximum number of tokens to send to Ollama; messages beyond this are trimmed.
_DEFAULT_MAX_TOKENS = 131072

# Regex matching Gemma 4 tool result blocks.
_TOOL_RESULT_RE = re.compile(r"<\|tool_result>\n([\s\S]*?)\n<tool_result\|>")


def _summarize_tool_result(json_body: str) -> str:
    """Build a one-line summary from a tool result JSON body."""
    try:
        data = json.loads(json_body)
        name = data.get("name", "unknown")
        success = data.get("response", {}).get("success", True)
        status = "succeeded" if success else "failed"
        return f"[Tool result cleared: {name} {status}]"
    except (json.JSONDecodeError, TypeError, AttributeError):
        return "[Tool result cleared]"


def clear_old_tool_results(
    messages: list[Message],
    keep_recent: int = 8,
) -> list[Message]:
    """Replace tool result blocks in older messages with one-line summaries.

    Scans all messages for ``<|tool_result>...<tool_result|>`` blocks. The last
    *keep_recent* messages that contain tool results are left untouched; all
    older ones have their tool result bodies replaced with a summary line.
    """
    # Find indices of messages that contain tool result blocks.
    indices_with_results = [
        i for i, m in enumerate(messages) if _TOOL_RESULT_RE.search(m.content)
    ]

    if len(indices_with_results) <= keep_recent:
        return messages

    # Indices to clear: all except the last keep_recent.
    to_clear = set(indices_with_results[:-keep_recent])

    result: list[Message] = []
    for i, msg in enumerate(messages):
        if i in to_clear:
            cleared = _TOOL_RESULT_RE.sub(
                lambda m: _summarize_tool_result(m.group(1)), msg.content
            )
            result.append(msg.model_copy(update={"content": cleared}))
        else:
            result.append(msg)
    return result


def sliding_window(
    messages: list[Message],
    keep_recent: int = 10,
) -> list[Message]:
    """Keep system messages, anchor messages, and the most recent N non-system messages.

    Anchors are: the first non-system message and any message starting with
    ``[Conversation summary]``.
    """
    system_msgs = [m for m in messages if m.role == "system"]
    conversation = [m for m in messages if m.role != "system"]

    if len(conversation) <= keep_recent + 1:
        return messages

    # Anchor: first non-system message + conversation summary messages.
    anchor_indices: set[int] = {0}
    for i, m in enumerate(conversation):
        if m.content.startswith("[Conversation summary]"):
            anchor_indices.add(i)

    # Tail: last keep_recent messages.
    tail_start = len(conversation) - keep_recent
    tail_indices = set(range(tail_start, len(conversation)))

    # Collect anchors not already in the tail, then the tail.
    kept: list[Message] = []
    for i, m in enumerate(conversation):
        if i in anchor_indices or i in tail_indices:
            kept.append(m)

    return system_msgs + kept


def is_gemma_model(model_name: str) -> bool:
    """Return True when the model name indicates a Gemma family model."""
    return "gemma" in model_name.lower()


def apply_gemma_template(messages: list[Message]) -> str:
    """Format a message list using the Gemma 4 chat template.

    Gemma 4 uses ``<|turn>role`` / ``<turn|>`` delimiters with native
    support for the system role (no need to prepend to the first user turn).
    """
    parts: list[str] = []

    for msg in messages:
        if msg.role == "system":
            parts.append(f"<|turn>system\n{msg.content}\n<turn|>\n")
        elif msg.role == "user":
            parts.append(f"<|turn>user\n{msg.content}\n<turn|>\n")
        elif msg.role == "assistant":
            parts.append(f"<|turn>model\n{msg.content}\n<turn|>\n")

    # Open the model's reply turn.
    parts.append("<|turn>model\n")
    return "".join(parts)


def trim_history(
    messages: list[Message],
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> list[Message]:
    """Remove oldest non-system messages until the history fits within max_tokens.

    The system message (if any) is always preserved. At least the most recent
    user message is always kept so the model has context to reply to.
    """
    if not messages:
        return messages

    # Separate system messages from the rest.
    system_msgs = [m for m in messages if m.role == "system"]
    conversation = [m for m in messages if m.role != "system"]

    system_tokens = sum(len(m.content) // _CHARS_PER_TOKEN for m in system_msgs)
    budget = max_tokens - system_tokens

    # Always keep at least the last message.
    while len(conversation) > 1:
        total = sum(len(m.content) // _CHARS_PER_TOKEN for m in conversation)
        if total <= budget:
            break
        conversation.pop(0)

    return system_msgs + conversation


def assemble_prompt(
    messages: list[Message],
    model_name: str,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    *,
    system_prompt: str | None = None,
    tool_results_keep: int = 8,
    keep_recent: int = 10,
) -> list[Message]:
    """Trim history and optionally apply the Gemma chat template.

    For Gemma models the formatted prompt string is returned wrapped in a
    single user message so Ollama receives it as a pre-formatted string.
    For other models the trimmed message list is returned unchanged.

    The compaction pipeline runs in cost order before the final trim:
    1. Tool result clearing (zero-cost regex replacement)
    2. Sliding window (zero-cost filtering)
    3. Emergency trim (existing ``trim_history`` behaviour)
    """
    working = list(messages)

    # Inject system prompt if provided and not already present.
    if system_prompt and not any(m.role == "system" for m in working):
        working.insert(0, Message(role="system", content=system_prompt))

    # Strategy 1: Clear old tool results (zero-cost regex).
    working = clear_old_tool_results(working, keep_recent=tool_results_keep)

    # Strategy 2: Sliding window (zero-cost filtering).
    working = sliding_window(working, keep_recent=keep_recent)

    # Strategy 3: Emergency trim (drop oldest until within budget).
    trimmed = trim_history(working, max_tokens)

    if is_gemma_model(model_name):
        formatted = apply_gemma_template(trimmed)
        # Wrap in a bare user message; system prompt already embedded.
        return [Message(role="user", content=formatted)]

    return trimmed
