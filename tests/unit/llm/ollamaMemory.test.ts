// v1.16.0 Phase 2.3 (adoption item A2) -- Ollama /api/ps memory probe.
//
// The probe is read synchronously from a streaming generator's `finally`, so the
// contract under test is: never block, never throw, and report null rather than a
// guess when the reading is not there yet.

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MEMORY_TTL_MS,
  createOllamaMemoryProbe,
  parsePsResponse,
} from "../../../modules/coding/llm/ollamaMemory.js";

const PS_BODY = {
  models: [
    { name: "gemma4:12b", size: 9_000_000_000, size_vram: 8_000_000_000 },
    { name: "qwen3:8b", size: 5_000_000_000, size_vram: 0 },
  ],
};

/** A fake OllamaHttp exposing only `get`, resolving the given JSON. */
function fakeHttp(body: unknown, ok = true): { get: () => Promise<Response> } {
  return {
    get: async () => ({ ok, json: async () => body }) as unknown as Response,
  };
}

/** Await the probe's fire-and-forget background refresh. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("parsePsResponse", () => {
  it("prefers VRAM residency", () => {
    expect(parsePsResponse(PS_BODY).get("gemma4:12b")).toBe(8_000_000_000);
  });

  it("falls back to total size for a CPU-resident model", () => {
    expect(parsePsResponse(PS_BODY).get("qwen3:8b")).toBe(5_000_000_000);
  });

  it("accepts the `model` key as a name alias", () => {
    expect(parsePsResponse({ models: [{ model: "m", size: 10 }] }).get("m")).toBe(10);
  });

  it("skips entries with no usable size", () => {
    expect(parsePsResponse({ models: [{ name: "m" }] }).size).toBe(0);
  });

  it("skips entries with no name", () => {
    expect(parsePsResponse({ models: [{ size: 10 }] }).size).toBe(0);
  });

  it.each([null, undefined, 42, "text", {}, { models: "nope" }])(
    "returns an empty map for the malformed payload %s",
    (raw) => {
      expect(parsePsResponse(raw).size).toBe(0);
    },
  );
});

describe("createOllamaMemoryProbe", () => {
  it("returns null on the first read, then the cached value", async () => {
    const probe = createOllamaMemoryProbe(fakeHttp(PS_BODY));
    expect(probe("gemma4:12b")).toBeNull();
    await settle();
    expect(probe("gemma4:12b")).toBe(8_000_000_000);
  });

  it("resolves an untagged id via a tag-prefix match", async () => {
    const probe = createOllamaMemoryProbe(fakeHttp(PS_BODY));
    probe("gemma4");
    await settle();
    expect(probe("gemma4")).toBe(8_000_000_000);
  });

  it("returns null for a model that is not loaded", async () => {
    const probe = createOllamaMemoryProbe(fakeHttp(PS_BODY));
    probe("absent");
    await settle();
    expect(probe("absent")).toBeNull();
  });

  it("serves from cache inside the TTL without re-fetching", async () => {
    const get = vi.fn(async () => ({ ok: true, json: async () => PS_BODY }) as unknown as Response);
    let clock = 1000;
    const probe = createOllamaMemoryProbe({ get }, { now: () => clock });
    probe("gemma4:12b");
    await settle();
    expect(get).toHaveBeenCalledTimes(1);

    clock += DEFAULT_MEMORY_TTL_MS - 1;
    probe("gemma4:12b");
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("refreshes once the TTL expires", async () => {
    const get = vi.fn(async () => ({ ok: true, json: async () => PS_BODY }) as unknown as Response);
    let clock = 1000;
    const probe = createOllamaMemoryProbe({ get }, { now: () => clock });
    probe("gemma4:12b");
    await settle();

    clock += DEFAULT_MEMORY_TTL_MS + 1;
    probe("gemma4:12b");
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("never throws when Ollama is unreachable", async () => {
    const probe = createOllamaMemoryProbe({
      get: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(() => probe("gemma4:12b")).not.toThrow();
    await settle();
    expect(probe("gemma4:12b")).toBeNull();
  });

  it("ignores a non-OK response", async () => {
    const probe = createOllamaMemoryProbe(fakeHttp(PS_BODY, false));
    probe("gemma4:12b");
    await settle();
    expect(probe("gemma4:12b")).toBeNull();
  });

  it("keeps a stale reading when a later refresh fails", async () => {
    let fail = false;
    const probe = createOllamaMemoryProbe(
      {
        get: async () => {
          if (fail) throw new Error("gone");
          return ({ ok: true, json: async () => PS_BODY }) as unknown as Response;
        },
      },
      { now: () => (fail ? 1_000_000 : 0) },
    );
    probe("gemma4:12b");
    await settle();
    expect(probe("gemma4:12b")).toBe(8_000_000_000);

    fail = true;
    probe("gemma4:12b");
    await settle();
    // Stale beats nothing for an analytics panel.
    expect(probe("gemma4:12b")).toBe(8_000_000_000);
  });

  it("does not stack concurrent refreshes", async () => {
    let resolveGet: ((r: Response) => void) | null = null;
    const get = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const probe = createOllamaMemoryProbe({ get });
    probe("gemma4:12b");
    probe("gemma4:12b");
    probe("gemma4:12b");
    expect(get).toHaveBeenCalledTimes(1);
    resolveGet?.({ ok: true, json: async () => PS_BODY } as unknown as Response);
    await settle();
  });
});
