/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- routable-runtime resolution.
 *
 * The security-relevant assertion here is that a `nexus.llm.localAdapters`
 * manifest declaring a non-loopback endpoint is DROPPED, so the gateway can
 * never be tricked into proxying an off-box inference server.
 */

import { describe, expect, it } from "vitest";

import {
  adapterFromManifest,
  builtinServingAdapters,
  resolveServingAdapters,
} from "../sidecar/src/serving/adapters";

const OLLAMA_MANIFEST = {
  name: "custom",
  protocol: "ollama" as const,
  endpoint: "http://127.0.0.1:11500",
};

describe("adapterFromManifest", () => {
  it("accepts a loopback ollama manifest", () => {
    const adapter = adapterFromManifest(OLLAMA_MANIFEST);
    expect(adapter?.name).toBe("custom");
    expect(adapter?.chat).toBe(true);
    expect(adapter?.createClient()).toBeDefined();
  });

  it("accepts a loopback openai manifest", () => {
    const adapter = adapterFromManifest({
      name: "mlx",
      protocol: "openai",
      endpoint: "http://127.0.0.1:8080",
    });
    expect(adapter?.createClient()).toBeDefined();
  });

  it.each([
    "http://192.168.1.10:11434",
    "http://example.com",
    "http://0.0.0.0:11434",
    "ftp://127.0.0.1:11434",
  ])("drops a manifest whose endpoint is %s", (endpoint) => {
    expect(adapterFromManifest({ ...OLLAMA_MANIFEST, endpoint })).toBeNull();
  });

  it("drops a structurally invalid manifest", () => {
    expect(adapterFromManifest({ name: "x" })).toBeNull();
    expect(adapterFromManifest({ ...OLLAMA_MANIFEST, protocol: "grpc" })).toBeNull();
    expect(adapterFromManifest(null)).toBeNull();
  });

  it("marks an embed-only manifest as not chat-capable", () => {
    const adapter = adapterFromManifest({
      ...OLLAMA_MANIFEST,
      capabilities: { chat: false, embed: true },
    });
    expect(adapter?.chat).toBe(false);
  });
});

describe("builtinServingAdapters", () => {
  it("ships loopback Ollama and LM Studio adapters", () => {
    expect(builtinServingAdapters({}).map((a) => a.name)).toEqual(["ollama", "lmstudio"]);
  });

  it("honours the NEXUS_OLLAMA_URL override", () => {
    const adapters = builtinServingAdapters({ NEXUS_OLLAMA_URL: "http://127.0.0.1:9999" });
    expect(adapters.map((a) => a.name)).toContain("ollama");
  });

  it("drops a built-in whose env override is not loopback", () => {
    const adapters = builtinServingAdapters({ NEXUS_OLLAMA_URL: "http://10.0.0.4:11434" });
    expect(adapters.map((a) => a.name)).toEqual(["lmstudio"]);
  });
});

describe("resolveServingAdapters", () => {
  it("returns just the built-ins when no user manifests exist", () => {
    expect(resolveServingAdapters(undefined, {}).map((a) => a.name)).toEqual([
      "ollama",
      "lmstudio",
    ]);
  });

  it("layers a user manifest on top of the built-ins", () => {
    const names = resolveServingAdapters([OLLAMA_MANIFEST], {}).map((a) => a.name);
    expect(names).toEqual(["ollama", "lmstudio", "custom"]);
  });

  it("lets a user manifest replace a built-in of the same name", () => {
    const adapters = resolveServingAdapters(
      [{ ...OLLAMA_MANIFEST, name: "ollama", endpoint: "http://127.0.0.1:1" }],
      {},
    );
    expect(adapters.map((a) => a.name)).toEqual(["ollama", "lmstudio"]);
  });

  it("skips a bad manifest without losing the good ones", () => {
    const names = resolveServingAdapters(
      [{ name: "bad", protocol: "ollama", endpoint: "http://8.8.8.8" }, OLLAMA_MANIFEST],
      {},
    ).map((a) => a.name);
    expect(names).toContain("custom");
    expect(names).not.toContain("bad");
  });

  it("ignores a non-array localAdapters value", () => {
    expect(resolveServingAdapters("nonsense", {}).map((a) => a.name)).toEqual([
      "ollama",
      "lmstudio",
    ]);
  });
});
