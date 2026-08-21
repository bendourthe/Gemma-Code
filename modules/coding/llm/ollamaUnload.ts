/**
 * v2.1 DF-4 -- ask Ollama to drop a resident model (`keep_alive: 0`).
 *
 * Load remains implicit on the next chat. This helper is fire-and-forget from
 * routing: a failed unload must not abort the turn.
 */

export interface UnloadOllamaModelInput {
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export async function unloadOllamaModel(
  input: UnloadOllamaModelInput,
): Promise<{ ok: boolean; status: number }> {
  const base = (input.baseUrl ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, keep_alive: 0, prompt: "" }),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
