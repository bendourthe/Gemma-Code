import { describe, expect, it, vi } from "vitest";
import {
  evictOllamaIfTight,
  evictOllamaModels,
  listResidentOllamaModels,
  warmOllamaModel,
} from "../sidecar/src/models/ollamaResidency";

// v2.4.8 follow-up (2026-09-07): the chat model stayed on the GPU when the
// user moved to Images, so the diffusion runtime ran in its slow offload path.
function fakeFetch(ps: unknown, generateStatus = 200) {
  const calls: Array<{ url: string; body?: string }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, body: typeof init?.body === "string" ? init.body : undefined });
    if (href.endsWith("/api/ps")) {
      return new Response(JSON.stringify(ps), { status: 200 });
    }
    return new Response("{}", { status: generateStatus });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("ollamaResidency", () => {
  it("lists resident models with their VRAM footprint", async () => {
    const { impl } = fakeFetch({
      models: [{ name: "gemma4:12b", size: 10, size_vram: 8 }, { model: "x:1" }],
    });
    expect(await listResidentOllamaModels("http://h", impl)).toEqual([
      { name: "gemma4:12b", sizeBytes: 10, sizeVramBytes: 8 },
      { name: "x:1", sizeBytes: 0, sizeVramBytes: 0 },
    ]);
  });

  it("evicts each resident model with keep_alive 0", async () => {
    const { impl, calls } = fakeFetch({ models: [{ name: "gemma4:12b" }] });
    expect(await evictOllamaModels("http://h", impl)).toEqual(["gemma4:12b"]);
    const generate = calls.find((c) => c.url.endsWith("/api/generate"));
    expect(generate?.body).toContain("\"keep_alive\":0");
    expect(generate?.body).toContain("gemma4:12b");
  });

  it("evicts only when the diffusion model would not fit beside the residents", async () => {
    const { impl, calls } = fakeFetch({ models: [{ name: "gemma4:12b" }] });
    // 7.7 GB free for a 6.9 GB model is under the 1.5x keep-on-GPU margin.
    expect(
      await evictOllamaIfTight({ freeVramGB: 7.7, modelVramGB: 6.9, baseUrl: "http://h", fetchImpl: impl }),
    ).toEqual(["gemma4:12b"]);
    calls.length = 0;
    expect(
      await evictOllamaIfTight({ freeVramGB: 14.9, modelVramGB: 6.9, baseUrl: "http://h", fetchImpl: impl }),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(
      await evictOllamaIfTight({ freeVramGB: null, modelVramGB: 6.9, baseUrl: "http://h", fetchImpl: impl }),
    ).toEqual([]);
  });

  it("warms a model with an empty prompt and reports the status", async () => {
    const { impl, calls } = fakeFetch({ models: [] });
    expect(await warmOllamaModel("gemma4:12b", "http://h", impl)).toEqual({ ok: true, status: 200 });
    expect(calls[0]?.body).toContain("\"prompt\":\"\"");
    expect(calls[0]?.body).not.toContain("keep_alive");
  });

  it("treats an unreachable Ollama as nothing resident", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await listResidentOllamaModels("http://h", down)).toEqual([]);
    expect(await evictOllamaModels("http://h", down)).toEqual([]);
    expect(await warmOllamaModel("m", "http://h", down)).toEqual({ ok: false, status: 0 });
  });
});
