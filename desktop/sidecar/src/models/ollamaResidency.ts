/**
 * v2.4.8 follow-up (2026-09-07) -- what Ollama holds on the GPU, and the two
 * moves around it: evict before a diffusion job, warm after a model switch.
 *
 * Operator report: switching from Chat to Images left the chat model resident
 * (about 8 GB on a 16 GB card), so the diffusion runtime fell into the slow
 * CPU-offload path and the image took many minutes. The desktop also had no
 * way to know when a chat model was loaded, so it could not show a loading
 * state. `/api/ps` answers both: it lists the resident models with their VRAM
 * footprint, and a model appears there once it is loaded.
 */

import { readRuntimeConfig } from "../runtimeConfig.js";

export interface ResidentOllamaModel {
  readonly name: string;
  readonly sizeBytes: number;
  readonly sizeVramBytes: number;
}

/**
 * v2.4.8 follow-up (2026-09-07): the switch dialog said "gemma4:12b is loaded",
 * the raw Ollama tag. The catalog knows that tag as "Gemma 4 12B", so the tag
 * is mapped back to the name the rest of the app shows. Catalog entries carry
 * the tag in `source.url` (`ollama://gemma4:12b`); the id is matched too.
 */
export interface CatalogNameSource {
  readonly id: string;
  readonly displayName?: string | undefined;
  readonly source?: { readonly url?: string | undefined } | undefined;
}

export function catalogNamesByOllamaTag(
  models: readonly CatalogNameSource[],
): Map<string, string> {
  const byTag = new Map<string, string>();
  for (const model of models) {
    const name = model.displayName ?? model.id;
    byTag.set(model.id.toLowerCase(), name);
    const url = model.source?.url ?? "";
    const prefix = "ollama://";
    if (url.toLowerCase().startsWith(prefix)) {
      byTag.set(url.slice(prefix.length).toLowerCase(), name);
    }
  }
  return byTag;
}

/** The catalog name for a resident tag, falling back to the tag itself. */
export function displayNameForResident(
  tag: string,
  byTag: ReadonlyMap<string, string>,
): string {
  const lower = tag.toLowerCase();
  const bare = lower.split(":")[0] ?? lower;
  return byTag.get(lower) ?? byTag.get(bare) ?? tag;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/** Env wins, then the installer's runtime.json, then the Ollama default. */
export function ollamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.OLLAMA_HOST?.trim();
  const fromConfig = readRuntimeConfig()?.ollama?.url?.trim();
  const raw = fromEnv || fromConfig || DEFAULT_BASE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/$/, "");
}

interface PsResponse {
  models?: ReadonlyArray<{
    name?: unknown;
    model?: unknown;
    size?: unknown;
    size_vram?: unknown;
  }>;
}

export async function listResidentOllamaModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResidentOllamaModel[]> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/ps`);
    if (!res.ok) return [];
    const body = (await res.json()) as PsResponse;
    return (body.models ?? []).flatMap((entry) => {
      const name =
        typeof entry.name === "string"
          ? entry.name
          : typeof entry.model === "string"
            ? entry.model
            : null;
      if (!name) return [];
      return [
        {
          name,
          sizeBytes: typeof entry.size === "number" ? entry.size : 0,
          sizeVramBytes: typeof entry.size_vram === "number" ? entry.size_vram : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Ask Ollama to drop every resident model (`keep_alive: 0`); returns the names. */
export async function evictOllamaModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const resident = await listResidentOllamaModels(baseUrl, fetchImpl);
  const evicted: string[] = [];
  for (const model of resident) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.name, keep_alive: 0, prompt: "" }),
      });
      if (res.ok) evicted.push(model.name);
    } catch {
      // Ollama unreachable: nothing resident to evict.
    }
  }
  return evicted;
}

/**
 * Load a model without generating anything (empty prompt, default keep-alive),
 * so the user sees the load happen now rather than on their next message.
 */
export async function warmOllamaModel(
  model: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false }),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Mirrors `runtimes/diffusion/device.choose_offload`: below this, weights offload. */
export const KEEP_ON_GPU_MULTIPLIER = 1.5;

/**
 * Evict resident Ollama models when a diffusion model of `modelVramGB` would
 * not fit comfortably beside them. Returns the evicted names ([] when nothing
 * was needed or Ollama was unreachable).
 */
export async function evictOllamaIfTight(input: {
  readonly freeVramGB: number | null;
  readonly modelVramGB: number;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<string[]> {
  if (input.freeVramGB === null) return [];
  if (input.freeVramGB >= input.modelVramGB * KEEP_ON_GPU_MULTIPLIER) return [];
  return evictOllamaModels(input.baseUrl, input.fetchImpl ?? fetch);
}
