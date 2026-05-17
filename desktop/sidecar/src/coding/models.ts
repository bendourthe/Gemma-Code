// v1.0.0 Phase 3.2 -- sidecar-local copy of the LLM catalog.
//
// The desktop sidecar runs as its own npm workspace and cannot reach across
// to `core/registry/ModelCatalog.ts` without a build step that resolves
// `../../../core/` to a published package. Phase 5 introduces that step
// (the shared-core build); Phase 3 inlines the catalog here and relies on a
// unit test (`sidecar-models.test.ts`) to assert the two copies stay in sync
// against the canonical `core/registry/models.json`.

export type ModelFamily = "gemma" | "llama" | "qwen" | "deepseek";
export type PromptFormatName = "gemma4" | "llama3" | "qwen" | "deepseek";
export type ToolFormatName =
  | "gemma4-xml"
  | "llama3-json"
  | "qwen-json"
  | "deepseek-json";

export interface SidecarModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly family: ModelFamily;
  readonly promptFormat: PromptFormatName;
  readonly toolFormat: ToolFormatName;
}

export const SIDECAR_MODELS: readonly SidecarModelEntry[] = Object.freeze([
  { id: "gemma4:e4b", displayName: "Gemma 4 E4B", family: "gemma", promptFormat: "gemma4", toolFormat: "gemma4-xml" },
  { id: "llama3.1:8b", displayName: "Llama 3.1 8B Instruct", family: "llama", promptFormat: "llama3", toolFormat: "llama3-json" },
  { id: "llama3.2:3b", displayName: "Llama 3.2 3B Instruct", family: "llama", promptFormat: "llama3", toolFormat: "llama3-json" },
  { id: "llama3.3:70b", displayName: "Llama 3.3 70B Instruct", family: "llama", promptFormat: "llama3", toolFormat: "llama3-json" },
  { id: "qwen2.5:7b", displayName: "Qwen 2.5 7B Instruct", family: "qwen", promptFormat: "qwen", toolFormat: "qwen-json" },
  { id: "qwen2.5-coder:7b", displayName: "Qwen 2.5 Coder 7B", family: "qwen", promptFormat: "qwen", toolFormat: "qwen-json" },
  { id: "deepseek-coder:6.7b", displayName: "DeepSeek Coder 6.7B", family: "deepseek", promptFormat: "deepseek", toolFormat: "deepseek-json" },
]);

export function lookupModel(id: string): SidecarModelEntry | undefined {
  return SIDECAR_MODELS.find((m) => m.id === id);
}

export function requireModel(id: string): SidecarModelEntry {
  const found = lookupModel(id);
  if (!found) throw new Error(`Unknown model id: ${id}`);
  return found;
}
