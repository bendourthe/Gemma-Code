"""Prompt assembly and Gemma 4 chat template formatting."""

from __future__ import annotations

from backend.models.schemas import Message

# Approximate chars-per-token ratio used for context trimming heuristics.
_CHARS_PER_TOKEN = 4

# Maximum number of tokens to send to Ollama; messages beyond this are trimmed.
_DEFAULT_MAX_TOKENS = 32768


def is_gemma_model(model_name: str) -> bool:
    """Return True when the model name indicates a Gemma family model."""
    return "gemma" in model_name.lower()


def apply_gemma_template(messages: list[Message]) -> str:
    """Format a message list using the Gemma chat template.

    Gemma uses ``<start_of_turn>`` / ``<end_of_turn>`` delimiters.
    System messages have no dedicated role token; instead their content is
    prepended to the first user turn.
    """
    parts: list[str] = []
    pending_system: str = ""

    for msg in messages:
        if msg.role == "system":
            # Accumulate system content to inject into the next user turn.
            pending_system = msg.content
        elif msg.role == "user":
            content = msg.content
            if pending_system:
                content = f"{pending_system}\n\n{content}"
                pending_system = ""
            parts.append(f"<start_of_turn>user\n{content}<end_of_turn>\n")
        elif msg.role == "assistant":
            parts.append(f"<start_of_turn>model\n{msg.content}<end_of_turn>\n")

    # Open the model's reply turn.
    parts.append("<start_of_turn>model\n")
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
) -> list[Message]:
    """Trim history and optionally apply the Gemma chat template.

    For Gemma models the formatted prompt string is returned wrapped in a
    single user message so Ollama receives it as a pre-formatted string.
    For other models the trimmed message list is returned unchanged.
    """
    trimmed = trim_history(messages, max_tokens)

    if is_gemma_model(model_name):
        formatted = apply_gemma_template(trimmed)
        # Wrap in a bare user message; system prompt already embedded.
        return [Message(role="user", content=formatted)]

    return trimmed
