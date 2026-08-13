/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- model listing + adapter resolution.
 *
 * Asserts the gateway only advertises models the caller can actually run, and
 * that the two "cannot serve this" cases stay distinguishable: not installed vs
 * installed-but-no-runtime-loaded.
 */

import { describe, expect, it } from "vitest";

import type { LLMClient, LLMModel } from "../../modules/coding/llm/types";
import type { ListedModelDto } from "../sidecar/src/models/modelsService";
import type { ServingAdapter } from "../sidecar/src/serving/adapters";
import { ModelRouter } from "../sidecar/src/serving/modelRouter";

function model(over: Partial<ListedModelDto> = {}): ListedModelDto {
  return {
    id: "gemma-4-12b",
    displayName: "Gemma 4 12B",
    tag: "gemma4:12b",
    type: "llm",
    installed: true,
    source: "registry",
    ...over,
  };
}

/** An `LLMClient` that reports a fixed loaded-model list and streams nothing. */
function clientWith(names: readonly string[], failList = false): LLMClient {
  return {
    async checkHealth() {
      return true;
    },
    async listModels(): Promise<LLMModel[]> {
      if (failList) throw new Error("runtime not running");
      return names.map((name) => ({ name, modified_at: "", size: 0 }));
    },
    async *streamChat() {
      yield { message: { role: "assistant", content: "" }, done: true };
    },
  };
}

/**
 * Adapters whose `createClient` returns injected fakes, so routing is tested
 * without any real Ollama / LM Studio process.
 */
function fakeAdapters(
  clients: Record<string, LLMClient>,
  chat = true,
): () => readonly ServingAdapter[] {
  const adapters = Object.entries(clients).map(([name, client]) => ({
    name,
    chat,
    createClient: () => client,
  }));
  return () => adapters;
}

describe("ModelRouter.listModels", () => {
  it("lists installed registry and external chat models", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [
        model(),
        model({ id: "lmstudio-local", tag: undefined, source: "external" }),
      ],
      adapters: fakeAdapters({}),
    });
    const listed = await router.listModels();
    expect(listed.map((m) => m.id)).toEqual(["gemma-4-12b", "lmstudio-local"]);
    expect(listed[1]?.ownedBy).toBe("external");
  });

  it("excludes not-installed and catalog-only rows", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [
        model({ id: "not-installed", installed: false }),
        model({ id: "catalog-only", source: "catalog-only" }),
      ],
      adapters: fakeAdapters({}),
    });
    expect(await router.listModels()).toEqual([]);
  });

  it("excludes non-LLM model types", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [
        model({ id: "sana", type: "image" }),
        model({ id: "whisper", type: "audio" }),
        model({ id: "embedder", type: "embed" }),
      ],
      adapters: fakeAdapters({}),
    });
    expect(await router.listModels()).toEqual([]);
  });

  it("dedupes repeated ids", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [model(), model()],
      adapters: fakeAdapters({}),
    });
    expect(await router.listModels()).toHaveLength(1);
  });
});

describe("ModelRouter.resolve", () => {
  it("resolves an installed model to the adapter that has it loaded", async () => {
    const ollama = clientWith(["gemma4:12b"]);
    const router = new ModelRouter({
      listInstalled: async () => [model()],
      adapters: fakeAdapters({ ollama }),
    });
    const resolved = await router.resolve("gemma-4-12b");
    expect(resolved.adapter).toBe("ollama");
    expect(resolved.modelName).toBe("gemma4:12b");
    expect(resolved.client).toBe(ollama);
  });

  it("accepts the tag as well as the id", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [model()],
      adapters: fakeAdapters({ ollama: clientWith(["gemma4:12b"]) }),
    });
    expect((await router.resolve("gemma4:12b")).modelName).toBe("gemma4:12b");
  });

  it("skips an unreachable adapter and falls through to a working one", async () => {
    const working = clientWith(["gemma4:12b"]);
    const router = new ModelRouter({
      listInstalled: async () => [model()],
      adapters: fakeAdapters({
        dead: clientWith([], true),
        alive: working,
      }),
    });
    expect((await router.resolve("gemma-4-12b")).adapter).toBe("alive");
  });

  it("reports model_not_found for a model that is not installed", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [],
      adapters: fakeAdapters({ ollama: clientWith(["gemma4:12b"]) }),
    });
    await expect(router.resolve("ghost")).rejects.toMatchObject({
      status: 404,
      code: "model_not_found",
    });
  });

  it("reports model_not_loaded when installed but no runtime serves it", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [model()],
      adapters: fakeAdapters({ ollama: clientWith(["something-else"]) }),
    });
    await expect(router.resolve("gemma-4-12b")).rejects.toMatchObject({
      status: 404,
      code: "model_not_loaded",
    });
  });

  it("ignores an adapter that is not chat-capable", async () => {
    const router = new ModelRouter({
      listInstalled: async () => [model()],
      adapters: fakeAdapters({ embedOnly: clientWith(["gemma4:12b"]) }, false),
    });
    await expect(router.resolve("gemma-4-12b")).rejects.toMatchObject({
      code: "model_not_loaded",
    });
  });
});
