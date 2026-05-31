import { randomUUID } from "crypto";
import type { ToolHandler, ToolResult } from "../types.js";
import type { Message } from "../../../modules/coding/chat/types.js";
import type { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
import type { CompressionState, BlockSummary } from "../../../modules/coding/chat/state/CompressionState.js";

/**
 * v0.7.0 Phase 3 sub-tasks 3.4 + 3.5 -- Model-callable compress tool (C12).
 *
 * Two variants share this module:
 *   - `compress_range`   -- compress a contiguous span of messages.
 *   - `compress_message` -- compress one or more individual messages
 *                            (experimental; gated behind a setting).
 *
 * Both handlers operate purely on in-memory conversation state. They never
 * touch the filesystem, terminal, or network and are registered with
 * permission_tier 0.
 */

interface RangeRequest {
  startId: string;
  endId: string;
  summary: string;
}

interface CompressRangeArgs {
  topic: string;
  ranges: RangeRequest[];
}

interface CompressMessageArgs {
  topic: string;
  compressions: Array<{ messageId: string; summary: string }>;
}

export interface CompressToolDeps {
  /** Source of truth for the live conversation. */
  readonly conversation: ConversationManager;
  /** Durable per-session state for IDs and runs. */
  readonly state: CompressionState;
  /** Tool names whose result messages must NEVER be folded into a block. */
  readonly protectedTools: readonly string[];
  /**
   * When true, user-role messages caught inside a range are appended verbatim
   * to the end of the placeholder block instead of being absorbed.
   */
  readonly protectUserMessages: boolean;
  /** Optional logger for warnings; defaults to no-op. */
  readonly warn?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function fail(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

function ok(id: string, payload: Record<string, unknown>): ToolResult {
  return { id, success: true, output: JSON.stringify(payload) };
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function validateRangeArgs(raw: unknown): { ok: true; value: CompressRangeArgs } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object") return { ok: false, error: "args must be an object" };
  const r = raw as Record<string, unknown>;
  if (!isString(r["topic"])) return { ok: false, error: "missing string field 'topic' (3-5 word label)" };
  const ranges = r["ranges"];
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return { ok: false, error: "missing non-empty 'ranges' array" };
  }
  const cleanRanges: RangeRequest[] = [];
  for (const item of ranges) {
    if (item === null || typeof item !== "object") return { ok: false, error: "every range must be an object" };
    const it = item as Record<string, unknown>;
    if (!isString(it["startId"])) return { ok: false, error: "every range needs a string 'startId'" };
    if (!isString(it["endId"])) return { ok: false, error: "every range needs a string 'endId'" };
    if (!isString(it["summary"])) return { ok: false, error: "every range needs a non-empty 'summary'" };
    cleanRanges.push({
      startId: it["startId"] as string,
      endId: it["endId"] as string,
      summary: it["summary"] as string,
    });
  }
  return { ok: true, value: { topic: r["topic"] as string, ranges: cleanRanges } };
}

function validateMessageArgs(raw: unknown): { ok: true; value: CompressMessageArgs } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object") return { ok: false, error: "args must be an object" };
  const r = raw as Record<string, unknown>;
  const compressions = r["compressions"];
  if (!Array.isArray(compressions) || compressions.length === 0) {
    return { ok: false, error: "missing non-empty 'compressions' array" };
  }
  const cleaned: CompressMessageArgs["compressions"] = [];
  for (const item of compressions) {
    if (item === null || typeof item !== "object") return { ok: false, error: "every compression must be an object" };
    const it = item as Record<string, unknown>;
    if (!isString(it["messageId"])) return { ok: false, error: "every compression needs a string 'messageId'" };
    if (!isString(it["summary"])) return { ok: false, error: "every compression needs a non-empty 'summary'" };
    cleaned.push({
      messageId: it["messageId"] as string,
      summary: it["summary"] as string,
    });
  }
  const topic = isString(r["topic"]) ? (r["topic"] as string) : "message-mode";
  return { ok: true, value: { topic, compressions: cleaned } };
}

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

interface AnchoredMessage {
  readonly index: number;
  readonly message: Message;
  readonly stableId: string;
}

/**
 * Walk every non-system message and assign / look up its stable mNNNN id.
 * Newly-encountered messages are allocated lazily so the model can name a
 * message that has not yet been referenced in any compress call.
 */
function buildAnchoredView(
  messages: readonly Message[],
  state: CompressionState,
): AnchoredMessage[] {
  const out: AnchoredMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "system") continue;
    const stableId = state.allocateMessageId(msg);
    out.push({ index: i, message: msg, stableId });
  }
  return out;
}

interface ResolvedRange {
  readonly startView: number;
  readonly endView: number;
  readonly summary: string;
}

function resolveOneRange(
  range: RangeRequest,
  view: AnchoredMessage[],
): { ok: true; resolved: ResolvedRange } | { ok: false; error: string } {
  const start = view.findIndex((v) => v.stableId === range.startId);
  if (start === -1) return { ok: false, error: `unknown startId ${range.startId}` };
  const end = view.findIndex((v) => v.stableId === range.endId);
  if (end === -1) return { ok: false, error: `unknown endId ${range.endId}` };
  if (start > end) {
    return { ok: false, error: `range ${range.startId}..${range.endId} has startId after endId` };
  }
  return { ok: true, resolved: { startView: start, endView: end, summary: range.summary } };
}

function rangesOverlap(a: ResolvedRange, b: ResolvedRange): boolean {
  return a.startView <= b.endView && b.startView <= a.endView;
}

// ---------------------------------------------------------------------------
// Block placeholder construction
// ---------------------------------------------------------------------------

function findNestedBlockIds(snapshot: readonly Message[]): string[] {
  const blockRefs: string[] = [];
  for (const m of snapshot) {
    const matches = m.content.match(/\[BLOCK\s+(b\d+)/g);
    if (!matches) continue;
    for (const raw of matches) {
      const id = raw.replace(/^\[BLOCK\s+/, "").trim();
      if (id && !blockRefs.includes(id)) blockRefs.push(id);
    }
  }
  return blockRefs;
}

function tooLooksLikeProtectedToolResult(content: string, protectedTools: readonly string[]): boolean {
  const match = content.match(/<\|tool_result>\n([\s\S]*?)\n<tool_result\|>/);
  if (!match || !match[1]) return false;
  try {
    const parsed = JSON.parse(match[1]) as { name?: string };
    return typeof parsed.name === "string" && protectedTools.includes(parsed.name);
  } catch {
    return false;
  }
}

interface BuildBlockResult {
  readonly placeholder: Message;
  readonly tail: readonly Message[];
  readonly snapshot: readonly Message[];
  readonly nestedBlockIds: readonly string[];
}

function buildBlockReplacement(
  topic: string,
  blockId: string,
  resolved: ResolvedRange,
  view: AnchoredMessage[],
  deps: CompressToolDeps,
): BuildBlockResult {
  const slice = view.slice(resolved.startView, resolved.endView + 1).map((v) => v.message);
  const nestedBlockIds = findNestedBlockIds(slice);

  const tail: Message[] = [];
  if (deps.protectUserMessages) {
    for (const m of slice) {
      if (m.role === "user") tail.push(m);
    }
  }
  for (const m of slice) {
    if (tooLooksLikeProtectedToolResult(m.content, deps.protectedTools)) {
      tail.push(m);
    }
  }

  const nestedFooter = nestedBlockIds.length > 0
    ? `\n\nNested blocks embedded: ${nestedBlockIds.join(", ")}`
    : "";

  const placeholder: Message = {
    id: randomUUID(),
    role: "system",
    content: `[BLOCK ${blockId}: ${topic}]\n${resolved.summary}${nestedFooter}`,
    timestamp: Date.now(),
  };

  return {
    placeholder,
    tail,
    snapshot: slice,
    nestedBlockIds,
  };
}

// ---------------------------------------------------------------------------
// compress_range handler
// ---------------------------------------------------------------------------

export class CompressRangeTool implements ToolHandler {
  constructor(private readonly _deps: CompressToolDeps) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const validated = validateRangeArgs(parameters);
    if (!validated.ok) {
      return fail(
        id,
        `compress_range: ${validated.error}. ` +
          "Usage: compress_range(topic='3-5 word label', ranges=[{startId:'m0001', endId:'m0010', summary:'...'}, ...]).",
      );
    }
    const args = validated.value;

    if (this._deps.state.manualOnly) {
      return fail(
        id,
        "compress_range: tool is in manual-only mode for this session. " +
          "Ask the user to run /compact manual off, or use /compact sweep to issue a manual compression.",
      );
    }

    const messages = this._deps.conversation.getHistory();
    const view = buildAnchoredView(messages, this._deps.state);

    const resolved: ResolvedRange[] = [];
    for (const r of args.ranges) {
      const res = resolveOneRange(r, view);
      if (!res.ok) {
        return fail(id, `compress_range: ${res.error}.`);
      }
      resolved.push(res.resolved);
    }

    // Reject overlapping ranges in the SAME call.
    for (let a = 0; a < resolved.length; a++) {
      for (let b = a + 1; b < resolved.length; b++) {
        if (rangesOverlap(resolved[a]!, resolved[b]!)) {
          return fail(
            id,
            `compress_range: ranges ${a} and ${b} overlap each other. Submit non-overlapping ranges in a single call.`,
          );
        }
      }
    }

    // Apply ranges right-to-left so earlier indices stay valid.
    resolved.sort((a, b) => b.startView - a.startView);

    const newMessages: Message[] = [...messages];
    const blockSummaries: BlockSummary[] = [];

    for (const r of resolved) {
      const blockId = this._deps.state.allocateBlockId();
      const built = buildBlockReplacement(args.topic, blockId, r, view, this._deps);

      const startIdx = view[r.startView]!.index;
      const endIdx = view[r.endView]!.index;
      const replacement: Message[] = [built.placeholder, ...built.tail];
      newMessages.splice(startIdx, endIdx - startIdx + 1, ...replacement);

      blockSummaries.push({
        blockId,
        startId: view[r.startView]!.stableId,
        endId: view[r.endView]!.stableId,
        summary: r.summary,
        nestedBlockIds: built.nestedBlockIds,
        snapshot: built.snapshot,
      });
    }

    this._deps.conversation.replaceMessages(newMessages);
    const run = this._deps.state.recordRun({
      topic: args.topic,
      mode: "range",
      blockSummaries,
    });

    const tokensSavedEstimate = blockSummaries.reduce((sum, b) => {
      const before = b.snapshot.reduce((s, m) => s + m.content.length, 0);
      return sum + Math.max(0, before - b.summary.length);
    }, 0);

    return ok(id, {
      runId: run.runId,
      blockIds: blockSummaries.map((b) => b.blockId),
      tokensSavedEstimateChars: tokensSavedEstimate,
    });
  }
}

// ---------------------------------------------------------------------------
// compress_message handler (experimental)
// ---------------------------------------------------------------------------

/**
 * Detect cases where the user asked to compress one half of a tool-call /
 * tool-result pair while leaving the other half intact. Compressing only one
 * side would orphan the other and confuse the model.
 */
function rejectsOrphanedToolPair(
  targets: readonly AnchoredMessage[],
  view: readonly AnchoredMessage[],
): { ok: true } | { ok: false; error: string } {
  for (const target of targets) {
    const next = view.find((v) => v.index === target.index + 1);
    if (!next) continue;
    const isCall = /<\|tool_call>/.test(target.message.content);
    const isResult = /<\|tool_result>/.test(next.message.content);
    if (isCall && isResult) {
      const callSelected = targets.includes(target);
      const resultSelected = targets.some((t) => t.index === next.index);
      if (callSelected !== resultSelected) {
        return {
          ok: false,
          error: `compressing message ${target.stableId} would orphan its tool result ${next.stableId}; include both or neither`,
        };
      }
    }
  }
  return { ok: true };
}

export class CompressMessageTool implements ToolHandler {
  constructor(private readonly _deps: CompressToolDeps) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const validated = validateMessageArgs(parameters);
    if (!validated.ok) {
      return fail(
        id,
        `compress_message: ${validated.error}. ` +
          "Usage: compress_message(compressions=[{messageId:'m0001', summary:'...'}, ...]).",
      );
    }
    const args = validated.value;

    if (this._deps.state.manualOnly) {
      return fail(
        id,
        "compress_message: tool is in manual-only mode. Ask the user to run /compact manual off.",
      );
    }

    const messages = this._deps.conversation.getHistory();
    const view = buildAnchoredView(messages, this._deps.state);

    const targets: AnchoredMessage[] = [];
    const summariesById = new Map<string, string>();
    for (const c of args.compressions) {
      const found = view.find((v) => v.stableId === c.messageId);
      if (!found) {
        return fail(id, `compress_message: unknown messageId ${c.messageId}.`);
      }
      targets.push(found);
      summariesById.set(c.messageId, c.summary);
    }

    const orphanCheck = rejectsOrphanedToolPair(targets, view);
    if (!orphanCheck.ok) {
      return fail(id, `compress_message: ${orphanCheck.error}.`);
    }

    const newMessages: Message[] = [...messages];
    const blockSummaries: BlockSummary[] = [];

    for (const target of targets.slice().sort((a, b) => b.index - a.index)) {
      const blockId = this._deps.state.allocateBlockId();
      const summary = summariesById.get(target.stableId)!;
      const placeholder: Message = {
        id: randomUUID(),
        role: "system",
        content: `[BLOCK ${blockId}: ${args.topic}]\n${summary}`,
        timestamp: Date.now(),
      };
      newMessages.splice(target.index, 1, placeholder);
      blockSummaries.push({
        blockId,
        startId: target.stableId,
        endId: target.stableId,
        summary,
        nestedBlockIds: findNestedBlockIds([target.message]),
        snapshot: [target.message],
      });
    }

    this._deps.conversation.replaceMessages(newMessages);
    const run = this._deps.state.recordRun({
      topic: args.topic,
      mode: "message",
      blockSummaries,
    });

    return ok(id, {
      runId: run.runId,
      blockIds: blockSummaries.map((b) => b.blockId),
    });
  }
}
