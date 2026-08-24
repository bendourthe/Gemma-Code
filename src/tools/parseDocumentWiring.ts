/**
 * v1.20.0 Phase 1 (A1) -- composition-root helper for `parse_document`.
 *
 * `ChatPanelBootstrap` and tests share this so flag-off keeps the tool absent,
 * flag-on registers it, and memory ingest is constructed only when both flags
 * and a MemoryStore are present. The parser is lazy: Python is not spawned
 * until the first confirmed parse.
 */

import { createHeadlessOcrParser } from "../../core/documents/headlessOcrParser.js";
import { createOcrRuntimeBundle } from "../../core/documents/ocrRuntimeFactory.js";
import {
  createDocumentMemoryIngestor,
  type MemoryWriter,
} from "./handlers/documentMemoryIngestor.js";
import type { DocumentParser, ParseDocumentDeps } from "./handlers/parseDocument.js";

export interface BuildParseDocumentDepsOptions {
  readonly parseDocumentEnabled: boolean;
  readonly parseDocumentMemoryIngestEnabled: boolean;
  readonly memoryStore?: MemoryWriter | null;
  readonly sessionId?: string | (() => string | null | undefined);
  /** Tests inject a stub. Production builds an OCR-runtime adapter. */
  readonly createParser?: () => DocumentParser | Promise<DocumentParser>;
}

function createExtensionDocumentParser(): DocumentParser {
  const bundle = createOcrRuntimeBundle();
  const inner = createHeadlessOcrParser(bundle.parser);
  return {
    async parse(documentBase64, opts) {
      try {
        return await inner.parse(documentBase64, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/ENOENT|spawn|not found|EACCES|unavailable|ECONN/i.test(message)) {
          throw new Error(
            "Document runtime unavailable. Install RapidOCR from Settings > Models.",
          );
        }
        throw err;
      }
    },
  };
}

/**
 * Return registry deps when parse is enabled; otherwise undefined so
 * `buildToolRegistry` never registers a dangling tool or ingestor.
 */
export function buildParseDocumentDeps(
  opts: BuildParseDocumentDepsOptions,
): ParseDocumentDeps | undefined {
  if (!opts.parseDocumentEnabled) return undefined;

  let cached: DocumentParser | undefined;
  const resolveParser = async (): Promise<DocumentParser> => {
    if (opts.createParser) return opts.createParser();
    if (!cached) cached = createExtensionDocumentParser();
    return cached;
  };

  const ingestOn =
    opts.parseDocumentMemoryIngestEnabled === true && opts.memoryStore != null;
  const ingestToMemory = ingestOn
    ? createDocumentMemoryIngestor({
        store: opts.memoryStore as MemoryWriter,
        enabled: true,
        sessionId: opts.sessionId,
      })
    : undefined;

  return { resolveParser, ingestToMemory };
}
