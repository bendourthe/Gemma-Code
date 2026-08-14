/**
 * v1.16.0 Phase 2.1 (adoption item A2) -- resident model size from Ollama.
 *
 * Ollama's `/api/ps` lists currently-loaded models with a `size_vram` (and
 * `size`) byte count. That is the only memory-footprint figure a local LLM
 * backend hands us directly, so it is what the per-model analytics report.
 *
 * Two design constraints drive the shape here:
 *
 *   1. It must be SYNCHRONOUS at read time. The metric is recorded in the
 *      `finally` of a streaming generator (`instrumentStream.ts`), and awaiting
 *      an HTTP round trip there would add latency to every completion. So the
 *      probe reads a cached value and refreshes in the background.
 *   2. It must never throw or reject visibly. Ollama may be gone by the time we
 *      look; a missing footprint is reported as `null`, never as a zero and
 *      never as an error that could surface to a user mid-completion.
 */

import type { OllamaHttp } from "./OllamaHttp.js";

/** How long a `/api/ps` reading stays fresh before a background refresh. */
export const DEFAULT_MEMORY_TTL_MS = 5_000;

interface PsEntry {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
}

/** Parse `/api/ps` into a model-name -> resident-bytes map. Never throws. */
export function parsePsResponse(raw: unknown): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (typeof raw !== "object" || raw === null) return out;
  const models = (raw as { models?: unknown }).models;
  if (!Array.isArray(models)) return out;
  for (const entry of models as PsEntry[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = typeof entry.name === "string" ? entry.name : entry.model;
    if (typeof name !== "string" || name.length === 0) continue;
    // Prefer VRAM residency; fall back to total size for a CPU-resident model.
    const bytes =
      typeof entry.size_vram === "number" && entry.size_vram > 0
        ? entry.size_vram
        : typeof entry.size === "number" && entry.size > 0
          ? entry.size
          : null;
    if (bytes !== null) out.set(name, bytes);
  }
  return out;
}

export interface OllamaMemoryProbeOptions {
  readonly ttlMs?: number;
  /** Injected for deterministic tests. Defaults to `Date.now()`. */
  readonly now?: () => number;
}

/**
 * A cached, synchronous memory probe for one model.
 *
 * The first call returns `null` (nothing cached yet) and kicks off a background
 * refresh; subsequent calls return the cached byte count until the TTL expires.
 * Deliberately eventually-consistent: a footprint that is a few seconds stale is
 * fine for an analytics panel, whereas blocking a completion is not.
 */
export function createOllamaMemoryProbe(
  http: Pick<OllamaHttp, "get">,
  opts: OllamaMemoryProbeOptions = {},
): (model: string) => number | null {
  const ttlMs = opts.ttlMs ?? DEFAULT_MEMORY_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  let cache: ReadonlyMap<string, number> = new Map();
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  const refresh = (): void => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const res = await http.get("/api/ps");
        if (res.ok) {
          cache = parsePsResponse((await res.json()) as unknown);
          fetchedAt = now();
        }
      } catch {
        // Ollama unreachable: keep whatever is cached, report null for misses.
      } finally {
        inFlight = false;
      }
    })();
  };

  return (model: string): number | null => {
    if (now() - fetchedAt >= ttlMs) refresh();
    // Ollama keys `/api/ps` by tag (e.g. `gemma4:12b`); accept an untagged id by
    // falling back to a `<name>:` prefix match so `gemma4` still resolves.
    const exact = cache.get(model);
    if (exact !== undefined) return exact;
    for (const [name, bytes] of cache) {
      if (name === model || name.startsWith(`${model}:`)) return bytes;
    }
    return null;
  };
}
