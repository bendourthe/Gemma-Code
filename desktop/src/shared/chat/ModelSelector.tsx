/**
 * v1.0.0 Phase 4.4 -- shared model selector.
 *
 * Reusable model dropdown shared between the Coding and Chat modules.
 */

import type { ModelOption } from "./types";

export interface ModelSelectorProps {
  models: readonly ModelOption[];
  value: string;
  disabled?: boolean;
  onChange: (modelId: string) => void;
  label?: string;
  testId?: string;
}

export function ModelSelector({
  models,
  value,
  disabled,
  onChange,
  label = "Model",
  testId = "model-selector",
}: ModelSelectorProps): JSX.Element {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          padding: "var(--space-1) var(--space-2)",
          backgroundColor: "var(--bg-1)",
          color: "var(--fg-0)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
