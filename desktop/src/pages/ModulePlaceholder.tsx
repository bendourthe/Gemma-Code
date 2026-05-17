import type { ModuleId } from "../types/modules";
import { MODULES } from "../types/modules";

interface PlaceholderProps {
  moduleId: ModuleId;
  message?: string;
}

export function ModulePlaceholder({ moduleId, message }: PlaceholderProps): JSX.Element {
  const m = MODULES[moduleId];
  return (
    <section
      data-testid={`placeholder-${moduleId}`}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-8)",
        color: "var(--fg-1)",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "var(--text-2xl)",
          color: `var(${m.accentVar})`,
        }}
      >
        {m.label}
      </h1>
      <p style={{ margin: 0, color: "var(--fg-muted)" }}>
        {message ?? "Coming online in a later v1.0.0 phase. Shell-only route in Phase 1."}
      </p>
    </section>
  );
}
