// Frontend-side model catalog mirror. The desktop UI consumes this list to
// render the model dropdown and to look up the display name for a session's
// active backend. A unit test asserts it stays in sync with the sidecar copy
// at `desktop/sidecar/src/coding/models.ts` (which itself mirrors
// `core/registry/models.json`).

export type ModelFamily = "gemma" | "llama" | "qwen" | "deepseek";

export interface FrontendModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly family: ModelFamily;
}

export const FRONTEND_MODELS: readonly FrontendModelEntry[] = Object.freeze([
  { id: "gemma4:e4b", displayName: "Gemma 4 E4B", family: "gemma" },
  { id: "llama3.1:8b", displayName: "Llama 3.1 8B Instruct", family: "llama" },
  { id: "llama3.2:3b", displayName: "Llama 3.2 3B Instruct", family: "llama" },
  { id: "llama3.3:70b", displayName: "Llama 3.3 70B Instruct", family: "llama" },
  { id: "qwen2.5:7b", displayName: "Qwen 2.5 7B Instruct", family: "qwen" },
  { id: "qwen2.5-coder:7b", displayName: "Qwen 2.5 Coder 7B", family: "qwen" },
  { id: "deepseek-coder:6.7b", displayName: "DeepSeek Coder 6.7B", family: "deepseek" },
]);

export const DEFAULT_MODEL_ID = "gemma4:e4b";
