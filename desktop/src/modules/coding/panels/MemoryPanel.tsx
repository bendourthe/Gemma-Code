import { useState } from "react";
import type {
  MemoryEntryProvenanceT,
  MemorySnapshotT,
} from "../../../../sidecar/src/protocol";

export interface MemoryPanelProps {
  snapshot: MemorySnapshotT | null;
}

/**
 * v1.1.0 Phase 4.5 -- the Memory panel gains a "Show provenance" toggle.
 * When on, each entry renders `hookKind` + `toolName` chips next to the
 * line. The provenance source is the optional `snapshot.provenance` map
 * (added in Phase 4.1 / 4.5); when omitted (older sidecars) the toggle
 * is still rendered but the chips simply do not appear.
 */
export function MemoryPanel({ snapshot }: MemoryPanelProps): JSX.Element {
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
      />
      <MemoryLayer
        name="Recent"
        layerKey="recent"
        entries={layers.recent}
        provenance={showProvenance ? provFor("recent") : undefined}
      />
      <MemoryLayer
        name="Working"
        layerKey="working"
        entries={layers.working}
        provenance={showProvenance ? provFor("working") : undefined}
      />
      <MemoryLayer
        name="Project"
        layerKey="project"
        entries={layers.project}
        provenance={showProvenance ? provFor("project") : undefined}
      />
      <MemoryLayer
        name="Anticipated"
        layerKey="anticipated"
        entries={anticipated}
        provenance={showProvenance ? provFor("anticipated") : undefined}
        dataTestId="memory-anticipated"
      />
      <MemoryLayer
        name="Proposed skills"
        layerKey="proposedSkills"
        entries={proposedSkills}
        provenance={showProvenance ? provFor("proposedSkills") : undefined}
        dataTestId="memory-proposed-skills"
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
}

function MemoryLayer({
  name,
  layerKey,
  entries,
  provenance,
  dataTestId,
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
                {entry}
                {prov ? <ProvenanceChips provenance={prov} /> : null}
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
