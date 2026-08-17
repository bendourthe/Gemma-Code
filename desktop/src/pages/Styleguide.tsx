import { useState } from "react";
import { useActiveMotionSurface } from "../motion";

// Token inspection page. Used to visually verify the design tokens during
// dev. Linked from the router as `/_styleguide`.

const SURFACE_TOKENS = ["--bg-0", "--bg-1", "--bg-2", "--bg-elevated"];
const FG_TOKENS = ["--fg-0", "--fg-1", "--fg-muted", "--fg-disabled"];
const ACCENT_TOKENS = [
  "--accent-chatbot",
  "--accent-coding",
  "--accent-image",
  "--accent-video",
];
const STATUS_TOKENS = ["--status-ok", "--status-warn", "--status-err", "--status-info"];
const RADIUS_TOKENS = ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl"];

function Swatch({ name }: { name: string }): JSX.Element {
  return (
    <div
      data-testid={`swatch-${name}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-1)",
        fontSize: "var(--text-xs)",
        color: "var(--fg-muted)",
      }}
    >
      <span
        style={{
          width: 64,
          height: 64,
          background: `var(${name})`,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)",
        }}
      />
      <code style={{ fontFamily: "var(--font-mono)" }}>{name}</code>
    </div>
  );
}

export function StyleguidePage(): JSX.Element {
  return (
    <section
      data-testid="styleguide"
      style={{
        flex: 1,
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
        overflowY: "auto",
        color: "var(--fg-0)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: "var(--text-2xl)" }}>Nexus design tokens</h1>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)" }}>Surfaces</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {SURFACE_TOKENS.map((t) => (
            <Swatch key={t} name={t} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)" }}>Foreground</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {FG_TOKENS.map((t) => (
            <Swatch key={t} name={t} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)" }}>Module accents</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {ACCENT_TOKENS.map((t) => (
            <Swatch key={t} name={t} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)" }}>Semantic</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {STATUS_TOKENS.map((t) => (
            <Swatch key={t} name={t} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)" }}>Radius</h2>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          {RADIUS_TOKENS.map((t) => (
            <div
              key={t}
              data-testid={`radius-${t}`}
              style={{
                width: 96,
                height: 64,
                background: "var(--bg-elevated)",
                borderRadius: `var(${t})`,
                border: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-xs)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </section>

      <RecedeReference />
    </section>
  );
}

/**
 * Phase 1 reference integration for recede-when-active. Production surfaces
 * adopt the primitive in Phase 5; this toggle proves the ambient glow
 * recedes and restores without layout shift.
 */
function RecedeReference(): JSX.Element {
  const [active, setActive] = useState(false);
  useActiveMotionSurface("styleguide-reference", active);
  return (
    <section data-testid="recede-reference">
      <h2 style={{ fontSize: "var(--text-lg)" }}>Motion recede</h2>
      <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", marginTop: 0 }}>
        Reference surface for the recede-when-active primitive. Activating an
        effect dims the ambient glow; deactivating restores it.
      </p>
      <button
        type="button"
        data-testid="recede-reference-toggle"
        aria-pressed={active}
        onClick={() => setActive((value) => !value)}
        style={{
          fontFamily: "inherit",
          fontSize: "var(--text-sm)",
          padding: "var(--space-2) var(--space-4)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-strong)",
          background: active ? "var(--accent-chatbot-soft)" : "var(--bg-2)",
          color: "var(--fg-0)",
          cursor: "pointer",
        }}
      >
        {active ? "Active effect on" : "Active effect off"}
      </button>
    </section>
  );
}
