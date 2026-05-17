import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryModelRegistry,
  type ModelRecord,
} from "../../../../core/registry/ModelRegistry.js";

const SAMPLE: readonly ModelRecord[] = [
  { id: "gemma4:e4b", displayName: "Gemma 4 E4B", family: "gemma", runtime: "ollama", vramGb: 6 },
  { id: "qwen2.5:7b", displayName: "Qwen 2.5 7B", family: "qwen", runtime: "ollama", vramGb: 8 },
  { id: "sdxl-turbo", displayName: "SDXL Turbo", family: "sdxl", runtime: "diffusion", vramGb: 8 },
];

describe("InMemoryModelRegistry", () => {
  let registry: InMemoryModelRegistry;
  beforeEach(() => {
    registry = new InMemoryModelRegistry(SAMPLE);
  });

  it("list() returns every record when no filter is supplied", () => {
    const all = registry.list();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.id)).toEqual(["gemma4:e4b", "qwen2.5:7b", "sdxl-turbo"]);
  });

  it("list() filters by family", () => {
    const out = registry.list({ family: "gemma" });
    expect(out.map((r) => r.id)).toEqual(["gemma4:e4b"]);
  });

  it("list() filters by runtime", () => {
    const out = registry.list({ runtime: "diffusion" });
    expect(out.map((r) => r.id)).toEqual(["sdxl-turbo"]);
  });

  it("install() registers an unknown spec", async () => {
    const result = await registry.install({ id: "new-model", source: { kind: "ollama" } });
    expect(result.status).toBe("queued");
    expect(registry.list()).toHaveLength(4);
    expect(registry.metadata("new-model").id).toBe("new-model");
    expect(registry.metadata("new-model").installedAt).toBeDefined();
  });

  it("install() is idempotent on a known id", async () => {
    await registry.install({ id: "gemma4:e4b", source: { kind: "ollama" } });
    expect(registry.list()).toHaveLength(3);
  });

  it("remove() drops the record", async () => {
    await registry.remove("gemma4:e4b");
    expect(registry.list().map((r) => r.id)).not.toContain("gemma4:e4b");
  });

  it("metadata() throws for an unknown id", () => {
    expect(() => registry.metadata("nope")).toThrowError(/unknown model id nope/);
  });

  it("metadata() returns a defensive copy (mutating the result does not affect the store)", () => {
    const meta = registry.metadata("gemma4:e4b");
    meta.displayName = "MUTATED";
    expect(registry.metadata("gemma4:e4b").displayName).toBe("Gemma 4 E4B");
  });

  it("default constructor seeds the recommended gemma4:e4b entry", () => {
    const fresh = new InMemoryModelRegistry();
    const all = fresh.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("gemma4:e4b");
  });
});
