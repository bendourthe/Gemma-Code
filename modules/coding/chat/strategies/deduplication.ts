import type { Message } from "../types.js";
import { parseToolCalls } from "../../../../src/tools/Gemma4ToolFormat.js";

/**
 * v0.7.0 Phase 3 sub-task 3.1 -- Deduplication compaction strategy (C13).
 *
 * Walks the conversation newest-to-oldest and replaces older tool-result
 * payloads whose `(toolName, canonicalizedArgs)` signature collides with a
 * more-recent tool call. The result content is rewritten to a one-line
 * placeholder pointing at the surviving call so the model can still see that
 * the call happened, but the bulky payload is dropped.
 *
 * Skipped:
 * - tool calls whose name is in `protectedTools`,
 * - tool calls whose args contain a path that matches `protectedFilePatterns`,
 * - tool calls that errored (those are handled by `purgeErrors`).
 *
 * The strategy never mutates its input.
 */

export interface DeduplicationConfig {
  readonly protectedTools: readonly string[];
  readonly protectedFilePatterns: readonly string[];
}

const TOOL_RESULT_BLOCK_RE = /<\|tool_result>\n([\s\S]*?)\n<tool_result\|>/;
const TOOL_RESULT_BLOCK_GLOBAL_RE = /<\|tool_result>\n([\s\S]*?)\n<tool_result\|>/g;

interface ParsedResult {
  readonly toolName: string;
  readonly errored: boolean;
}

/** Parse a single tool_result block payload into name + error flag. */
function parseResultPayload(content: string): ParsedResult | null {
  TOOL_RESULT_BLOCK_RE.lastIndex = 0;
  const match = TOOL_RESULT_BLOCK_RE.exec(content);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
      name?: string;
      response?: { success?: boolean };
    };
    if (typeof parsed.name !== "string") return null;
    return {
      toolName: parsed.name,
      errored: parsed.response?.success === false,
    };
  } catch {
    return null;
  }
}

/** Sort object keys recursively then JSON-stringify. Trims string values. */
function canonicalizeArgs(args: Record<string, unknown>): string {
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") {
      return typeof value === "string" ? value.trim() : value;
    }
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = visit((value as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(visit(args));
}

/**
 * Find any path-shaped string value in the args record. Supports flat strings
 * and one level of nested object/array values. Used to test against
 * `protectedFilePatterns`.
 */
function* iterArgPaths(args: Record<string, unknown>): IterableIterator<string> {
  const visit = function* (value: unknown): IterableIterator<string> {
    if (typeof value === "string") {
      yield value;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) yield* visit(item);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) yield* visit(item);
    }
  };
  yield* visit(args);
}

function matchesProtectedFile(
  args: Record<string, unknown>,
  protectedFilePatterns: readonly string[],
): boolean {
  if (protectedFilePatterns.length === 0) return false;
  for (const path of iterArgPaths(args)) {
    for (const pattern of protectedFilePatterns) {
      if (path.includes(pattern)) return true;
    }
  }
  return false;
}

/** Build a `(toolName, canonicalArgs)` signature for one tool call. */
function buildSignature(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${canonicalizeArgs(args)}`;
}

interface CallSiteRecord {
  readonly signature: string;
  readonly callMessageIndex: number;
  readonly resultMessageIndex: number;
}

/**
 * Pair every tool call in `messages` with its first matching tool_result
 * message. Returns an array of records ordered by the call message index.
 */
function findCallSites(
  messages: readonly Message[],
  config: DeduplicationConfig,
): CallSiteRecord[] {
  const records: CallSiteRecord[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role !== "assistant") continue;

    const parsed = parseToolCalls(msg.content);
    for (const result of parsed.results) {
      if (!result.ok) continue;
      const call = result.call;
      if (config.protectedTools.includes(call.tool)) continue;
      if (matchesProtectedFile(call.parameters, config.protectedFilePatterns)) continue;

      const signature = buildSignature(call.tool, call.parameters);

      // Locate the next tool-result message with a matching tool name and
      // pair it with this call. We accept any subsequent message whose
      // payload's `name` field matches; in practice agent loops emit the
      // result immediately after the call so this is robust.
      let resultIndex = -1;
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j];
        if (!next) continue;
        if (next.role === "assistant") break; // stop at next assistant turn
        const payload = parseResultPayload(next.content);
        if (!payload) continue;
        if (payload.toolName !== call.tool) continue;
        if (payload.errored) {
          // Errored results are out of scope for dedup; skip without claiming.
          break;
        }
        resultIndex = j;
        break;
      }

      if (resultIndex === -1) continue;
      records.push({
        signature,
        callMessageIndex: i,
        resultMessageIndex: resultIndex,
      });
    }
  }

  return records;
}

/**
 * Apply the deduplication compaction strategy. Pure function; never mutates
 * the input.
 */
export function deduplicate(
  messages: readonly Message[],
  config: DeduplicationConfig,
): Message[] {
  const records = findCallSites(messages, config);
  if (records.length === 0) return [...messages];

  // Walk records newest-first so each signature's most-recent occurrence wins.
  const seenBySignature = new Map<string, CallSiteRecord>();
  const toReplace = new Map<number, number>(); // resultMessageIndex -> newer resultMessageIndex

  for (let k = records.length - 1; k >= 0; k--) {
    const rec = records[k]!;
    const winner = seenBySignature.get(rec.signature);
    if (winner === undefined) {
      seenBySignature.set(rec.signature, rec);
      continue;
    }
    toReplace.set(rec.resultMessageIndex, winner.resultMessageIndex);
  }

  if (toReplace.size === 0) return [...messages];

  const out: Message[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const winnerIdx = toReplace.get(i);
    if (winnerIdx === undefined) {
      out[i] = msg;
      continue;
    }
    // Replace every tool_result block in this message with a placeholder.
    TOOL_RESULT_BLOCK_GLOBAL_RE.lastIndex = 0;
    const replaced = msg.content.replace(
      TOOL_RESULT_BLOCK_GLOBAL_RE,
      () => `[deduplicated -- see message #${winnerIdx}]`,
    );
    out[i] = { ...msg, content: replaced };
  }

  return out;
}

/** Compaction-pipeline adapter for `deduplicate`. */
import type { CompactionStrategy } from "../CompactionStrategy.js";

export class DeduplicationStrategy implements CompactionStrategy {
  readonly name = "Deduplication";

  constructor(private readonly _config: DeduplicationConfig) {}

  canApply(messages: readonly Message[]): boolean {
    const records = findCallSites(messages, this._config);
    if (records.length < 2) return false;
    const seen = new Set<string>();
    for (const rec of records) {
      if (seen.has(rec.signature)) return true;
      seen.add(rec.signature);
    }
    return false;
  }

  async apply(messages: readonly Message[]): Promise<Message[]> {
    return deduplicate(messages, this._config);
  }
}
