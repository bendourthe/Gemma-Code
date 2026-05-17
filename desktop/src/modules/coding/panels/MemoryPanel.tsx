import type { MemorySnapshotT } from "../../../../sidecar/src/protocol";

export interface MemoryPanelProps {
  snapshot: MemorySnapshotT | null;
}

export function MemoryPanel({ snapshot }: MemoryPanelProps): JSX.Element {
  if (!snapshot) {
    return (
      <section data-testid="memory-panel" aria-label="Memory panel">
        <p style={{ color: "var(--fg-muted)" }}>Loading memory snapshot...</p>
      </section>
    );
  }
  const { layers, anticipated, proposedSkills } = snapshot;
  return (
    <section data-testid="memory-panel" aria-label="Memory panel">
      <h2 style={{ marginTop: 0 }}>Memory</h2>
      <MemoryLayer name="Core" entries={layers.core} />
      <MemoryLayer name="Recent" entries={layers.recent} />
      <MemoryLayer name="Working" entries={layers.working} />
      <MemoryLayer name="Project" entries={layers.project} />
      <MemoryLayer name="Anticipated" entries={anticipated} dataTestId="memory-anticipated" />
      <MemoryLayer name="Proposed skills" entries={proposedSkills} dataTestId="memory-proposed-skills" />
    </section>
  );
}

interface MemoryLayerProps {
  name: string;
  entries: readonly string[];
  dataTestId?: string;
}

function MemoryLayer({ name, entries, dataTestId }: MemoryLayerProps): JSX.Element {
  return (
    <div data-testid={dataTestId} style={{ marginBottom: "var(--space-3)" }}>
      <h3 style={{ margin: "var(--space-2) 0" }}>{name}</h3>
      {entries.length === 0 ? (
        <p style={{ color: "var(--fg-muted)", margin: 0 }}>(empty)</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: "var(--space-4)" }}>
          {entries.map((entry, i) => (
            <li key={`${name}-${i}`}>{entry}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
