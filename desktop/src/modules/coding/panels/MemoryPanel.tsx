import { useState } from "react";
import type {
  MemoryEntryProvenanceT,
  MemorySnapshotT,
} from "../../../../sidecar/src/protocol";

export interface MemoryPanelProps {
  snapshot: MemorySnapshotT | null;
  /**
   * v1.1.0 Phase 6.5 -- invoked when the user clicks "Forget" on a row.
   * The handler is responsible for confirmation + IPC dispatch; the panel
   * only signals intent. When omitted the Forget button is not rendered
   * (legacy mode -- prevents an inert button in pre-Phase-6 sidecars).
   */
  onForget?: (layerKey: string, index: number, entry: string) => void;
}

/**
 * v1.1.0 Phase 4.5 -- the Memory panel gains a "Show provenance" toggle.
 * When on, each entry renders `hookKind` + `toolName` chips next to the
 * line. The provenance source is the optional `snapshot.provenance` map
 * (added in Phase 4.1 / 4.5); when omitted (older sidecars) the toggle
 * is still rendered but the chips simply do not appear.
 */
export function MemoryPanel({ snapshot, onForget }: MemoryPanelProps): JSX.Element {
  const [showProvenance, setShowProvenance] = useState(false);

  if (!snapshot) {
    return (
      <section data-testid="memory-panel" aria-label="Memory panel">
        <p style={{ color: "var(--fg-muted)" }}>Loading memory snapshot...</p>
      </section>
    );
  }
  const { layers, anticipated, proposedSkills, provenance } = snapshot;
  const provFor = (
    layerKey: string,
  ): ReadonlyArray<MemoryEntryProvenanceT | null> | undefined =>
    provenance?.[layerKey];

  return (
    <section data-testid="memory-panel" aria-label="Memory panel">
      <h2 style={{ marginTop: 0 }}>Memory</h2>
      <label
        data-testid="memory-show-provenance-toggle"
        style={{
          display: "inline-flex",
          gap: "var(--space-2)",
          alignItems: "center",
          marginBottom: "var(--space-2)",
          fontSize: "0.875rem",
          color: "var(--fg-muted)",
        }}
      >
        <input
          type="checkbox"
          checked={showProvenance}
          onChange={(e) => setShowProvenance(e.target.checked)}
          aria-label="Show provenance"
        />
        Show provenance
      </label>
      <MemoryLayer
        name="Core"
        layerKey="core"
        entries={layers.core}
        provenance={showProvenance ? provFor("core") : undefined}
        onForget={onForget}
      />
      <MemoryLayer
        name="Recent"
        layerKey="recent"
        entries={layers.recent}
        provenance={showProvenance ? provFor("recent") : undefined}
        onForget={onForget}
      />
      <MemoryLayer
        name="Working"
        layerKey="working"
        entries={layers.working}
        provenance={showProvenance ? provFor("working") : undefined}
        onForget={onForget}
      />
      <MemoryLayer
        name="Project"
        layerKey="project"
        entries={layers.project}
        provenance={showProvenance ? provFor("project") : undefined}
        onForget={onForget}
      />
      <MemoryLayer
        name="Anticipated"
        layerKey="anticipated"
        entries={anticipated}
        provenance={showProvenance ? provFor("anticipated") : undefined}
        dataTestId="memory-anticipated"
        onForget={onForget}
      />
      <MemoryLayer
        name="Proposed skills"
        layerKey="proposedSkills"
        entries={proposedSkills}
        provenance={showProvenance ? provFor("proposedSkills") : undefined}
        dataTestId="memory-proposed-skills"
        onForget={onForget}
      />
    </section>
  );
}

interface MemoryLayerProps {
  name: string;
  layerKey: string;
  entries: readonly string[];
  provenance?: ReadonlyArray<MemoryEntryProvenanceT | null>;
  dataTestId?: string;
  onForget?: (layerKey: string, index: number, entry: string) => void;
}

function MemoryLayer({
  name,
  layerKey,
  entries,
  provenance,
  dataTestId,
  onForget,
}: MemoryLayerProps): JSX.Element {
  return (
    <div data-testid={dataTestId} style={{ marginBottom: "var(--space-3)" }}>
      <h3 style={{ margin: "var(--space-2) 0" }}>{name}</h3>
      {entries.length === 0 ? (
        <p style={{ color: "var(--fg-muted)", margin: 0 }}>(empty)</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: "var(--space-4)" }}>
          {entries.map((entry, i) => {
            const prov = provenance?.[i] ?? null;
            return (
              <li key={`${layerKey}-${i}`}>
                <span>{entry}</span>
                {prov ? <ProvenanceChips provenance={prov} /> : null}
                {onForget ? (
                  <button
                    type="button"
                    data-testid={`memory-forget-${layerKey}-${i}`}
                    onClick={() => onForget(layerKey, i, entry)}
                    style={{
                      marginLeft: "var(--space-2)",
                      padding: "0 var(--space-1)",
                      border: "1px solid var(--border-1)",
                      borderRadius: "4px",
                      background: "transparent",
                      color: "var(--fg-muted)",
                      cursor: "pointer",
                      fontSize: "0.7rem",
                    }}
                    aria-label={`Forget ${name} entry ${i + 1}`}
                  >
                    Forget
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface ProvenanceChipsProps {
  provenance: MemoryEntryProvenanceT;
}

function ProvenanceChips({ provenance }: ProvenanceChipsProps): JSX.Element {
  const chipStyle: React.CSSProperties = {
    display: "inline-block",
    marginLeft: "var(--space-2)",
    padding: "0 var(--space-1)",
    border: "1px solid var(--border-1)",
    borderRadius: "4px",
    fontFamily: "var(--font-mono)",
    fontSize: "0.7rem",
    color: "var(--fg-muted)",
    background: "var(--bg-subtle, transparent)",
  };
  return (
    <>
      <span data-testid="memory-provenance-hookKind" style={chipStyle}>
        {provenance.hookKind}
      </span>
      {provenance.toolName ? (
        <span data-testid="memory-provenance-toolName" style={chipStyle}>
          {provenance.toolName}
        </span>
      ) : null}
    </>
  );
}
