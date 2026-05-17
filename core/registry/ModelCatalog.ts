/**
 * v1.0.0 Phase 3.2 -- ModelCatalog (LLM half of the shared ModelRegistry).
 *
 * The canonical model definitions live in `core/registry/models.json` for
 * human review + cross-language consumption. This TypeScript module
 * re-declares them inline as `LlmCatalogEntry` objects so that pure-TS
 * consumers can `import { ModelCatalog }` without enabling
 * `resolveJsonModule`. A unit test in `tests/core/ModelCatalog.test.ts`
 * verifies that the two stay in sync.
 *
 * The catalog binds each model to a `promptFormat` strategy name (resolved
 * by `PromptFormat.ts`) and a `toolFormat` parser name.
 *
 * Consumers in v1.0.0:
 *  - Coding module dropdown (`ModelCatalog.listLlm()`).
 *  - Coding sidecar runtime (`ModelCatalog.get(id)` -> sampling + prompt
 *    format + tool format).
 *  - Settings UI (Phase 5 will replace the static catalog with a live
 *    content-addressed registry; the public type surface stays stable).
 */

export type ModelFamily = "gemma" | "llama" | "qwen" | "deepseek";

export type PromptFormatName = "gemma4" | "llama3" | "qwen" | "deepseek";

export type ToolFormatName =
  | "gemma4-xml"
  | "llama3-json"
  | "qwen-json"
  | "deepseek-json";

export interface SamplingDefaults {
  readonly temperature: number;
  readonly topP: number;
  readonly topK: number;
  readonly contextLength: number;
}

export interface LlmCatalogEntry {
  readonly id: string;
  readonly displayName: string;
  readonly family: ModelFamily;
  readonly runtime: "ollama" | "lmstudio";
  readonly vramGb?: number;
  readonly tags: readonly string[];
  readonly sampling: SamplingDefaults;
  readonly promptFormat: PromptFormatName;
  readonly toolFormat: ToolFormatName;
}

const ENTRIES: readonly LlmCatalogEntry[] = Object.freeze([
  {
    id: "gemma4:e4b",
    displayName: "Gemma 4 E4B",
    family: "gemma",
    runtime: "ollama",
    vramGb: 6,
    tags: Object.freeze(["recommended", "coding", "chat", "tool-use"]),
    sampling: { temperature: 0.7, topP: 0.9, topK: 64, contextLength: 8192 },
    promptFormat: "gemma4",
    toolFormat: "gemma4-xml",
  },
  {
    id: "llama3.1:8b",
    displayName: "Llama 3.1 8B Instruct",
    family: "llama",
    runtime: "ollama",
    vramGb: 8,
    tags: Object.freeze(["chat", "coding", "tool-use"]),
    sampling: { temperature: 0.6, topP: 0.9, topK: 50, contextLength: 8192 },
    promptFormat: "llama3",
    toolFormat: "llama3-json",
  },
  {
    id: "llama3.2:3b",
    displayName: "Llama 3.2 3B Instruct",
    family: "llama",
    runtime: "ollama",
    vramGb: 4,
    tags: Object.freeze(["chat", "lightweight"]),
    sampling: { temperature: 0.6, topP: 0.9, topK: 50, contextLength: 8192 },
    promptFormat: "llama3",
    toolFormat: "llama3-json",
  },
  {
    id: "llama3.3:70b",
    displayName: "Llama 3.3 70B Instruct",
    family: "llama",
    runtime: "ollama",
    vramGb: 40,
    tags: Object.freeze(["chat", "advanced"]),
    sampling: { temperature: 0.6, topP: 0.9, topK: 50, contextLength: 8192 },
    promptFormat: "llama3",
    toolFormat: "llama3-json",
  },
  {
    id: "qwen2.5:7b",
    displayName: "Qwen 2.5 7B Instruct",
    family: "qwen",
    runtime: "ollama",
    vramGb: 7,
    tags: Object.freeze(["chat", "coding", "tool-use"]),
    sampling: { temperature: 0.7, topP: 0.8, topK: 20, contextLength: 32768 },
    promptFormat: "qwen",
    toolFormat: "qwen-json",
  },
  {
    id: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    family: "qwen",
    runtime: "ollama",
    vramGb: 7,
    tags: Object.freeze(["recommended", "coding", "tool-use"]),
    sampling: { temperature: 0.4, topP: 0.85, topK: 20, contextLength: 32768 },
    promptFormat: "qwen",
    toolFormat: "qwen-json",
  },
  {
    id: "deepseek-coder:6.7b",
    displayName: "DeepSeek Coder 6.7B",
    family: "deepseek",
    runtime: "ollama",
    vramGb: 7,
    tags: Object.freeze(["coding"]),
    sampling: { temperature: 0.3, topP: 0.95, topK: 40, contextLength: 16384 },
    promptFormat: "deepseek",
    toolFormat: "deepseek-json",
  },
]);

export const ModelCatalog = {
  listLlm(): readonly LlmCatalogEntry[] {
    return ENTRIES;
  },
  listFamilies(): readonly ModelFamily[] {
    const seen = new Set<ModelFamily>();
    for (const e of ENTRIES) seen.add(e.family);
    return Array.from(seen);
  },
  byId(id: string): LlmCatalogEntry | undefined {
    return ENTRIES.find((e) => e.id === id);
  },
  get(id: string): LlmCatalogEntry {
    const found = this.byId(id);
    if (!found) throw new Error(`ModelCatalog: unknown model id ${id}`);
    return found;
  },
  byFamily(family: ModelFamily): readonly LlmCatalogEntry[] {
    return ENTRIES.filter((e) => e.family === family);
  },
  recommendedFor(role: "coding" | "chat"): readonly LlmCatalogEntry[] {
    return ENTRIES.filter(
      (e) => e.tags.includes("recommended") && e.tags.includes(role),
    );
  },
};

export type ModelCatalogT = typeof ModelCatalog;
