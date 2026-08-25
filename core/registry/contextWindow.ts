/**
 * v2.2.7 Phase 1 -- catalog context-window parse and chip copy.
 *
 * Settings Models and the installer Models tab share this contract:
 * show the reported window as `<val>k`, or `Nk / Mk` when a split in/out
 * pair exists. Never invent 128000. Never append the word `in`.
 */

export interface CatalogContextWindows {
  readonly contextWindow: number | null;
  readonly contextWindowIn: number | null;
  readonly contextWindowOut: number | null;
}

export interface ContextChipSource {
  readonly contextWindow?: number | null;
  readonly contextWindowIn?: number | null;
  readonly contextWindowOut?: number | null;
}

const loggedJunk = new Set<string>();

function warnOnce(id: string, field: string, detail: string): void {
  const key = `${id}:${field}`;
  if (loggedJunk.has(key)) return;
  loggedJunk.add(key);
  const line = `[nexus] skip context chip for ${id} ${field}: ${detail}\n`;
  if (typeof process !== "undefined" && process.stderr?.write) {
    process.stderr.write(line);
  }
}

/**
 * Positive integer token count, or null. Missing, 0, and non-numeric junk
 * are null -- never 0 on the DTO and never a default 128k.
 */
export function parseContextWindow(
  value: unknown,
  meta: { id?: string; field?: string } = {},
): number | null {
  const id = meta.id ?? "?";
  const field = meta.field ?? "contextWindow";
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") {
    warnOnce(id, field, "non-numeric value");
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  warnOnce(id, field, "non-numeric value");
  return null;
}

export function catalogContextFromSpec(
  spec:
    | {
        readonly contextWindow?: unknown;
        readonly contextWindowIn?: unknown;
        readonly contextWindowOut?: unknown;
      }
    | undefined,
  id?: string,
): CatalogContextWindows {
  return {
    contextWindow: parseContextWindow(spec?.contextWindow, { id, field: "contextWindow" }),
    contextWindowIn: parseContextWindow(spec?.contextWindowIn, { id, field: "contextWindowIn" }),
    contextWindowOut: parseContextWindow(spec?.contextWindowOut, { id, field: "contextWindowOut" }),
  };
}

/** `128000` -> `128k`. Values below 1000 stay as the raw count, not `0k`. */
export function formatContextWindowK(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${Math.floor(tokens / 1000)}k`;
}

/**
 * Chip inner value: `128k` or `32k / 8k`. Null when nothing honest to show.
 * Callers prefix `Context: `.
 */
export function formatContextWindowValue(source: ContextChipSource): string | null {
  const inTok = source.contextWindowIn ?? source.contextWindow ?? null;
  const outTok = source.contextWindowOut ?? null;
  if (inTok != null && outTok != null && outTok > 0 && inTok !== outTok) {
    return `${formatContextWindowK(inTok)} / ${formatContextWindowK(outTok)}`;
  }
  const shown = inTok ?? (outTok != null && outTok > 0 ? outTok : null);
  if (shown == null || shown <= 0) return null;
  return formatContextWindowK(shown);
}

/** Full chip copy, e.g. `Context: 128k`. */
export function formatContextChip(source: ContextChipSource): string | null {
  const value = formatContextWindowValue(source);
  return value === null ? null : `Context: ${value}`;
}
