import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the two concrete client factories so `createClient` can be asserted
// without constructing a real network client. The factories themselves are
// covered by OllamaClient.test.ts / LmStudioClient.test.ts.
vi.mock("../../../modules/coding/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({ __kind: "ollama" })),
}));
vi.mock("../../../modules/coding/llm/LmStudioClient.js", () => ({
  createLmStudioClient: vi.fn(() => ({ __kind: "lmstudio" })),
}));

const {
  LocalAdapterRegistry,
  LocalAdapterError,
  createDefaultLocalAdapterRegistry,
  validateLocalAdapterManifest,
  isLoopbackEndpoint,
  OLLAMA_ADAPTER_NAME,
  LMSTUDIO_ADAPTER_NAME,
} = await import("../../../modules/coding/llm/LocalAdapterRegistry.js");
const { createOllamaClient } = await import(
  "../../../modules/coding/llm/OllamaClient.js"
);
const { createLmStudioClient } = await import(
  "../../../modules/coding/llm/LmStudioClient.js"
);

const validManifest = {
  name: "vllm",
  label: "vLLM",
  protocol: "openai" as const,
  endpoint: "http://127.0.0.1:8000",
  capabilities: { chat: true, embed: false },
};

describe("isLoopbackEndpoint", () => {
  it("accepts loopback IPv4, IPv6, and loopback hostnames", () => {
    expect(isLoopbackEndpoint("http://127.0.0.1:8000")).toBe(true);
    expect(isLoopbackEndpoint("http://127.5.6.7:1234")).toBe(true);
    expect(isLoopbackEndpoint("http://localhost:11434")).toBe(true);
    expect(isLoopbackEndpoint("http://ip6-localhost:1234")).toBe(true);
    expect(isLoopbackEndpoint("http://[::1]:1234")).toBe(true);
    expect(isLoopbackEndpoint("https://127.0.0.1")).toBe(true);
  });

  it("rejects LAN, public, malformed, and non-http endpoints", () => {
    // Stricter than ssrf.isBlockedIp: a *local runtime* must be loopback, not
    // a LAN host, so RFC-1918 addresses are rejected here.
    expect(isLoopbackEndpoint("http://192.168.1.5:11434")).toBe(false);
    expect(isLoopbackEndpoint("http://10.0.0.1:8000")).toBe(false);
    expect(isLoopbackEndpoint("http://example.com")).toBe(false);
    expect(isLoopbackEndpoint("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackEndpoint("file:///etc/passwd")).toBe(false);
    expect(isLoopbackEndpoint("not a url")).toBe(false);
  });
});

describe("validateLocalAdapterManifest", () => {
  it("accepts a structurally valid loopback manifest", () => {
    const result = validateLocalAdapterManifest(validManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe("vllm");
      expect(result.manifest.protocol).toBe("openai");
    }
  });

  it("rejects a structurally invalid manifest with a descriptive error", () => {
    const missingName = validateLocalAdapterManifest({
      protocol: "ollama",
      endpoint: "http://127.0.0.1:11434",
    });
    expect(missingName.ok).toBe(false);
    if (!missingName.ok) {
      expect(missingName.error).toMatch(/Invalid local-adapter manifest/);
    }

    const badProtocol = validateLocalAdapterManifest({
      name: "x",
      protocol: "grpc",
      endpoint: "http://127.0.0.1:11434",
    });
    expect(badProtocol.ok).toBe(false);

    // strict() rejects unknown keys.
    const extraKey = validateLocalAdapterManifest({
      ...validManifest,
      rogue: true,
    });
    expect(extraKey.ok).toBe(false);
  });

  it("rejects a non-local endpoint and cites the MCP Registry Policy", () => {
    const result = validateLocalAdapterManifest({
      name: "remote",
      protocol: "openai",
      endpoint: "https://api.example.com/v1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/non-local endpoint/);
      expect(result.error).toMatch(/MCP Registry Policy/);
      expect(result.error).toMatch(/AGENTS\.md/);
      expect(result.error).toContain("api.example.com");
    }
  });

  it("rejects a LAN endpoint even though it is a private address", () => {
    const result = validateLocalAdapterManifest({
      name: "lan",
      protocol: "ollama",
      endpoint: "http://192.168.1.50:11434",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/MCP Registry Policy/);
    }
  });
});

describe("LocalAdapterRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers, looks up, and lists a valid manifest", () => {
    const registry = new LocalAdapterRegistry();
    const manifest = registry.register(validManifest);
    expect(manifest.name).toBe("vllm");
    expect(registry.has("vllm")).toBe(true);
    expect(registry.get("vllm")?.protocol).toBe("openai");
    expect(registry.list().map((m) => m.name)).toEqual(["vllm"]);
  });

  it("throws LocalAdapterError when registering a non-local manifest", () => {
    const registry = new LocalAdapterRegistry();
    expect(() =>
      registry.register({
        name: "remote",
        protocol: "openai",
        endpoint: "https://api.example.com",
      }),
    ).toThrowError(LocalAdapterError);
    expect(() =>
      registry.register({
        name: "remote",
        protocol: "openai",
        endpoint: "https://api.example.com",
      }),
    ).toThrowError(/MCP Registry Policy/);
    expect(registry.has("remote")).toBe(false);
  });

  it("tryRegister does not throw and skips an invalid manifest", () => {
    const registry = new LocalAdapterRegistry();
    const result = registry.tryRegister({
      name: "remote",
      protocol: "openai",
      endpoint: "http://8.8.8.8:80",
    });
    expect(result.ok).toBe(false);
    expect(registry.has("remote")).toBe(false);
  });

  it("createClient maps each protocol to its factory and passes options", () => {
    const registry = new LocalAdapterRegistry();
    registry.register(validManifest); // protocol "openai"
    registry.register({
      name: "ollama-local",
      protocol: "ollama",
      endpoint: "http://127.0.0.1:11434",
    });

    registry.createClient("vllm", { baseUrl: "http://127.0.0.1:9001", timeoutMs: 5000 });
    expect(createLmStudioClient).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:9001",
      timeoutMs: 5000,
    });

    registry.createClient("ollama-local");
    // No override -> falls back to the manifest endpoint.
    expect(createOllamaClient).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:11434",
      timeoutMs: undefined,
    });
  });

  it("throws when building a client for an unregistered name", () => {
    const registry = new LocalAdapterRegistry();
    expect(() => registry.createClient("ghost")).toThrowError(LocalAdapterError);
    expect(() => registry.createClient("ghost")).toThrowError(/ghost/);
  });
});

describe("createDefaultLocalAdapterRegistry", () => {
  it("seeds the two built-in adapters with the expected protocols", () => {
    const registry = createDefaultLocalAdapterRegistry();
    expect(registry.has(OLLAMA_ADAPTER_NAME)).toBe(true);
    expect(registry.has(LMSTUDIO_ADAPTER_NAME)).toBe(true);
    expect(registry.get(OLLAMA_ADAPTER_NAME)?.protocol).toBe("ollama");
    expect(registry.get(LMSTUDIO_ADAPTER_NAME)?.protocol).toBe("openai");
    expect(registry.list()).toHaveLength(2);
  });
});
