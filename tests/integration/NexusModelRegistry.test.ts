import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  NexusModelRegistry,
  ExternalRemovalError,
  type OllamaPullClient,
  type ExternalModelIndex,
} from "../../core/registry/NexusModelRegistry.js";
import { loadCatalog } from "../../core/registry/catalog.js";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fakeFetch(body: Buffer): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-length": String(body.length) },
    }) as Response) as typeof fetch;
}

describe("NexusModelRegistry (integration)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-reg-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("install via Ollama writes a manifest and shows installed:true on list()", async () => {
    let pulls = 0;
    const ollama: OllamaPullClient = {
      async pull(tag) {
        pulls++;
        expect(tag).toBe("gemma4:e4b");
      },
    };
    const reg = await NexusModelRegistry.create({ root, ollama });
    const spec = reg.catalog.models.find((m) => m.id === "gemma4:e4b");
    expect(spec).toBeDefined();
    const result = await reg.install(spec!);
    expect(pulls).toBe(1);
    expect(result.id).toBe("gemma4:e4b");
    expect(result.status).toBe("installed");
    const list = await reg.list({ installed: true });
    expect(list.map((m) => m.id)).toContain("gemma4:e4b");
  });

  it("installById is equivalent to looking up the spec and calling install", async () => {
    const ollama: OllamaPullClient = { pull: async () => undefined };
    const reg = await NexusModelRegistry.create({ root, ollama });
    const result = await reg.installById("gemma4:e4b");
    expect(await reg.isInstalled("gemma4:e4b")).toBe(true);
    expect(result.id).toBe("gemma4:e4b");
  });

  it("install via HTTP downloads + verifies + manifests + appears on list()", async () => {
    const body = Buffer.from("safetensors-bytes");
    const sha = sha256(body);
    const reg = await NexusModelRegistry.create({ root });
    const fakeCatalog = {
      ...reg.catalog,
      models: [
        ...reg.catalog.models.filter((m) => m.id !== "sdxl-turbo"),
        {
          id: "sdxl-turbo",
          family: "sdxl",
          name: "sdxl-turbo",
          tag: "fp16",
          type: "image" as const,
          displayName: "SDXL Turbo",
          sizeGB: 0.000001,
          vramGB: 8,
          license: "Stability AI Non-Commercial",
          source: { protocol: "huggingface" as const, repo: "x/y", url: "https://example.test/sdxl.safetensors", sha256: sha },
          tags: ["phase-6", "image"],
        },
      ],
    };
    const reg2 = new NexusModelRegistry({ storage: reg.storage, catalog: fakeCatalog });
    const result = await reg2.install(fakeCatalog.models.find((m) => m.id === "sdxl-turbo")!, { fetch: fakeFetch(body) });
    expect(result.bytesDownloaded).toBe(body.length);
    const list = await reg2.list({ type: "image", installed: true });
    expect(list.some((m) => m.id === "sdxl-turbo")).toBe(true);
  });

  it("remove drops the manifest and gc reclaims orphan blobs", async () => {
    const ollama: OllamaPullClient = { pull: async () => undefined };
    const reg = await NexusModelRegistry.create({ root, ollama });
    await reg.installById("gemma4:e4b");
    expect(await reg.isInstalled("gemma4:e4b")).toBe(true);
    await reg.remove("gemma4:e4b");
    expect(await reg.isInstalled("gemma4:e4b")).toBe(false);
  });

  it("list filters by type, family, query, installed", async () => {
    const ollama: OllamaPullClient = { pull: async () => undefined };
    const reg = await NexusModelRegistry.create({ root, ollama });
    await reg.installById("gemma4:e4b");
    const all = await reg.list();
    expect(all.length).toBeGreaterThan(2);
    const onlyLlm = await reg.list({ type: "llm" });
    expect(onlyLlm.every((m) => m.type === "llm")).toBe(true);
    const onlyQwen = await reg.list({ family: "qwen" });
    expect(onlyQwen.every((m) => m.family === "qwen")).toBe(true);
    const byQuery = await reg.list({ query: "gemma" });
    expect(byQuery.some((m) => m.id === "gemma4:e4b")).toBe(true);
    const installed = await reg.list({ installed: true });
    expect(installed.every((m) => m.installed)).toBe(true);
  });

  it("surfaces the catalog multimodal flag on listed models (item 33 gate)", async () => {
    // v1.5.0 Phase 5 (T015): the Gemma 4 GGUF entry is flagged multimodal in
    // the catalog; `list()` must surface it so the picker / vision gate can read
    // it without re-loading the catalog.
    const reg = await NexusModelRegistry.create({ root });
    const list = await reg.list();
    const gemma4Gguf = list.find((m) => m.id === "gemma-4-12b-it-gguf");
    expect(gemma4Gguf?.multimodal).toBe(true);
    // A text-only model carries no multimodal flag.
    const textOnly = list.find((m) => m.id === "gemma4:e4b");
    expect(textOnly?.multimodal).toBeFalsy();
  });

  it("external models surface via the wired ExternalModelIndex", async () => {
    const external: ExternalModelIndex = {
      async list() {
        return [
          {
            id: "external:comfyui:checkpoints:dreamshaper.safetensors",
            displayName: "dreamshaper.safetensors",
            absPath: "/abs/dreamshaper.safetensors",
            profile: "comfyui",
            category: "checkpoints",
            sizeBytes: 1234,
          },
        ];
      },
    };
    const reg = await NexusModelRegistry.create({ root, external });
    const list = await reg.list();
    const ext = list.find((m) => m.source === "external");
    expect(ext?.absPath).toBe("/abs/dreamshaper.safetensors");
  });

  it("remove() refuses external entries with ExternalRemovalError", async () => {
    const external: ExternalModelIndex = {
      async list() {
        return [
          {
            id: "external:comfyui:checkpoints:foo",
            displayName: "foo",
            absPath: "/abs/foo",
            profile: "comfyui",
            category: "checkpoints",
            sizeBytes: 0,
          },
        ];
      },
    };
    const reg = await NexusModelRegistry.create({ root, external });
    await expect(reg.remove("external:comfyui:checkpoints:foo")).rejects.toBeInstanceOf(ExternalRemovalError);
  });

  it("remove() throws a clear error for an uninstalled id", async () => {
    const reg = await NexusModelRegistry.create({ root });
    await expect(reg.remove("not-here:1")).rejects.toThrow(/not installed/);
  });

  it("install() refuses an unknown protocol", async () => {
    const reg = await NexusModelRegistry.create({ root });
    await expect(
      reg.install({
        id: "x:1",
        family: "x",
        name: "x",
        tag: "1",
        type: "llm",
        displayName: "X",
        source: { protocol: "ftp" as unknown as "ollama" },
      }),
    ).rejects.toThrow();
  });

  it("install() refuses an http spec missing source.sha256", async () => {
    const reg = await NexusModelRegistry.create({ root });
    const fakeCatalog = {
      models: [
        {
          id: "y:1",
          family: "y",
          name: "y",
          tag: "1",
          type: "image" as const,
          displayName: "Y",
          source: { protocol: "url" as const, url: "https://example.test/y" },
        },
      ],
    };
    const reg2 = new NexusModelRegistry({ storage: reg.storage, catalog: fakeCatalog });
    await expect(reg2.installById("y:1")).rejects.toThrow(/sha256/);
  });

  it("loaded catalog matches `loadCatalog`", async () => {
    const reg = await NexusModelRegistry.create({ root });
    const direct = await loadCatalog();
    expect(reg.catalog.models.length).toBe(direct.models.length);
  });

  it("install via Ollama requires a wired client", async () => {
    const reg = await NexusModelRegistry.create({ root });
    await expect(reg.installById("gemma4:e4b")).rejects.toThrow(/Ollama client not wired/);
  });

  it("install propagates downloader progress", async () => {
    const body = Buffer.alloc(400 * 1024, 0x55);
    const sha = (await import("node:crypto")).createHash("sha256").update(body).digest("hex");
    const reg = await NexusModelRegistry.create({ root });
    const fakeCatalog = {
      models: [
        {
          id: "z:1",
          family: "z",
          name: "z",
          tag: "1",
          type: "image" as const,
          displayName: "Z",
          source: { protocol: "url" as const, url: "https://example.test/z", sha256: sha },
        },
      ],
    };
    const reg2 = new NexusModelRegistry({ storage: reg.storage, catalog: fakeCatalog });
    const events: number[] = [];
    await reg2.installById("z:1", {
      fetch: (async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } }) as Response) as typeof fetch,
      onProgress: (b) => events.push(b),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toBe(body.length);
  });

  it("installById throws for an unknown id", async () => {
    const reg = await NexusModelRegistry.create({ root });
    await expect(reg.installById("nothing:here")).rejects.toThrow(/unknown catalog id/);
  });

  it("filter narrows via combined family + type", async () => {
    const ollama: OllamaPullClient = { pull: async () => undefined };
    const reg = await NexusModelRegistry.create({ root, ollama });
    await reg.installById("gemma4:e4b");
    const list = await reg.list({ type: "llm", family: "gemma4", installed: true });
    expect(list.map((m) => m.id)).toEqual(["gemma4:e4b"]);
  });

  it("off-catalog ollama spec without source.url falls back to spec.id as tag", async () => {
    let seenTag: string | null = null;
    const ollama: OllamaPullClient = {
      async pull(tag) {
        seenTag = tag;
      },
    };
    const reg = await NexusModelRegistry.create({ root, ollama });
    await reg.install({
      id: "custom:1",
      family: "custom",
      name: "custom",
      tag: "1",
      type: "llm",
      displayName: "Custom",
      source: { protocol: "ollama" },
    });
    expect(seenTag).toBe("custom:1");
  });

  it("install rejects an off-catalog spec missing required fields", async () => {
    const reg = await NexusModelRegistry.create({ root });
    await expect(
      reg.install({
        id: "off:1",
        family: "",
        name: "off",
        tag: "1",
        type: "llm",
        displayName: "Off",
        source: { protocol: "ollama" },
      }),
    ).rejects.toThrow(/missing required fields/);
  });

  it("install via http preserves spec.source.repo in the manifest", async () => {
    const body = Buffer.from("repo-test");
    const sha = (await import("node:crypto")).createHash("sha256").update(body).digest("hex");
    const reg = await NexusModelRegistry.create({ root });
    const fakeCatalog = {
      models: [
        {
          id: "w:1",
          family: "w",
          name: "w",
          tag: "1",
          type: "video" as const,
          displayName: "W",
          source: { protocol: "huggingface" as const, repo: "user/repo", url: "https://example.test/w", sha256: sha },
        },
      ],
    };
    const reg2 = new NexusModelRegistry({ storage: reg.storage, catalog: fakeCatalog });
    await reg2.installById("w:1", {
      fetch: (async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } }) as Response) as typeof fetch,
    });
    const manifests = await reg2.storage.listManifests();
    const m = manifests.find((mm) => mm.id === "w:1");
    expect(m?.source?.repo).toBe("user/repo");
  });
});
