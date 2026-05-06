import type { ConversationManager } from "../chat/ConversationManager.js";
import type { Message } from "../chat/types.js";
import type { CompressionState } from "../chat/state/CompressionState.js";
import { estimateTokensForMessage } from "../chat/CompactionStrategy.js";

/**
 * v0.7.0 Phase 3 sub-task 3.6 -- /compact <verb> command implementations.
 *
 * Each function returns a markdown-friendly string. The owning handler is
 * responsible for emitting the string into the conversation and posting it
 * to the webview. Pure (apart from CompressionState mutations); easily unit
 * tested without spinning up a panel.
 */

export type CompactVerb =
  | "context"
  | "stats"
  | "sweep"
  | "decompress"
  | "recompress"
  | "manual"
  | "legacy"
  | "unknown";

export interface ParsedCompactArgs {
  readonly verb: CompactVerb;
  readonly numericArg?: number; // sweep [n]
  readonly stringArg?: string; // decompress/recompress <blockId>, manual on|off
}

export function parseCompactArgs(rawArgs: string): ParsedCompactArgs {
  const trimmed = rawArgs.trim();
  if (trimmed === "") return { verb: "legacy" };

  const [head, ...rest] = trimmed.split(/\s+/);
  const verb = (head ?? "").toLowerCase();
  const tail = rest.join(" ").trim();

  switch (verb) {
    case "context":
    case "stats":
      return { verb };
    case "sweep": {
      const n = tail === "" ? undefined : Number(tail);
      return { verb: "sweep", numericArg: Number.isFinite(n) ? n : undefined };
    }
    case "decompress":
    case "recompress":
      return { verb, stringArg: tail || undefined };
    case "manual":
      return { verb: "manual", stringArg: tail.toLowerCase() || undefined };
    default:
      return { verb: "unknown", stringArg: verb };
  }
}

// ---------------------------------------------------------------------------
// /compact context
// ---------------------------------------------------------------------------

export interface ContextBreakdown {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly usedPercent: number;
  readonly headroomPercent: number;
  readonly perRole: Record<string, number>;
}

export function computeContextBreakdown(
  messages: readonly Message[],
  maxTokens: number,
): ContextBreakdown {
  const perRole: Record<string, number> = { system: 0, user: 0, assistant: 0 };
  let total = 0;
  for (const msg of messages) {
    const t = estimateTokensForMessage(msg);
    total += t;
    perRole[msg.role] = (perRole[msg.role] ?? 0) + t;
  }
  const usedPercent = maxTokens > 0 ? Math.min(100, Math.round((total / maxTokens) * 100)) : 0;
  return {
    totalTokens: total,
    maxTokens,
    usedPercent,
    headroomPercent: Math.max(0, 100 - usedPercent),
    perRole,
  };
}

export function renderContextBreakdown(b: ContextBreakdown): string {
  const lines = [
    `**Context usage**: ~${b.totalTokens.toLocaleString()} / ${b.maxTokens.toLocaleString()} tokens (${b.usedPercent}% used, ${b.headroomPercent}% headroom).`,
    "",
    "| Role | Tokens |",
    "|------|--------|",
  ];
  for (const role of ["system", "user", "assistant"]) {
    const count = b.perRole[role] ?? 0;
    lines.push(`| ${role} | ${count.toLocaleString()} |`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /compact stats
// ---------------------------------------------------------------------------

export interface CompactionStats {
  readonly compressionRuns: number;
  readonly compressionBlocks: number;
  readonly snapshotChars: number;
  readonly summaryChars: number;
  readonly tokensSavedEstimate: number;
}

export function computeCompactionStats(state: CompressionState): CompactionStats {
  let blocks = 0;
  let snapshotChars = 0;
  let summaryChars = 0;
  for (const run of state.listRuns()) {
    if (run.decompressed) continue;
    for (const block of run.blockSummaries) {
      blocks += 1;
      for (const m of block.snapshot) snapshotChars += m.content.length;
      summaryChars += block.summary.length;
    }
  }
  return {
    compressionRuns: state.listRuns().filter((r) => !r.decompressed).length,
    compressionBlocks: blocks,
    snapshotChars,
    summaryChars,
    tokensSavedEstimate: Math.max(0, Math.floor((snapshotChars - summaryChars) / 4)),
  };
}

export function renderCompactionStats(s: CompactionStats): string {
  return [
    "**Compaction stats** (cumulative across this session):",
    "",
    `- Compression runs (active): ${s.compressionRuns}`,
    `- Total blocks (active):     ${s.compressionBlocks}`,
    `- Source chars compressed:   ${s.snapshotChars.toLocaleString()}`,
    `- Summary chars produced:    ${s.summaryChars.toLocaleString()}`,
    `- Tokens saved (estimate):   ~${s.tokensSavedEstimate.toLocaleString()}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// /compact sweep
// ---------------------------------------------------------------------------

export interface SweepPlan {
  readonly fromIndex: number; // inclusive
  readonly toIndex: number; // inclusive
  readonly count: number;
}

/**
 * Build the plan for a manual `/compact sweep [n]` invocation: identify the
 * span between the last user message and the most recent N tool-result-bearing
 * messages.
 */
export function planSweep(
  messages: readonly Message[],
  maxToolResults: number,
): SweepPlan | null {
  if (maxToolResults <= 0) return null;
  // Tool results in the Gemma 4 protocol are emitted as user-role messages
  // (`<|tool_result>...`). To find the most recent *human* user turn we
  // therefore skip user messages that contain a tool_result block.
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "user" && !m.content.includes("<|tool_result>")) {
      lastUserIdx = i;
      break;
    }
  }

  const toolResultIndices: number[] = [];
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m && m.content.includes("<|tool_result>")) toolResultIndices.push(i);
  }
  if (toolResultIndices.length === 0) return null;

  const start = toolResultIndices[Math.max(0, toolResultIndices.length - maxToolResults)]!;
  const end = toolResultIndices[toolResultIndices.length - 1]!;
  return {
    fromIndex: start,
    toIndex: end,
    count: end - start + 1,
  };
}

// ---------------------------------------------------------------------------
// /compact decompress / recompress
// ---------------------------------------------------------------------------

export function decompressBlockInConversation(
  manager: ConversationManager,
  state: CompressionState,
  blockId: string,
): { ok: true; restored: number } | { ok: false; reason: string } {
  const located = state.findBlock(blockId);
  if (!located) return { ok: false, reason: `unknown blockId ${blockId}` };
  const messages = manager.getHistory();
  // Find the placeholder by content match.
  const placeholderIdx = messages.findIndex((m) => m.content.startsWith(`[BLOCK ${blockId}:`));
  if (placeholderIdx === -1) {
    return { ok: false, reason: `placeholder for ${blockId} not found in conversation` };
  }
  const result = state.decompressBlock(blockId);
  const next: Message[] = [
    ...messages.slice(0, placeholderIdx),
    ...result.restoredMessages,
    ...messages.slice(placeholderIdx + 1),
  ];
  manager.replaceMessages(next);
  return { ok: true, restored: result.restoredMessages.length };
}

export function recompressBlockInConversation(
  manager: ConversationManager,
  state: CompressionState,
  blockId: string,
): { ok: true } | { ok: false; reason: string } {
  const located = state.findBlock(blockId);
  if (!located) return { ok: false, reason: `unknown blockId ${blockId}` };
  if (!located.run.decompressed) {
    return { ok: false, reason: `block ${blockId} is not currently decompressed` };
  }

  const snapshotIds = new Set(located.block.snapshot.map((m) => m.id));
  const messages = manager.getHistory();
  const startIdx = messages.findIndex((m) => snapshotIds.has(m.id));
  if (startIdx === -1) {
    return { ok: false, reason: `restored messages for ${blockId} not found in conversation` };
  }
  // Find the trailing index of the contiguous snapshot range.
  let endIdx = startIdx;
  for (let i = startIdx + 1; i < messages.length; i++) {
    if (snapshotIds.has(messages[i]!.id)) endIdx = i;
    else break;
  }

  state.recompressBlock(blockId);

  const placeholder: Message = {
    id: messages[startIdx]!.id, // reuse the original placeholder slot id
    role: "system",
    content: `[BLOCK ${blockId}: ${located.run.topic}]\n${located.block.summary}`,
    timestamp: Date.now(),
  };
  const next = [
    ...messages.slice(0, startIdx),
    placeholder,
    ...messages.slice(endIdx + 1),
  ];
  manager.replaceMessages(next);
  return { ok: true };
}
