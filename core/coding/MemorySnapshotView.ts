/**
 * v1.1.0 Phase 11.4 -- shared Memory-panel snapshot projector.
 *
 * The extension's memory webview and the desktop's `MemoryPanel` render the
 * same underlying snapshot shape produced by the daemon's
 * `coding.memory.snapshot` IPC. To make sure the two surfaces stay in lock
 * step (and so Phase 11.9 parity tests can assert byte-equal rendering of
 * the four-layer view), the row-level projection is centralised here.
 */

export type MemoryLayerKey = "core" | "recent" | "working" | "project";

export interface MemoryProvenanceInput {
  readonly hookKind: string;
  readonly toolName?: string;
  readonly sessionId?: string;
}

export interface MemorySnapshotInput {
  readonly layers: Readonly<Record<MemoryLayerKey, readonly string[]>>;
  readonly anticipated: readonly string[];
  readonly proposedSkills: readonly string[];
  readonly provenance?: Readonly<
    Record<string, readonly (MemoryProvenanceInput | null)[]>
  >;
}

export interface MemoryRowView {
  readonly layer: MemoryLayerKey;
  readonly index: number;
  readonly entry: string;
  readonly hookKind: string | null;
  readonly toolName: string | null;
  readonly sessionId: string | null;
}

export interface MemorySnapshotView {
  readonly rows: readonly MemoryRowView[];
  readonly anticipated: readonly string[];
  readonly proposedSkills: readonly string[];
  readonly hookKinds: readonly string[];
  readonly toolNames: readonly string[];
}

const LAYER_ORDER: readonly MemoryLayerKey[] = Object.freeze([
  "core",
  "recent",
  "working",
  "project",
]);

function readProvenanceFor(
  snapshot: MemorySnapshotInput,
  layer: MemoryLayerKey,
  index: number,
): MemoryProvenanceInput | null {
  const map = snapshot.provenance;
  if (!map) return null;
  const arr = map[layer];
  if (!arr) return null;
  const at = arr[index];
  return at ?? null;
}

/**
 * Project a daemon-supplied snapshot into the flat row list the panel
 * renders, plus distinct hookKind / toolName lists used by filter chips.
 *
 * The projection is deterministic and stable: same input -> same output
 * (Object identity and field order included). The Phase 11.9 parity tests
 * assert that desktop + extension consume the same view.
 */
export function projectMemorySnapshotView(
  snapshot: MemorySnapshotInput,
): MemorySnapshotView {
  const rows: MemoryRowView[] = [];
  const hookKindSet = new Set<string>();
  const toolNameSet = new Set<string>();

  for (const layer of LAYER_ORDER) {
    const entries = snapshot.layers[layer];
    if (!entries) continue;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i] ?? "";
      const provenance = readProvenanceFor(snapshot, layer, i);
      const hookKind = provenance?.hookKind ?? null;
      const toolName = provenance?.toolName ?? null;
      if (hookKind) hookKindSet.add(hookKind);
      if (toolName) toolNameSet.add(toolName);
      rows.push(
        Object.freeze({
          layer,
          index: i,
          entry,
          hookKind,
          toolName,
          sessionId: provenance?.sessionId ?? null,
        }),
      );
    }
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    anticipated: Object.freeze([...snapshot.anticipated]),
    proposedSkills: Object.freeze([...snapshot.proposedSkills]),
    hookKinds: Object.freeze([...hookKindSet].sort()),
    toolNames: Object.freeze([...toolNameSet].sort()),
  });
}

/** Filter helper for the "Show provenance" toggle off the daemon side. */
export function filterMemoryRowsByHookKind(
  rows: readonly MemoryRowView[],
  hookKind: string | null,
): readonly MemoryRowView[] {
  if (!hookKind || hookKind === "(all)") return rows;
  return rows.filter((r) => r.hookKind === hookKind);
}
