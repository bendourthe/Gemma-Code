/**
 * v1.0.0 Phase 4.4 -- shared chat input.
 *
 * Multi-line textarea with Enter-to-send / Shift+Enter newline. Slash-command
 * autocomplete is layered on top by the Coding module via the dedicated
 * `CodingInput` wrapper; the Chat module uses this bare-bones input.
 */

import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

export interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (text: string) => void;
  rows?: number;
  /** Accent CSS variable to use for the submit button. */
  submitAccentVar?: string;
}

export function ChatInput({
  disabled,
  placeholder = "Type a message and press Enter to send.",
  onSubmit,
  rows = 3,
  submitAccentVar = "--accent-coding",
}: ChatInputProps): JSX.Element {
  const [value, setValue] = useState("");

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
  };

  return (
    <div
      data-testid="chat-input"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
    >
      <textarea
        data-testid="chat-input-textarea"
        aria-label="Chat input"
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={placeholder}
        rows={rows}
        style={textareaStyle}
      />
      <button
        type="button"
        data-testid="chat-input-submit"
        disabled={disabled || value.trim().length === 0}
        onClick={submit}
        style={submitStyle(submitAccentVar)}
      >
        Send
      </button>
    </div>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-2)",
  backgroundColor: "var(--bg-1)",
  color: "var(--fg-0)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  resize: "vertical",
};

function submitStyle(accentVar: string): CSSProperties {
  return {
    alignSelf: "flex-end",
    padding: "var(--space-2) var(--space-4)",
    backgroundColor: `var(${accentVar})`,
    color: "var(--bg-0)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  };
}
