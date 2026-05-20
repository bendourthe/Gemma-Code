/**
 * v1.1.0 Phase 6.3 - 6.5 -- `/recall`, `/remember`, `/forget` handlers.
 *
 * Pure async functions over a `SlashCommandContext` so they can be unit-
 * tested without spawning the chat UI. The desktop chat input
 * (`desktop/src/modules/coding/CodingInput.tsx`) builds the prefill
 * template; the sidecar invokes the corresponding handler when a
 * `coding.session.sendMessage` payload begins with `/recall` / `/remember`
 * / `/forget`.
 *
 *   /recall <query>           hybrid-search top-10, returned as a fenced
 *                             JSON block ready to drop into a RenderedTurn.
 *   /remember <text>          working-tier observation tagged with the
 *                             active sessionId + `slash.remember` hookKind.
 *   /forget --id <uuid>       exact delete, gated by ConfirmationGate.
 *   /forget --pattern <re>    regex match over `text`, gated by
 *                             ConfirmationGate.
 *
 * Adopts agentmemory A12 (see comparison-agentmemory.md Section 11.2 P1).
 */

import type { MemoryHit, ScopeId } from "./MemoryHub.js";
import type { HybridRetrieverLike } from "./MemoryHub.js";
import type { LifecycleProvenance } from "./types.js";
import type { MemoryAuditLog } from "./MemoryAuditLog.js";
import { rowFromProvenance } from "./MemoryAuditLog.js";

export interface ForgetEntry {
  readonly id: string;
  readonly text: string;
  readonly tier: "working" | "episodic" | "semantic" | "graph";
  readonly provenance?: LifecycleProvenance | null;
}

export interface MemoryWritePort {
  /**
   * Write a working-tier observation. Returns the assigned entry id.
   * `/remember` uses this.
   */
  writeWorking(args: {
    readonly content: string;
    readonly provenance: LifecycleProvenance;
    readonly scopeId?: ScopeId;
  }): Promise<{ id: string }>;
  /**
   * Look up candidate rows for `/forget`. Implementations decide which
   * tiers to scan; the default sidecar implementation walks all four.
   */
  listForForget(): Promise<readonly ForgetEntry[]>;
  /**
   * Delete an entry by id. Returns `true` when the row existed and was
   * removed.
   */
  delete(id: string): Promise<boolean>;
}

export interface SlashCommandContext {
  readonly sessionId: string;
  readonly scopeId?: ScopeId;
  readonly visibleScopes?: ReadonlyArray<ScopeId>;
  readonly retriever: HybridRetrieverLike | null;
  readonly memory: MemoryWritePort;
  readonly auditLog: MemoryAuditLog;
  readonly confirm: (message: string) => Promise<boolean>;
  /** Currently active span id for trace correlation (optional). */
  readonly parentSpanId?: string;
}

export interface SlashCommandRender {
  /** Top-level status string shown to the user. */
  readonly status: string;
  /** Optional fenced JSON block body. */
  readonly body?: string;
  /**
   * Machine-readable payload mirrored into the RenderedTurn so the chat
   * UI can drive click-to-copy / navigate-to-source without re-parsing
   * the body string.
   */
  readonly payload?: unknown;
  readonly ok: boolean;
}

/** Render a fenced JSON code block. */
function fencedJson(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/** Trim leading slash + command keyword. Returns the argument string. */
function stripCommand(input: string, command: string): string {
  const trimmed = input.trim();
  const prefix = `/${command}`;
  if (!trimmed.startsWith(prefix)) return trimmed;
  return trimmed.slice(prefix.length).trim();
}

/**
 * `/recall <query>` -- run the hybrid retriever and render the top-K hits.
 * Returns an `ok: false` render when no retriever is wired or the query is
 * empty.
 */
export async function handleRecall(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandRender> {
  const query = stripCommand(input, "recall");
  if (query.length === 0) {
    return { ok: false, status: "/recall: missing query. Usage: /recall <query>" };
  }
  if (!ctx.retriever) {
    return { ok: false, status: "/recall: hybrid retriever is not initialized yet." };
  }
  if (!ctx.retriever.isReady) {
    return { ok: false, status: "/recall: hybrid retriever is still warming up; try again in a moment." };
  }
  const opts: Parameters<HybridRetrieverLike["retrieve"]>[1] = { limit: 10 };
  if (ctx.scopeId !== undefined) opts!.scopeId = ctx.scopeId;
  if (ctx.visibleScopes !== undefined) opts!.visibleScopes = ctx.visibleScopes;
  let hits: MemoryHit[] = [];
  try {
    hits = await ctx.retriever.retrieve(query, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: `/recall: retrieval failed: ${message}` };
  }
  const projected = hits.map((h) => ({
    text: h.content,
    tier: h.layer,
    score: Number(h.score.toFixed(4)),
    entryId: h.id,
    provenance: h.provenance ?? null,
  }));
  for (const hit of hits) {
    ctx.auditLog.append(
      rowFromProvenance({
        op: "read",
        tier: hit.layer,
        entryId: hit.id,
        text: hit.content,
        provenance: {
          sessionId: ctx.sessionId,
          hookKind: "slash.recall",
          ...(ctx.parentSpanId !== undefined ? { parentSpanId: ctx.parentSpanId } : {}),
        },
      }),
    );
  }
  return {
    ok: true,
    status: `Recall returned ${hits.length} hit${hits.length === 1 ? "" : "s"} for "${query}".`,
    body: fencedJson(projected),
    payload: projected,
  };
}

/**
 * `/remember <text>` -- write a working-tier observation tagged with the
 * active session + `slash.remember` hookKind. Empty payloads are rejected.
 */
export async function handleRemember(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandRender> {
  const text = stripCommand(input, "remember");
  if (text.length === 0) {
    return { ok: false, status: "/remember: missing text. Usage: /remember <text>" };
  }
  const provenance: LifecycleProvenance = {
    sessionId: ctx.sessionId,
    hookKind: "slash.remember",
    ...(ctx.parentSpanId !== undefined ? { parentSpanId: ctx.parentSpanId } : {}),
  };
  let result: { id: string };
  try {
    result = await ctx.memory.writeWorking(
      ctx.scopeId !== undefined
        ? { content: text, provenance, scopeId: ctx.scopeId }
        : { content: text, provenance },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: `/remember: write failed: ${message}` };
  }
  ctx.auditLog.append(
    rowFromProvenance({
      op: "write",
      tier: "working",
      entryId: result.id,
      text,
      provenance,
    }),
  );
  return {
    ok: true,
    status: `Remembered (working-tier id=${result.id}).`,
    payload: { id: result.id, tier: "working", text },
  };
}

export interface ForgetSelector {
  readonly id?: string;
  readonly pattern?: RegExp;
}

/**
 * Parse `/forget --id <uuid>` or `/forget --pattern <regex>`. Returns
 * `null` when neither flag is supplied.
 */
export function parseForgetArgs(input: string): ForgetSelector | null {
  const args = stripCommand(input, "forget");
  const idMatch = /--id(?:=|\s+)([^\s]+)/.exec(args);
  if (idMatch && idMatch[1]) {
    return { id: idMatch[1] };
  }
  const patternMatch = /--pattern(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(args);
  if (patternMatch) {
    const raw = patternMatch[1] ?? patternMatch[2] ?? patternMatch[3];
    if (raw) {
      try {
        return { pattern: new RegExp(raw) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * `/forget --id <uuid>` or `/forget --pattern <regex>` -- locate candidate
 * rows, prompt for confirmation via `ctx.confirm`, then delete the matches
 * and write `delete` audit rows.
 */
export async function handleForget(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandRender> {
  const selector = parseForgetArgs(input);
  if (!selector) {
    return {
      ok: false,
      status: "/forget: missing --id or --pattern. Usage: /forget --id <uuid> | --pattern <regex>",
    };
  }

  const all = await ctx.memory.listForForget();
  const matches: ForgetEntry[] = [];
  for (const entry of all) {
    if (selector.id !== undefined) {
      if (entry.id === selector.id) matches.push(entry);
    } else if (selector.pattern !== undefined) {
      if (selector.pattern.test(entry.text)) matches.push(entry);
    }
  }

  if (matches.length === 0) {
    return { ok: false, status: "/forget: no matching entries found." };
  }

  const confirmation = await ctx.confirm(
    `Permanently delete ${matches.length} memor${matches.length === 1 ? "y" : "ies"}? This cannot be undone.`,
  );
  if (!confirmation) {
    return { ok: false, status: "/forget: cancelled by user." };
  }

  const deleted: string[] = [];
  for (const entry of matches) {
    const ok = await ctx.memory.delete(entry.id);
    if (!ok) continue;
    deleted.push(entry.id);
    ctx.auditLog.append(
      rowFromProvenance({
        op: "delete",
        tier: entry.tier,
        entryId: entry.id,
        text: entry.text,
        provenance: {
          sessionId: ctx.sessionId,
          hookKind: "slash.forget",
          ...(ctx.parentSpanId !== undefined ? { parentSpanId: ctx.parentSpanId } : {}),
        },
      }),
    );
  }

  return {
    ok: true,
    status: `Forgot ${deleted.length} memor${deleted.length === 1 ? "y" : "ies"}.`,
    payload: { deletedIds: deleted },
  };
}
