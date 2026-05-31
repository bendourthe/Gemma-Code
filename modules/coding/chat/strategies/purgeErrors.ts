import type { Message } from "../types.js";
import { parseToolCalls } from "../../../../src/tools/Gemma4ToolFormat.js";
import type { CompactionStrategy } from "../CompactionStrategy.js";

/**
 * v0.7.0 Phase 3 sub-task 3.2 -- Purge-errors compaction strategy (C14).
 *
 * Drops the `args` payload of errored tool calls older than `errorPurgeTurns`
 * user-message turns. The error result message stays verbatim so the model
 * can still see the failure mode; only the bulky args of the originating
 * call are replaced with `{ purged: true, ... }` metadata.
 *
 * Skipped tools listed in `protectedTools` are NEVER purged regardless of age.
 * Pure function; never mutates its input.
 */

export interface PurgeErrorsConfig {
  readonly protectedTools: readonly string[];
  readonly errorPurgeTurns: number;
}

const TOOL_RESULT_BLOCK_RE = /<\|tool_result>\n([\s\S]*?)\n<tool_result\|>/;
const TOOL_CALL_BLOCK_RE = /<\|tool_call>call:([\w:/-]+)\{([\s\S]*?)\}<tool_call\|>/g;

interface ParsedResult {
  readonly toolName: string;
  readonly errored: boolean;
}

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

/**
 * Count user-message turns that occur strictly after `index` in `messages`.
 * Used to determine whether an errored tool call is "old enough" to purge.
 */
function userTurnsAfter(messages: readonly Message[], index: number): number {
  let count = 0;
  for (let i = index + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m && m.role === "user") count += 1;
  }
  return count;
}

interface ErroredCallSite {
  readonly toolName: string;
  readonly callMessageIndex: number;
  /** Span within `messages[callMessageIndex].content` matching the tool_call block. */
  readonly blockStart: number;
  readonly blockEnd: number;
  /** Original args byte length (used for the `originalSize` metadata). */
  readonly originalSize: number;
  /** Number of user turns elapsed since this call's tool_result. */
  readonly turnsAgo: number;
}

/**
 * Find every errored tool call in `messages` and return its source span and
 * an `turnsAgo` count measured against the assistant call message index.
 */
function findErroredCallSites(
  messages: readonly Message[],
  config: PurgeErrorsConfig,
): ErroredCallSite[] {
  const records: ErroredCallSite[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role !== "assistant") continue;

    const parsed = parseToolCalls(msg.content);
    if (!parsed.hasAny) continue;

    // Re-scan with the block regex to recover the byte spans of each call;
    // `parseToolCalls` does not return spans.
    TOOL_CALL_BLOCK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOOL_CALL_BLOCK_RE.exec(msg.content)) !== null) {
      const toolName = match[1] ?? "";
      const blockStart = match.index;
      const blockEnd = match.index + match[0].length;
      if (config.protectedTools.includes(toolName)) continue;

      // Find the matching tool_result message.
      let errored = false;
      let foundResult = false;
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j];
        if (!next) continue;
        if (next.role === "assistant") break;
        const payload = parseResultPayload(next.content);
        if (!payload) continue;
        if (payload.toolName !== toolName) continue;
        foundResult = true;
        errored = payload.errored;
        break;
      }
      if (!foundResult || !errored) continue;

      records.push({
        toolName,
        callMessageIndex: i,
        blockStart,
        blockEnd,
        originalSize: blockEnd - blockStart,
        turnsAgo: userTurnsAfter(messages, i),
      });
    }
  }

  return records;
}

/** Apply the purge-errors strategy. Returns a new array; never mutates input. */
export function purgeErrors(
  messages: readonly Message[],
  config: PurgeErrorsConfig,
): Message[] {
  if (config.errorPurgeTurns <= 0) return [...messages];

  const sites = findErroredCallSites(messages, config);
  if (sites.length === 0) return [...messages];

  const sitesToPurge = sites.filter((s) => s.turnsAgo >= config.errorPurgeTurns);
  if (sitesToPurge.length === 0) return [...messages];

  // Group purges by message index so a single message rewrite handles all
  // calls in that message in one pass.
  const byMessage = new Map<number, ErroredCallSite[]>();
  for (const site of sitesToPurge) {
    const arr = byMessage.get(site.callMessageIndex) ?? [];
    arr.push(site);
    byMessage.set(site.callMessageIndex, arr);
  }

  const out: Message[] = messages.slice();
  for (const [idx, siteList] of byMessage) {
    const original = messages[idx];
    if (!original) continue;
    // Replace from the rightmost site so earlier indices remain valid.
    const sortedDesc = siteList.slice().sort((a, b) => b.blockStart - a.blockStart);
    let content = original.content;
    for (const site of sortedDesc) {
      const replacement =
        `<|tool_call>call:${site.toolName}{` +
        `purged:<|"|>true<|"|>,` +
        `purgedAt:${site.turnsAgo},` +
        `originalSize:${site.originalSize}` +
        `}<tool_call|>`;
      content = content.slice(0, site.blockStart) + replacement + content.slice(site.blockEnd);
    }
    out[idx] = { ...original, content };
  }

  return out;
}

export class PurgeErrorsStrategy implements CompactionStrategy {
  readonly name = "PurgeErrors";

  constructor(private readonly _config: PurgeErrorsConfig) {}

  canApply(messages: readonly Message[]): boolean {
    if (this._config.errorPurgeTurns <= 0) return false;
    const sites = findErroredCallSites(messages, this._config);
    return sites.some((s) => s.turnsAgo >= this._config.errorPurgeTurns);
  }

  async apply(messages: readonly Message[]): Promise<Message[]> {
    return purgeErrors(messages, this._config);
  }
}
