/**
 * v2.2.7 Phase 2 -- session context fill from persisted turn usage.
 *
 * `usedTokens` is input + reasoning + output. Null fields are skipped, never
 * coerced to 0. When a turn has no reported usage, the helper may estimate
 * from `content` (utf8 bytes / 4) and sets `estimated: true`.
 *
 * Mid-session model switch: callers pass the **current** picker window against
 * **all** turns. History is not rewritten.
 *
 * Image/video: when `contextWindow` is null, the footer uses a session visual
 * cap (default 8 generated visuals), not per-request `visualTokenBudget.maxImages`.
 * `visualUnits` on turns are the numerator. A stub 1x1 must pass `visualUnits: 0`
 * (or omit) so it does not count.
 */

/** Footer-only session visual denominator. Catalog maxImages stays a per-request encoder cap. */
export const SESSION_VISUAL_CAP_DEFAULT = 8;

export interface SessionUsageTurn {
  readonly role?: "user" | "assistant" | "system";
  readonly content?: string;
  readonly inputTokens?: number | null;
  readonly reasoningTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly tokensEstimated?: boolean;
  /** Usable generated/attached visuals this turn. Never count a 1x1 stub. */
  readonly visualUnits?: number | null;
}

export interface VisualBudgetDenom {
  readonly maxImages?: number;
  readonly maxVideoFrames?: number;
}

export interface SessionContextUsage {
  readonly usedTokens: number;
  /** 0-100+ percent, or null when no honest denominator exists. */
  readonly percent: number | null;
  readonly atOrAbove80: boolean;
  readonly estimated: boolean;
  /** `llm` when contextWindow is used; `visual` when the analog budget is used. */
  readonly denominatorKind: "llm" | "visual" | "none";
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const bytes =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(text).length
      : text.length;
  return Math.ceil(bytes / 4);
}

function numericOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function turnReportedTokens(turn: SessionUsageTurn): number | null {
  const parts = [
    numericOrNull(turn.inputTokens),
    numericOrNull(turn.reasoningTokens),
    numericOrNull(turn.outputTokens),
  ];
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

/**
 * Sum session usage against the active window.
 *
 * Ollama `prompt_eval_count` on an assistant turn is the full prompt for that
 * request, not an incremental add. When a later turn reports non-estimated
 * `inputTokens`, that snapshot is the current fill; earlier turns are not
 * added on top. Mid-session model switch: callers pass the **current** picker
 * window; history is not rewritten.
 *
 * 80% is exact at the boundary: used/window >= 0.8. A null window does not
 * become 128000.
 */
export function sessionContextUsage(opts: {
  readonly turns: readonly SessionUsageTurn[];
  readonly contextWindow?: number | null;
  readonly visualTokenBudget?: VisualBudgetDenom | null;
  /** Footer-only. When omitted, visual sessions use SESSION_VISUAL_CAP_DEFAULT. */
  readonly sessionVisualCap?: number | null;
}): SessionContextUsage {
  const window =
    typeof opts.contextWindow === "number" && opts.contextWindow > 0 ? opts.contextWindow : null;

  let lastReportedIdx = -1;
  for (let i = opts.turns.length - 1; i >= 0; i -= 1) {
    const turn = opts.turns[i];
    if (!turn || turn.tokensEstimated) continue;
    if (numericOrNull(turn.inputTokens) !== null) {
      lastReportedIdx = i;
      break;
    }
  }

  let estimated = false;
  let usedTokens = 0;
  const start = lastReportedIdx >= 0 ? lastReportedIdx : 0;
  for (let i = start; i < opts.turns.length; i += 1) {
    const turn = opts.turns[i];
    if (!turn) continue;
    const reported = turnReportedTokens(turn);
    if (reported !== null) {
      usedTokens += reported;
      if (turn.tokensEstimated) estimated = true;
      continue;
    }
    if (turn.content && turn.content.length > 0) {
      usedTokens += estimateTokens(turn.content);
      estimated = true;
    }
  }

  if (window !== null) {
    const percent = (usedTokens / window) * 100;
    return {
      usedTokens,
      percent,
      atOrAbove80: usedTokens * 5 >= window * 4,
      estimated,
      denominatorKind: "llm",
    };
  }

  const hasVisualBudget =
    (opts.visualTokenBudget?.maxImages ?? 0) > 0 ||
    (opts.visualTokenBudget?.maxVideoFrames ?? 0) > 0;
  const overrideCap =
    typeof opts.sessionVisualCap === "number" && opts.sessionVisualCap > 0
      ? opts.sessionVisualCap
      : null;
  const visualCap = overrideCap ?? (hasVisualBudget ? SESSION_VISUAL_CAP_DEFAULT : null);
  if (visualCap !== null) {
    let visualUsed = 0;
    for (const turn of opts.turns) {
      const units = numericOrNull(turn.visualUnits);
      if (units !== null) visualUsed += units;
    }
    const percent = (visualUsed / visualCap) * 100;
    return {
      usedTokens: visualUsed,
      percent,
      atOrAbove80: visualUsed * 5 >= visualCap * 4,
      estimated: false,
      denominatorKind: "visual",
    };
  }

  return {
    usedTokens,
    percent: null,
    atOrAbove80: false,
    estimated,
    denominatorKind: "none",
  };
}
