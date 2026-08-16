/**
 * v1.16.0 Phase 4.2 (adoption item A6) -- opt-in memory ingestion for parsed
 * documents.
 *
 * Turns a `parse_document` result into a memory observation, so a document a
 * user parsed once stays available to later turns. Everything about this path is
 * conservative, because it moves UNTRUSTED text into durable storage:
 *
 *   * **Off by default.** Mirrors `nexus.memory.consolidation.enabled` /
 *     `compression.enabled`: the flag is a constructor option and the class
 *     short-circuits on its first line, so nothing is written -- and no work is
 *     done -- when it is false.
 *   * **Injection rejection is EXPECTED, not exceptional.** `MemoryStore.save`
 *     throws when its scanner finds injection markers. OCR text from a hostile
 *     or merely noisy document trips that routinely, so a rejection is reported
 *     as a normal "not stored" outcome with a reason, never surfaced as a tool
 *     failure. The parse still succeeds; only the storage is declined.
 *   * **Redaction happens twice, deliberately.** The tool redacts before the
 *     text reaches the model, and `MemoryStore.save` redacts again before the
 *     row hits SQLite. The second pass is not dead code: it guarantees the
 *     invariant at the storage boundary regardless of who calls it.
 *   * **Provenance is mandatory.** Every row records that it came from OCR, via
 *     which engine, and from which file, so a later reader can tell a parsed
 *     document apart from something the user actually said.
 *
 * RETAINED, NOT DEAD (v1.16.0 Phase 6 refactor triage): no host constructs
 * `createDocumentMemoryIngestor`, so `nexus.coding.parseDocument.memoryIngest.enabled`
 * has no effect yet (known gap LSO.P4.C). It hangs off the same composition-root
 * wiring as LSO.P4.B. Delete only if that gap is closed as won't-do.
 */

import type { LifecycleProvenance } from "../../../core/memory/types.js";
import type { DocumentMemoryIngestor } from "./parseDocument.js";

/** The subset of `MemoryStore` this ingestor needs. */
export interface MemoryWriter {
  save(
    content: string,
    type: "fact",
    sessionId?: string,
    options?: { readonly provenance?: LifecycleProvenance | null },
  ): Promise<unknown>;
}

export interface DocumentMemoryIngestorOptions {
  readonly store: MemoryWriter;
  /** `nexus.coding.parseDocument.memoryIngest.enabled`. Default false. */
  readonly enabled?: boolean;
  readonly sessionId?: string;
  /** Cap on stored characters; a 200-page parse must not become one huge row. */
  readonly maxChars?: number;
}

export const DEFAULT_MEMORY_INGEST_MAX_CHARS = 8_000;

export function createDocumentMemoryIngestor(
  opts: DocumentMemoryIngestorOptions,
): DocumentMemoryIngestor {
  const enabled = opts.enabled === true;
  const maxChars = opts.maxChars ?? DEFAULT_MEMORY_INGEST_MAX_CHARS;

  return {
    async ingest({ text, sourcePath, engine }) {
      if (!enabled) {
        return {
          stored: false,
          reason: "nexus.coding.parseDocument.memoryIngest.enabled is false",
        };
      }
      const body = text.trim();
      if (body.length === 0) {
        return { stored: false, reason: "no text to store" };
      }

      const truncated = body.length > maxChars;
      const stored = truncated ? `${body.slice(0, maxChars)}\n[truncated]` : body;
      // Provenance is part of the CONTENT as well as the metadata: a reader
      // scanning raw memory text should be able to see this came from a parsed
      // document without having to join against the provenance column.
      const observation =
        `Parsed document "${sourcePath}" (via ${engine}):\n\n${stored}`;

      const provenance: LifecycleProvenance = {
        sessionId: opts.sessionId ?? "",
        hookKind: "lifecycle.tool.post",
        toolName: "parse_document",
      };

      try {
        await opts.store.save(observation, "fact", opts.sessionId, { provenance });
        return { stored: true };
      } catch (err) {
        // The store rejects content whose injection scanner fires. That is an
        // expected outcome for untrusted OCR text, so it is reported plainly.
        const message = err instanceof Error ? err.message : String(err);
        return {
          stored: false,
          reason: message.includes("prompt-injection")
            ? "the memory store rejected the text (prompt-injection markers)"
            : message,
        };
      }
    },
  };
}
