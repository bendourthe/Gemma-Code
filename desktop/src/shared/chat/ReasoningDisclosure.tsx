import { useState } from "react";

export interface ReasoningDisclosureProps {
  readonly messageId: string;
  readonly text?: string | null;
  readonly tokenCount?: number | null;
}

const MAX_REASONING_DISPLAY_CHARS = 64 * 1024;

/** Renders only provider-exposed reasoning, collapsed independently per message. */
export function ReasoningDisclosure({
  messageId,
  text,
  tokenCount,
}: ReasoningDisclosureProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) return null;
  const bounded = normalized.slice(0, MAX_REASONING_DISPLAY_CHARS);
  const validTokens =
    typeof tokenCount === "number" && Number.isFinite(tokenCount) && tokenCount >= 0
      ? Math.floor(tokenCount)
      : null;
  const label = validTokens === null ? "Reasoning" : `Reasoning (${validTokens} tokens)`;
  return (
    <section
      data-testid={`message-reasoning-${messageId}`}
      style={{ width: "100%", color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`message-reasoning-content-${messageId}`}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-1) 0",
          border: 0,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          ▸
        </span>
        {label}
      </button>
      {open ? (
        <pre
          id={`message-reasoning-content-${messageId}`}
          aria-label="Model-provided reasoning"
          tabIndex={0}
          style={{
            maxHeight: "16rem",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            userSelect: "text",
            margin: "var(--space-1) 0 var(--space-2)",
            padding: "var(--space-2)",
            borderLeft: "2px solid var(--bubble-border)",
            font: "inherit",
            color: "var(--fg-1)",
          }}
        >
          {bounded}
        </pre>
      ) : null}
    </section>
  );
}
