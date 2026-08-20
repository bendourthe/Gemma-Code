/**
 * v1.20.0 Phase 1 (A1) -- bytes-in parser over `OcrParseManager`.
 *
 * The `parse_document` tool (VS Code and headless) owns path resolution. This
 * adapter only ever sees base64, starts a job, and drains it to a terminal
 * result. A second overlapping call is rejected (not queued) so two `parse`
 * RPCs cannot interleave on the Python child's synchronous stdin loop.
 */

import type { OcrParseManager, OcrParseResult } from "./OcrParseManager.js";

/** What both `HeadlessDocumentParser` and `DocumentParser` need back. */
export interface BytesDocumentParser {
  parse(
    documentBase64: string,
    opts?: { readonly maxPages?: number },
  ): Promise<{
    readonly engine: string;
    readonly text: string;
    readonly markdown: string | null;
    readonly pageCount: number;
  }>;
}

export const DOCUMENT_PARSER_BUSY =
  "document parser is busy: a previous parse is still running";

export interface HeadlessOcrParserOptions {
  /** Drain poll cadence. Tests pass 0 so the event loop yields without sleeping. */
  readonly pollMs?: number;
}

const DEFAULT_POLL_MS = 50;

async function waitForJob(
  manager: OcrParseManager,
  jobId: string,
  pollMs: number,
): Promise<OcrParseResult> {
  for (;;) {
    const drained = manager.drain(jobId);
    const err = drained.events.find((e) => e.kind === "error");
    if (err) {
      throw new Error(err.message ?? "document parse failed");
    }
    if (drained.done) {
      if (!drained.result) {
        throw new Error("document parse produced no result");
      }
      return drained.result;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
}

/**
 * Wrap an `OcrParseManager` as a bytes-in parser. The Python child (or the
 * in-memory stub) is reached only through the manager; no filesystem path is
 * forwarded.
 */
export function createHeadlessOcrParser(
  manager: OcrParseManager,
  options: HeadlessOcrParserOptions = {},
): BytesDocumentParser {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  let inflight = false;

  return {
    async parse(documentBase64, opts) {
      if (!documentBase64) {
        throw new Error("invalid-params: documentBase64 is required");
      }
      if (inflight) {
        throw new Error(DOCUMENT_PARSER_BUSY);
      }
      inflight = true;
      try {
        const jobId = manager.start({
          documentBase64,
          maxPages: opts?.maxPages,
        });
        const result = await waitForJob(manager, jobId, pollMs);
        return {
          engine: result.engine,
          text: result.text,
          markdown: result.markdown,
          pageCount: result.pageCount,
        };
      } finally {
        inflight = false;
      }
    },
  };
}
