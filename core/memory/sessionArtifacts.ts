/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- session-message
 * dehydration / hydration.
 *
 * Walks a persisted session's message list and moves large fields out-of-line
 * into the content-addressed {@link ArtifactStore}, replacing the inline value
 * with a compact `{ artifact_ref, preview, kind }` marker. On load / resume
 * the markers are rehydrated back to their full content.
 *
 * MAPPING NOTE (kept explicit for reviewers): the v1.6.0 plan prompt describes
 * dehydrating "the stdout / stderr / diff / patch / content fields above a
 * configurable byte threshold". The Coding-pillar session store persists each
 * turn as an opaque message string (`messages: string[]`), not a structured
 * record with named fields, so dehydration operates at whole-message
 * granularity above the byte threshold -- which is exactly what the source
 * comparison (Section 3.5) describes: "large message fields (>20KB) are
 * dehydrated to an artifact store and rehydrated on load". The `kind` of each
 * dehydrated payload is inferred from its content (diff / patch / stdout-ish /
 * stderr-ish, defaulting to `content`) so the marker still carries the
 * field-classification the plan calls for.
 *
 * Both the out-of-line artifact AND the inline preview are redacted: the
 * artifact via {@link ArtifactStore.put}, the preview here, so no secret is
 * persisted in either place.
 */

import { redactSecrets } from "../observability/redactSecrets.js";
import type { ArtifactStore } from "./ArtifactStore.js";

/** Inferred classification of a dehydrated payload. */
export type ArtifactKind = "stdout" | "stderr" | "diff" | "patch" | "content";

/**
 * The inline marker that replaces a dehydrated message field. Shaped to match
 * the plan's `{ artifact_ref, preview, kind }` contract; `nexusArtifact`
 * is a schema discriminant + version so the hydrate path can distinguish a
 * marker from an ordinary (already-hydrated) message string.
 */
export interface DehydratedArtifact {
  /** Schema discriminant + version. */
  readonly nexusArtifact: 1;
  /** Content-addressed key into the {@link ArtifactStore}. */
  readonly artifact_ref: string;
  /** Redacted, whitespace-collapsed, truncated preview for at-a-glance UIs. */
  readonly preview: string;
  /** Inferred field classification. */
  readonly kind: ArtifactKind;
  /** Byte length of the dehydrated (redacted) payload, for size accounting. */
  readonly bytes: number;
}

/** A message as persisted on disk: either inline text or a dehydration marker. */
export type PersistedMessage = string | DehydratedArtifact;

/** Default dehydration threshold: fields larger than this are moved out-of-line. */
export const DEFAULT_DEHYDRATION_THRESHOLD_BYTES = 20 * 1024;

/** Max characters retained in a marker preview. */
const PREVIEW_CHARS = 200;

export interface DehydrateOptions {
  /** Byte threshold above which a message is dehydrated. Defaults to 20KB. */
  readonly thresholdBytes?: number;
}

/** Narrow an unknown disk value to a {@link DehydratedArtifact} marker. */
export function isDehydratedArtifact(value: unknown): value is DehydratedArtifact {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["nexusArtifact"] === 1 &&
    typeof v["artifact_ref"] === "string" &&
    typeof v["preview"] === "string" &&
    typeof v["kind"] === "string"
  );
}

/**
 * Infer the {@link ArtifactKind} of a payload from its content. Best-effort and
 * conservative: only the unambiguous diff / patch signatures are matched;
 * everything else falls back to `content`.
 */
export function classifyKind(text: string): ArtifactKind {
  // A git-format-patch / `git diff` body starts with a `diff --git` header.
  if (/^diff --git /m.test(text)) return "patch";
  // A unified diff (no git header) has hunk markers and +++/--- file lines.
  if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text) || /^--- .+\n\+\+\+ /m.test(text)) {
    return "diff";
  }
  // Heuristic stderr signal: lines that look like errors / stack traces.
  if (/^(?:error|fatal|traceback|exception)\b/im.test(text) || /^\s+at .+\(.+:\d+:\d+\)$/m.test(text)) {
    return "stderr";
  }
  return "content";
}

/** Build a redacted, single-line, truncated preview of `text`. */
function buildPreview(text: string): string {
  const collapsed = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (collapsed.length <= PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, PREVIEW_CHARS)}...`;
}

/**
 * Dehydrate `messages` for persistence: any string larger than the threshold
 * is written to `store` and replaced with a {@link DehydratedArtifact} marker.
 * Smaller strings pass through unchanged. Markers already present (a re-save of
 * an already-dehydrated session) pass through untouched, so the operation is
 * idempotent.
 */
export function dehydrateMessages(
  messages: readonly PersistedMessage[],
  store: ArtifactStore,
  opts: DehydrateOptions = {},
): PersistedMessage[] {
  const threshold = opts.thresholdBytes ?? DEFAULT_DEHYDRATION_THRESHOLD_BYTES;
  return messages.map((msg) => {
    if (isDehydratedArtifact(msg)) return msg;
    if (typeof msg !== "string") return msg;
    if (Buffer.byteLength(msg, "utf8") <= threshold) return msg;
    const { ref, bytes } = store.put(msg);
    const marker: DehydratedArtifact = {
      nexusArtifact: 1,
      artifact_ref: ref,
      preview: buildPreview(msg),
      kind: classifyKind(msg),
      bytes,
    };
    return marker;
  });
}

/**
 * Hydrate `messages` after load: each {@link DehydratedArtifact} marker is
 * resolved back to its full (redacted) content from `store`. A missing artifact
 * degrades to the inline preview rather than throwing, so a pruned or
 * hand-deleted artifact never breaks session resume. Ordinary strings (the
 * pre-migration shape) pass through unchanged, which is the tolerant read path
 * for sessions persisted before this change.
 */
export function hydrateMessages(
  messages: readonly PersistedMessage[],
  store: ArtifactStore,
): string[] {
  return messages.map((msg) => {
    if (isDehydratedArtifact(msg)) {
      return store.get(msg.artifact_ref) ?? msg.preview;
    }
    return typeof msg === "string" ? msg : String(msg);
  });
}
