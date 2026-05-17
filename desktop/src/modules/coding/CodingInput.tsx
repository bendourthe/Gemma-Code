import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { filterSlashCommands, SLASH_COMMANDS } from "./slashCommands";

export interface CodingInputProps {
  disabled?: boolean;
  onSubmit: (text: string) => void;
}

export function CodingInput({ disabled, onSubmit }: CodingInputProps): JSX.Element {
  const [value, setValue] = useState("");
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) return [];
    return filterSlashCommands(value).slice(0, 8);
  }, [value]);

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

  const pickSuggestion = (idx: number): void => {
    const cmd = suggestions[idx];
    if (!cmd) return;
    setValue(cmd.template);
  };

  return (
    <div data-testid="coding-input" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {suggestions.length > 0 && (
        <ul
          data-testid="coding-input-suggestions"
          aria-label="Slash command suggestions"
          style={{
            listStyle: "none",
            margin: 0,
            padding: "var(--space-2)",
            backgroundColor: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
          }}
        >
          {suggestions.map((s, i) => (
            <li key={s.name}>
              <button
                type="button"
                data-testid={`slash-${s.name}`}
                onClick={() => pickSuggestion(i)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  color: "var(--fg-0)",
                  border: "none",
                  padding: "var(--space-1) var(--space-2)",
                  cursor: "pointer",
                }}
              >
                <strong>/{s.name}</strong>
                <span style={{ color: "var(--fg-muted)", marginLeft: "var(--space-2)" }}>
                  {s.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        data-testid="coding-input-textarea"
        aria-label="Coding chat input"
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={`Ask anything. Type / for commands (${SLASH_COMMANDS.length} available).`}
        rows={3}
        style={{
          width: "100%",
          padding: "var(--space-2)",
          backgroundColor: "var(--bg-1)",
          color: "var(--fg-0)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--radius-md)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          resize: "vertical",
        }}
      />
      <button
        type="button"
        data-testid="coding-input-submit"
        disabled={disabled || value.trim().length === 0}
        onClick={submit}
        style={{
          alignSelf: "flex-end",
          padding: "var(--space-2) var(--space-4)",
          backgroundColor: "var(--accent-coding)",
          color: "var(--bg-0)",
          border: "none",
          borderRadius: "var(--radius-md)",
          cursor: "pointer",
        }}
      >
        Send
      </button>
    </div>
  );
}
