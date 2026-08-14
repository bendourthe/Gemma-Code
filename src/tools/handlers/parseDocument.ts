/**
 * v1.16.0 Phase 4 (adoption item A6) -- the `parse_document` agent tool.
 *
 * Turns a workspace PDF or image into text the agent can reason over, by
 * handing it to the Phase 3 document-OCR runtime. Its whole reason for existing
 * is that OCR output is UNTRUSTED external content -- an attacker who can put a
 * PDF in the workspace would otherwise get text straight into the model's
 * context -- so the tool sits behind four controls:
 *
 *   1. **Secret-path denylist** (+ `allow_secrets` and a confirmation prompt),
 *      identical to `read_file`. A `.env` is not parseable by accident.
 *   2. **`pathGuard.resolveInsideWorkspace`**, symlink-aware, so a crafted path
 *      or symlink cannot read outside the workspace root.
 *   3. **`redactSecrets`** over the extracted text, because a scanned document
 *      can contain a key just as easily as a source file can. This is a NEW
 *      redaction point: tool output going into the conversation was not
 *      previously redacted anywhere.
 *   4. **The inbound content classifier**, applied by `AgentLoop` because
 *      `parse_document` joins `INBOUND_EXTERNAL_DATA_TOOLS` -- the same gate
 *      `fetch_page` and `web_search` pass through.
 *
 * The runtime is reached through an injected resolver seam rather than a
 * concrete client, matching `lsp.ts`. That keeps `src/tools/` free of any
 * dependency on the desktop sidecar (which the extension host cannot reach) and
 * lets each host supply its own parser: the sidecar injects its in-process
 * manager, the extension injects one that spawns the Python runtime itself.
 */

import * as vscode from "vscode";
import type { ConfirmationGate } from "../ConfirmationGate.js";
import type { ToolHandler, ToolResult } from "../types.js";
import { matchesSecretPath } from "../../../modules/coding/utils/secretPaths.js";
import { redactSecrets } from "../../../core/observability/redactSecrets.js";
import { resolveInsideWorkspace, workspaceRoot } from "./pathGuard.js";

/** What the tool needs back from a parse. Mirrors `OcrParseResult` in core. */
export interface ParsedDocumentResult {
  readonly engine: string;
  readonly text: string;
  readonly markdown: string | null;
  readonly pageCount: number;
}

/**
 * The host-supplied parser. Deliberately takes base64 rather than a path: the
 * TOOL owns path resolution and the guards, so a parser implementation can
 * never be handed an unvalidated path.
 */
export interface DocumentParser {
  parse(
    documentBase64: string,
    opts?: { readonly maxPages?: number },
  ): Promise<ParsedDocumentResult>;
}

export interface ParseDocumentDeps {
  readonly resolveParser: () => Promise<DocumentParser> | DocumentParser;
  /** Optional opt-in memory ingestion (v1.16.0 Phase 4.2). Off unless wired. */
  readonly ingestToMemory?: DocumentMemoryIngestor;
}

/** Opt-in sink that stores parsed text as a memory observation. */
export interface DocumentMemoryIngestor {
  ingest(args: {
    readonly text: string;
    readonly sourcePath: string;
    readonly engine: string;
  }): Promise<{ readonly stored: boolean; readonly reason?: string }>;
}

export interface ParseDocumentParams {
  path: string;
  allow_secrets?: boolean;
  max_pages?: number;
}

/** Upper bound on pages per call, so one tool call cannot burn the context. */
export const PARSE_DOCUMENT_MAX_PAGES = 50;

function failResult(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

export class ParseDocumentTool implements ToolHandler {
  constructor(
    private readonly _deps: ParseDocumentDeps,
    private readonly _confirmationGate: ConfirmationGate | null = null,
    private readonly _extraSecretPatterns: readonly string[] = [],
    private readonly _rootOverride: string | null = null,
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as ParseDocumentParams;

    if (!p.path || typeof p.path !== "string") {
      return failResult(
        id,
        "Missing required parameter: path. " +
          "Usage: parse_document(path=<workspace-relative PDF or image>). " +
          "Example: parse_document(path='docs/invoice.pdf').",
      );
    }

    if (p.max_pages !== undefined) {
      if (typeof p.max_pages !== "number" || !Number.isInteger(p.max_pages) || p.max_pages < 1) {
        return failResult(
          id,
          "Invalid max_pages: must be a positive integer. " +
            `Usage: parse_document(path, max_pages=<1..${PARSE_DOCUMENT_MAX_PAGES}>).`,
        );
      }
    }
    const maxPages = Math.min(p.max_pages ?? PARSE_DOCUMENT_MAX_PAGES, PARSE_DOCUMENT_MAX_PAGES);

    // Guard 1: the secret-path denylist, before any I/O.
    if (matchesSecretPath(p.path, this._extraSecretPatterns)) {
      if (p.allow_secrets !== true) {
        return failResult(
          id,
          `Path "${p.path}" matches the secret-path denylist. ` +
            `Usage: pass allow_secrets=true to request explicit user confirmation, or parse a non-secret path.`,
        );
      }
      if (this._confirmationGate) {
        const approved = await this._confirmationGate.request(
          id,
          `Parse secret-path file "${p.path}"?`,
          "The path matches the secret-path denylist (env/keys/credentials). Only approve if you trust this file.",
        );
        if (!approved) {
          return failResult(
            id,
            `Parse of secret-path file "${p.path}" rejected by user. ` +
              `Usage: parse_document(path=<non-secret path>) or retry with explicit user approval.`,
          );
        }
      }
    }

    // Guard 2: resolve inside the workspace, symlink-aware.
    let absolute: string;
    try {
      absolute = resolveInsideWorkspace(p.path, this._rootOverride ?? workspaceRoot());
    } catch (err) {
      return failResult(
        id,
        `${(err as Error).message} ` +
          `Usage: parse_document(path=<workspace-relative path inside the project root>).`,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolute));
    } catch {
      return failResult(
        id,
        `File not found or unreadable at path "${p.path}". ` +
          `Usage: parse_document(path=<existing workspace-relative PDF or image>).`,
      );
    }

    let parsed: ParsedDocumentResult;
    try {
      const parser = await Promise.resolve(this._deps.resolveParser());
      parsed = await parser.parse(Buffer.from(bytes).toString("base64"), { maxPages });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failResult(
        id,
        `Could not parse "${p.path}": ${message} ` +
          `A document model must be installed (Settings > Models) and the document runtime available.`,
      );
    }

    const body = (parsed.markdown ?? parsed.text) || "";
    if (body.trim().length === 0) {
      return {
        id,
        success: true,
        output:
          `Parsed "${p.path}" with ${parsed.engine} (${parsed.pageCount} page(s)) but found no text. ` +
          `The document may be blank, or an image-only scan the installed engine could not read.`,
      };
    }

    // Guard 3: redact secrets before the text reaches the conversation. A
    // scanned document can carry a key exactly like a source file can.
    const safe = redactSecrets(body);

    // Guard 4 (`AgentLoop`, via INBOUND_EXTERNAL_DATA_TOOLS) annotates this
    // output as untrusted when the classifier flags injection markers.
    let memoryNote = "";
    if (this._deps.ingestToMemory) {
      try {
        const outcome = await this._deps.ingestToMemory.ingest({
          text: safe,
          sourcePath: p.path,
          engine: parsed.engine,
        });
        memoryNote = outcome.stored
          ? "\n\n[stored in memory]"
          : outcome.reason
            ? `\n\n[not stored in memory: ${outcome.reason}]`
            : "";
      } catch (err) {
        // Ingestion is best-effort: a memory failure must not fail the parse.
        memoryNote = `\n\n[not stored in memory: ${
          err instanceof Error ? err.message : String(err)
        }]`;
      }
    }

    return {
      id,
      success: true,
      output:
        `Parsed "${p.path}" with ${parsed.engine} (${parsed.pageCount} page(s)):\n\n` +
        safe +
        memoryNote,
    };
  }
}
