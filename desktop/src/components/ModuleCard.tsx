import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ModuleId } from "../types/modules";
import { MODULES } from "../types/modules";

export interface ModuleCardProps {
  moduleId: ModuleId;
  subtitle: string;
  body: string;
  cta: string;
  to: string;
  icon: ReactNode;
  preview?: ReactNode;
}

export function ModuleCard({
  moduleId,
  subtitle,
  body,
  cta,
  to,
  icon,
  preview,
}: ModuleCardProps): JSX.Element {
  const navigate = useNavigate();
  const descriptor = MODULES[moduleId];
  const accent = `var(${descriptor.accentVar})`;
  const accentSoft = `var(${descriptor.accentSoftVar})`;

  return (
    <article
      data-testid={`module-card-${moduleId}`}
      style={{
        backgroundColor: "var(--bg-1)",
        border: `1px solid var(--border-subtle)`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-5)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gridTemplateRows: "auto 1fr auto",
        gap: "var(--space-3)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <header style={{ gridColumn: 1, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-md)",
            backgroundColor: accentSoft,
            color: accent,
          }}
        >
          {icon}
        </span>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-md)",
              fontWeight: 600,
              color: "var(--fg-0)",
            }}
          >
            {descriptor.label}
          </h3>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>{subtitle}</span>
        </div>
      </header>

      <div
        aria-hidden
        data-testid={`module-card-${moduleId}-preview`}
        style={{
          gridColumn: 2,
          gridRow: "1 / span 2",
          width: 96,
          height: 64,
          borderRadius: "var(--radius-md)",
          backgroundColor: accentSoft,
          border: `1px dashed ${accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accent,
          fontSize: "var(--text-xs)",
          fontWeight: 600,
        }}
      >
        {preview ?? "preview"}
      </div>

      <p
        style={{
          gridColumn: 1,
          margin: 0,
          fontSize: "var(--text-sm)",
          color: "var(--fg-1)",
          lineHeight: 1.45,
        }}
      >
        {body}
      </p>

      <button
        type="button"
        data-testid={`module-card-${moduleId}-cta`}
        onClick={() => navigate(to)}
        style={{
          gridColumn: 1,
          justifySelf: "start",
          background: accent,
          color: "var(--bg-0)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-4)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
        }}
      >
        {cta}
      </button>
    </article>
  );
}
