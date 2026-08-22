/**
 * v1.0.0 Phase 4.4 -- shared model selector.
 *
 * Reusable model dropdown shared between the Coding and Chat modules.
 */

import type { ModelOption } from "./types";
import { Select } from "../../components/ui/Select";

export interface ModelSelectorProps {
  models: readonly ModelOption[];
  value: string;
  disabled?: boolean;
  onChange: (modelId: string) => void;
  label?: string;
  testId?: string;
  /**
   * v1.18.0 Phase 2 -- optional scaffold-profile name shown as a small badge
   * next to the dropdown. Omit to keep the compact selector unchanged.
   */
  harnessLabel?: string;
  /**
   * v1.18 DF-4 -- when false, suffix the badge with "off" so it is not
   * mistaken for a live overlay.
   */
  harnessSelectorEnabled?: boolean;
  /**
   * v1.18.0 Phase 3 (OW-A4) -- when true, show a "tool-calling verified" badge
   * distinct from models that merely run. Tooltip cites benchmark provenance.
   */
  toolCallingVerified?: boolean;
  toolCallingProvenance?: string;
}

export function ModelSelector({
  models,
  value,
  disabled,
  onChange,
  label = "Model",
  testId = "model-selector",
  harnessLabel,
  harnessSelectorEnabled,
  toolCallingVerified,
  toolCallingProvenance,
}: ModelSelectorProps): JSX.Element {
  const selected = models.find((m) => m.id === value);
  const verified = toolCallingVerified ?? selected?.toolCallingVerified === true;
  const provenance =
    toolCallingProvenance ??
    (selected?.toolCallingBenchmark
      ? `${selected.toolCallingBenchmark.suite} (${selected.toolCallingBenchmark.date}): ${selected.toolCallingBenchmark.result}`
      : "Verified for agentic tool-calling in the Nexus catalog. Models without this badge may still run.");
  const badgeStyle: React.CSSProperties = {
    fontSize: "var(--text-xs, 0.75rem)",
    color: "var(--fg-muted)",
    border: "1px solid var(--border-1)",
    borderRadius: "var(--radius-md)",
    padding: "0 var(--space-2)",
    lineHeight: 1.6,
  };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <Select
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
          <option
            key={m.id}
            value={m.id}
            data-task={m.task ?? ""}
            title={m.licenseNote}
          >
            {m.displayName}
          </option>
        ))}
      </Select>
      {harnessLabel ? (
        <span
          data-testid={`${testId}-harness`}
          title={
            harnessSelectorEnabled === false
              ? "Scaffold profile for this model (selector off -- overlay not applied)"
              : "Scaffold profile selected for this model family and tier"
          }
          style={badgeStyle}
        >
          {harnessSelectorEnabled === false ? `${harnessLabel} (off)` : harnessLabel}
        </span>
      ) : null}
      {verified ? (
        <span
          data-testid={`${testId}-tool-calling`}
          title={provenance}
          style={badgeStyle}
        >
          tool-calling verified
        </span>
      ) : null}
    </label>
  );
}
