/**
 * v1.16.0 Phase 1.3 (adoption item A1) -- the runtimes the gateway can route to.
 *
 * This is the headless twin of `LocalAdapterRegistry`: same manifest concept,
 * same loopback-only guard (the shared `modules/coding/llm/loopback.ts`
 * predicate), same `nexus.llm.localAdapters` config shape -- but it builds its
 * clients from the vscode-free `headlessOllamaClient` / `headlessOpenAiClient`
 * factories. `LocalAdapterRegistry` itself is unusable here: it statically
 * imports the concrete `OllamaClient` / `LmStudioClient`, which reach
 * `config/settings` + `utils/logger` and therefore `vscode`, which neither the
 * esbuild sidecar bundle nor a plain-Node host can load.
 *
 * The gateway consequently serves any local runtime the user has registered,
 * including an MLX server reachable over loopback -- the v1.16.0 Phase 5 (A3)
 * documented path -- with no extra code.
 */

import { z } from "zod";
import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import { createHeadlessOpenAiClient } from "../../../../modules/coding/llm/headlessOpenAiClient.js";
import { isLoopbackEndpoint } from "../../../../modules/coding/llm/loopback.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";

/** Settings key holding user-registered local-runtime manifests. */
export const LOCAL_ADAPTERS_KEY = "nexus.llm.localAdapters";

/** One routable runtime, resolved lazily so no client is built until needed. */
export interface ServingAdapter {
  readonly name: string;
  /** False marks an embed-only runtime the chat routes must skip. */
  readonly chat: boolean;
  createClient(): LLMClient;
}

const ManifestSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1).optional(),
    protocol: z.enum(["ollama", "openai"]),
    endpoint: z.string().min(1),
    capabilities: z
      .object({
        chat: z.boolean().optional(),
        embed: z.boolean().optional(),
        vision: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

export type ServingAdapterManifest = z.infer<typeof ManifestSchema>;

function clientFactory(manifest: ServingAdapterManifest): () => LLMClient {
  return manifest.protocol === "ollama"
    ? () => createHeadlessOllamaClient({ baseUrl: manifest.endpoint })
    : () => createHeadlessOpenAiClient({ baseUrl: manifest.endpoint });
}

/**
 * Turn a manifest into an adapter, or return null when it is structurally
 * invalid or declares a non-loopback endpoint. Non-throwing so one bad entry in
 * user config cannot break discovery of the rest.
 */
export function adapterFromManifest(raw: unknown): ServingAdapter | null {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  const manifest = parsed.data;
  if (!isLoopbackEndpoint(manifest.endpoint)) return null;
  const create = clientFactory(manifest);
  return {
    name: manifest.name,
    chat: manifest.capabilities?.chat !== false,
    createClient: create,
  };
}

/**
 * The two runtimes Nexus ships. Endpoints honour the existing sidecar env
 * overrides (`NEXUS_OLLAMA_URL`, `NEXUS_LMSTUDIO_URL`) so a non-default local
 * port needs no code change.
 */
export function builtinServingAdapters(env: NodeJS.ProcessEnv = process.env): ServingAdapter[] {
  const manifests: ServingAdapterManifest[] = [
    {
      name: "ollama",
      label: "Ollama",
      protocol: "ollama",
      endpoint: env.NEXUS_OLLAMA_URL ?? "http://127.0.0.1:11434",
      capabilities: { chat: true },
    },
    {
      name: "lmstudio",
      label: "LM Studio",
      protocol: "openai",
      endpoint: env.NEXUS_LMSTUDIO_URL ?? "http://127.0.0.1:1234",
      capabilities: { chat: true },
    },
  ];
  return manifests
    .map((m) => adapterFromManifest(m))
    .filter((a): a is ServingAdapter => a !== null);
}

/**
 * The built-ins plus any user-registered `nexus.llm.localAdapters` manifests. A
 * user manifest whose `name` matches a built-in replaces it, matching
 * `LocalAdapterRegistry`'s last-registration-wins behavior.
 */
export function resolveServingAdapters(
  rawLocalAdapters: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ServingAdapter[] {
  const byName = new Map<string, ServingAdapter>();
  for (const adapter of builtinServingAdapters(env)) byName.set(adapter.name, adapter);
  if (Array.isArray(rawLocalAdapters)) {
    for (const raw of rawLocalAdapters) {
      const adapter = adapterFromManifest(raw);
      if (adapter) byName.set(adapter.name, adapter);
    }
  }
  return [...byName.values()];
}
