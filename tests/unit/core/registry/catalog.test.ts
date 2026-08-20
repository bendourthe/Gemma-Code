import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadCatalog,
  validateCatalog,
  validateSpec,
  findSpec,
  getSpec,
  type CatalogFile,
  type ModelSpec,
} from "../../../../core/registry/catalog.js";

describe("catalog", () => {
  it("loads the bundled core/registry/catalog.json", async () => {
    const file = await loadCatalog();
    expect(file.models.length).toBeGreaterThan(0);
    const ids = new Set(file.models.map((m) => m.id));
    expect(ids.size).toBe(file.models.length);
  });

  it("the bundled catalog has at least one recommended LLM and the embed model", async () => {
    const file = await loadCatalog();
    const recommended = file.models.filter((m) => (m.tags ?? []).includes("recommended"));
    expect(recommended.some((m) => m.type === "llm")).toBe(true);
    expect(file.models.find((m) => m.id === "nomic-embed-text")).toBeDefined();
  });

  it("validateSpec accepts a well-formed ollama entry", () => {
    const spec: ModelSpec = {
      id: "x:1",
      family: "x",
      name: "x",
      tag: "1",
      type: "llm",
      displayName: "X 1",
      source: { protocol: "ollama", url: "ollama://x:1" },
    };
    expect(() => validateSpec(spec)).not.toThrow();
  });

  it("validateSpec rejects missing identity", () => {
    expect(() => validateSpec({ id: "", family: "", name: "", tag: "", type: "llm", displayName: "", source: { protocol: "ollama" } } as ModelSpec)).toThrow();
  });

  it("validateSpec rejects unsupported type", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "hologram" as ModelSpec["type"],
        displayName: "X",
        source: { protocol: "ollama" },
      }),
    ).toThrow(/invalid type/);
  });

  it("validateSpec accepts the audio type (v1.9.0 Phase 4)", () => {
    const spec: ModelSpec = {
      id: "kokoro",
      family: "kokoro",
      name: "kokoro",
      tag: "v1",
      type: "audio",
      task: "audio",
      displayName: "Kokoro",
      source: {
        protocol: "huggingface",
        url: "https://huggingface.co/x/resolve/main/kokoro.pth",
      },
    };
    expect(() => validateSpec(spec)).not.toThrow();
  });

  it("validateSpec requires url for non-ollama protocols", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "image",
        displayName: "X",
        source: { protocol: "huggingface" },
      }),
    ).toThrow(/requires source\.url/);
  });

  it("validateSpec rejects malformed source.sha256", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "image",
        displayName: "X",
        source: { protocol: "url", url: "https://x/y", sha256: "nope" },
      }),
    ).toThrow(/malformed source\.sha256/);
  });

  it("validateCatalog rejects duplicate ids", () => {
    const cat: CatalogFile = {
      models: [
        { id: "x", family: "x", name: "x", tag: "1", type: "llm", displayName: "X", source: { protocol: "ollama" } },
        { id: "x", family: "x", name: "x", tag: "2", type: "llm", displayName: "X2", source: { protocol: "ollama" } },
      ],
    };
    expect(() => validateCatalog(cat)).toThrow(/duplicate id/);
  });

  it("validateCatalog rejects a missing models array", () => {
    expect(() => validateCatalog({} as CatalogFile)).toThrow();
  });

  it("loadCatalog rejects an invalid JSON file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-cat-"));
    try {
      const file = path.join(tmp, "catalog.json");
      await fs.writeFile(file, JSON.stringify({ models: [{ id: "a" }] }));
      await expect(loadCatalog(file)).rejects.toThrow();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("findSpec / getSpec resolve by id", async () => {
    const file = await loadCatalog();
    expect(findSpec(file, "gemma4:e4b")?.id).toBe("gemma4:e4b");
    expect(getSpec(file, "gemma4:e4b").id).toBe("gemma4:e4b");
    expect(findSpec(file, "nope:1")).toBeUndefined();
    expect(() => getSpec(file, "nope:1")).toThrow();
  });

  it("registers the Gemma 4 12B entry routed to the Ollama registry (v1.13.0 Phase 1)", async () => {
    const file = await loadCatalog();
    const gguf = findSpec(file, "gemma-4-12b-it-gguf");
    expect(gguf).toBeDefined();
    expect(gguf?.type).toBe("llm");
    expect(gguf?.family).toBe("gemma4");
    // Item 32 acceptance: 256K context + native multimodal flag for Phase 5.
    expect(gguf?.contextWindow).toBe(262_144);
    expect(gguf?.multimodal).toBe(true);
    // v1.13.0: routed to the Ollama-registry gemma4:12b tag, off the Unsloth
    // hf.co GGUF path that failed Ollama manifest registration (bug #15447).
    expect(gguf?.source.protocol).toBe("ollama");
    expect(gguf?.source.url).toBe("ollama://gemma4:12b");
    expect(gguf?.tags).toContain("recommended");
    expect(gguf?.tags).toContain("multimodal");
  });

  it("validateSpec accepts the controlnet + vae types introduced in v1.1.0 Phase 12", () => {
    const cn: ModelSpec = {
      id: "cn:x",
      family: "sana",
      name: "sana-controlnet",
      tag: "pose",
      type: "controlnet",
      displayName: "SANA-ControlNet Pose",
      source: {
        protocol: "huggingface",
        url: "https://huggingface.co/x/resolve/main/y.safetensors",
      },
    };
    expect(() => validateSpec(cn)).not.toThrow();
    const vae: ModelSpec = {
      id: "vae:x",
      family: "sana",
      name: "dc-ae",
      tag: "f32c32",
      type: "vae",
      displayName: "DC-AE",
      source: {
        protocol: "huggingface",
        url: "https://huggingface.co/x/resolve/main/y.safetensors",
      },
    };
    expect(() => validateSpec(vae)).not.toThrow();
  });

  it("validateSpec rejects an invalid task (v1.8.0 Phase 4)", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "llm",
        task: "banter" as ModelSpec["task"],
        displayName: "X",
        source: { protocol: "ollama" },
      }),
    ).toThrow(/invalid task/);
  });

  it("validateSpec requires provenance on uncensored entries (v1.8.0 Phase 4)", () => {
    expect(() =>
      validateSpec({
        id: "x", family: "x", name: "x", tag: "1",
        type: "image",
        task: "image",
        displayName: "X",
        uncensored: true,
        source: { protocol: "huggingface", url: "https://x/y" },
      }),
    ).toThrow(/provenance/);
  });

  it("validateSpec accepts optional toolCallingVerified + MoE fields (v1.18.0 Phase 3)", () => {
    const spec: ModelSpec = {
      id: "x:1",
      family: "x",
      name: "x",
      tag: "1",
      type: "llm",
      displayName: "X 1",
      source: { protocol: "ollama", url: "ollama://x:1" },
      toolCallingVerified: true,
      toolCallingBenchmark: {
        suite: "nexus-catalog-agentic-flag",
        date: "2026-08-17",
        result: "pass",
      },
      activeParams: 2.4,
      totalParams: 16,
    };
    expect(() => validateSpec(spec)).not.toThrow();
  });

  it("validateSpec rejects toolCallingVerified without provenance", () => {
    expect(() =>
      validateSpec({
        id: "x:1",
        family: "x",
        name: "x",
        tag: "1",
        type: "llm",
        displayName: "X",
        source: { protocol: "ollama" },
        toolCallingVerified: true,
      } as ModelSpec),
    ).toThrow(/toolCallingBenchmark/);
  });

  it("validateSpec rejects inverted MoE params", () => {
    expect(() =>
      validateSpec({
        id: "x:1",
        family: "x",
        name: "x",
        tag: "1",
        type: "llm",
        displayName: "X",
        source: { protocol: "ollama" },
        activeParams: 20,
        totalParams: 8,
      } as ModelSpec),
    ).toThrow(/exceeds totalParams/);
  });

  it("bundled catalog remains valid after the additive v1.18 schema and flags agentic defaults", async () => {
    const file = await loadCatalog();
    expect(() => validateCatalog(file)).not.toThrow();
    const verified = file.models.filter((m) => m.toolCallingVerified === true);
    expect(verified.length).toBeGreaterThanOrEqual(2);
    for (const spec of verified) {
      expect(spec.agentic).toBe(true);
      expect(spec.toolCallingBenchmark?.suite).toBeTruthy();
    }
    const denseUnflagged = file.models.find((m) => m.id === "llama3.1:8b");
    expect(denseUnflagged?.toolCallingVerified).toBeUndefined();
    expect(denseUnflagged?.activeParams).toBeUndefined();
    const moe = file.models.find((m) => m.id === "deepseek-coder-v2:16b");
    expect(moe?.activeParams).toBe(2.4);
    expect(moe?.totalParams).toBe(16);
  });

  it("bundled catalog carries the Phase 4 curated uncensored image/video entries", async () => {
    const file = await loadCatalog();
    const byId = new Map(file.models.map((m) => [m.id, m]));
    const expectations: Array<[string, ModelSpec["type"], string]> = [
      ["juggernaut-xl-v9", "image", "CreativeML Open RAIL-M"],
      ["realvisxl-v5", "image", "OpenRAIL++"],
      ["wan2.1-t2v-1.3b", "video", "Apache-2.0"],
      ["wan2.2-ti2v-5b", "video", "Apache-2.0"],
    ];
    for (const [id, type, licensePrefix] of expectations) {
      const entry = byId.get(id);
      expect(entry, `${id} should exist`).toBeDefined();
      expect(entry?.type).toBe(type);
      expect(entry?.uncensored).toBe(true);
      expect(entry?.provenance, `${id} must record provenance`).toBeTruthy();
      expect(entry?.license?.startsWith(licensePrefix)).toBe(true);
      expect(entry?.source.protocol).toBe("huggingface");
      expect(entry?.weights?.files.length).toBeGreaterThan(0);
    }
  });

  it("every user-facing bundled entry carries a task and the Phase 4 copy fields", async () => {
    const file = await loadCatalog();
    const userFacing = file.models.filter(
      (m) => m.type !== "vae" && m.type !== "controlnet",
    );
    for (const entry of userFacing) {
      expect(entry.task, `${entry.id} missing task`).toBeDefined();
      expect(entry.strengths?.length, `${entry.id} missing strengths`).toBeGreaterThan(0);
      expect(entry.differentiators, `${entry.id} missing differentiators`).toBeTruthy();
    }
    // Chat/agentic split exists in the shipped data.
    expect(userFacing.some((m) => m.task === "chat")).toBe(true);
    expect(userFacing.some((m) => m.task === "agentic")).toBe(true);
  });

  it("bundled catalog carries the full SANA family from Phase 12", async () => {
    const file = await loadCatalog();
    const ids = new Set(file.models.map((m) => m.id));
    expect(ids).toEqual(
      expect.objectContaining({}),
    );
    // sub-task 12.1 acceptance: every SANA entry registered
    for (const id of [
      "sana-1.6b-1024",
      "sana-sprint-1024",
      "sana-1.6b-2k",
      "sana-1.6b-4k",
      "sana-1.6b-int4",
      "dc-ae-f32c32-sana-1.1",
      "sana-controlnet-pose",
      "sana-controlnet-depth",
      "sana-controlnet-canny",
      "sana-video-2b-720p",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    const dcae = file.models.find((m) => m.id === "dc-ae-f32c32-sana-1.1");
    expect(dcae?.type).toBe("vae");
    const cnPose = file.models.find((m) => m.id === "sana-controlnet-pose");
    expect(cnPose?.type).toBe("controlnet");
    const sana = file.models.find((m) => m.id === "sana-1.6b-1024");
    expect(sana?.type).toBe("image");
    expect(sana?.license).toBe("Apache-2.0");
    const sanaInt4 = file.models.find((m) => m.id === "sana-1.6b-int4");
    expect(sanaInt4?.runtimeDeps).toEqual(["nunchaku"]);
  });

  it("carries the v1.9.0 Phase 4 audio pillar (speech + generation)", async () => {
    const file = await loadCatalog();
    const byId = new Map(file.models.map((m) => [m.id, m]));
    const speech: Array<[string, string]> = [
      ["faster-whisper-large-v3", "MIT"],
      ["kokoro-82m", "Apache-2.0"],
      ["piper-en-us-lessac", "MIT"],
    ];
    const generation = ["musicgen-medium", "stable-audio-open-1.0"];
    for (const [id, licensePrefix] of speech) {
      const entry = byId.get(id);
      expect(entry, `${id} should exist`).toBeDefined();
      expect(entry?.type).toBe("audio");
      expect(entry?.task).toBe("audio");
      expect(entry?.license?.startsWith(licensePrefix)).toBe(true);
      // Speech models are CPU-capable (compatible on any host).
      expect(entry?.requiredVramGB ?? 0).toBe(0);
      expect(entry?.source.protocol).toBe("huggingface");
      expect(entry?.weights?.files.length).toBeGreaterThan(0);
    }
    for (const id of generation) {
      const entry = byId.get(id);
      expect(entry, `${id} should exist`).toBeDefined();
      expect(entry?.type).toBe("audio");
      expect(entry?.license, `${id} must record a license`).toBeTruthy();
    }
  });

  it("populates origin on every user-facing entry (v1.9.0 Phase 4)", async () => {
    const file = await loadCatalog();
    const userFacing = file.models.filter(
      (m) => m.type !== "vae" && m.type !== "controlnet",
    );
    for (const entry of userFacing) {
      expect(entry.origin, `${entry.id} missing origin`).toBeTruthy();
    }
  });

  it("flags the agentic-capable models (Gemma 4 family + coders)", async () => {
    const file = await loadCatalog();
    const byId = new Map(file.models.map((m) => [m.id, m]));
    const agentic = [
      "gemma4:e2b",
      "gemma4:e4b",
      "gemma4:26b",
      "gemma4:31b",
      "gemma-4-12b-it-gguf",
      "qwen2.5-coder:7b",
      "qwen2.5-coder:14b",
      "deepseek-coder-v2:16b",
      "lfm2.5:2.6b",
      "hermes3:8b",
      "hermes3:70b",
    ];
    for (const id of agentic) {
      expect(byId.get(id)?.agentic, `${id} should be agentic-capable`).toBe(true);
    }
    // A general chat model that is not agentic-coding-capable is not flagged.
    expect(byId.get("llama3.1:8b")?.agentic ?? false).toBe(false);
    // The Gemma 4 family keeps its primary task as chat (surfaced in both tabs).
    expect(byId.get("gemma4:e4b")?.task).toBe("chat");
  });

  it("curates LFM2.5-2.6B as the low-VRAM agentic entry (v1.19.0 Phase 1)", async () => {
    const file = await loadCatalog();
    const lfm = findSpec(file, "lfm2.5:2.6b");
    expect(lfm).toBeDefined();
    expect(lfm?.type).toBe("llm");
    expect(lfm?.task).toBe("agentic");
    expect(lfm?.agentic).toBe(true);
    expect(lfm?.origin).toBe("USA");
    expect(lfm?.sizeGB).toBe(1.67);
    expect(lfm?.vramGB).toBe(3);
    expect(lfm?.contextWindow).toBe(128_000);
    expect(lfm?.toolCallingVerified).toBe(true);
    expect(lfm?.toolCallingBenchmark?.suite).toBe("nexus-harness-ab-lfm-local");
    expect(lfm?.license).toBe("LFM Open License v1.0");
    expect(lfm?.licenseUrl).toMatch(/^https:\/\//);
    expect(lfm?.licenseNote).toMatch(/10M/i);
    expect(lfm?.licenseNote).toMatch(/use restriction/i);
    expect(lfm?.requiresLicense).toBe(false);
    expect(lfm?.source.protocol).toBe("ollama");
    expect(lfm?.source.url).toBe("ollama://hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M");
    const pin = lfm?.weights?.files[0]?.sha256;
    expect(pin).toMatch(/^[a-f0-9]{64}$/);
    expect(pin).not.toBe("0".repeat(64));
    const copy = [
      lfm?.description,
      lfm?.whyRecommended,
      lfm?.differentiators,
      ...(lfm?.strengths ?? []),
    ].join(" ");
    expect(copy).not.toMatch(/ToolSandbox|BFCLv4|77\.83|56\.88|220 tok/i);
  });

  it("places LFM2.5-2.6B on cpu and 8 GB agentic lists (v1.19.0 Phase 1)", async () => {
    const recommendedPath = path.resolve("core/registry/recommended.json");
    const recommended = JSON.parse(await fs.readFile(recommendedPath, "utf8")) as {
      tiers: Record<string, { agentic: string[] }>;
    };
    expect(recommended.tiers.cpu.agentic[0]).toBe("lfm2.5:2.6b");
    expect(recommended.tiers["8"].agentic).toEqual([
      "gemma4:e4b",
      "lfm2.5:2.6b",
      "qwen2.5-coder:7b",
    ]);
    for (const tier of ["12", "16", "24"]) {
      expect(recommended.tiers[tier].agentic).not.toContain("lfm2.5:2.6b");
    }
  });

  it("does not catalog LFM2.5-8B-A1B after the Phase 3 decline", async () => {
    const file = await loadCatalog();
    expect(findSpec(file, "lfm2.5:8b-a1b")).toBeUndefined();
    expect(file.models.some((m) => /8b-a1b/i.test(m.id))).toBe(false);
    const recommendedPath = path.resolve("core/registry/recommended.json");
    const recommended = JSON.parse(await fs.readFile(recommendedPath, "utf8")) as {
      tiers: Record<string, { agentic?: string[]; chat?: string[] }>;
    };
    for (const tier of Object.values(recommended.tiers)) {
      const ids = [...(tier.agentic ?? []), ...(tier.chat ?? [])];
      expect(ids.some((id) => /8b-a1b/i.test(id))).toBe(false);
    }
  });

  it("every user-facing description is non-empty and names its origin (v1.9.0 Phase 2)", async () => {
    const file = await loadCatalog();
    const userFacing = file.models.filter(
      (m) => m.type !== "vae" && m.type !== "controlnet",
    );
    for (const entry of userFacing) {
      const desc = entry.description ?? "";
      expect(desc.length, `${entry.id} missing description`).toBeGreaterThan(0);
      // DoD #8: the one-line summary states where the model is from. Country
      // origins appear verbatim; "Community" reads as "community" in prose.
      const origin = entry.origin ?? "";
      const needle = origin === "Community" ? "community" : origin;
      expect(
        desc.toLowerCase().includes(needle.toLowerCase()),
        `${entry.id} description should name its origin (${origin})`,
      ).toBe(true);
    }
  });

  it("backfills modalities on every bundled entry (v1.19.2)", async () => {
    const file = await loadCatalog();
    const allowed = new Set(["text", "image", "audio"]);
    for (const entry of file.models) {
      expect(entry.modalities?.length, `${entry.id} missing modalities`).toBeGreaterThan(0);
      for (const modality of entry.modalities ?? []) {
        expect(allowed.has(modality), `${entry.id} invalid modality ${modality}`).toBe(true);
      }
    }
    expect(findSpec(file, "gemma-4-12b-it-gguf")?.modalities).toEqual(["text", "image"]);
    expect(findSpec(file, "faster-whisper-large-v3")?.modalities).toEqual(["audio"]);
    expect(findSpec(file, "gemma4:e4b")?.modalities).toEqual(["text"]);
  });

  it("video entries declare audioConditioning (v1.19.2)", async () => {
    const file = await loadCatalog();
    const videos = file.models.filter((m) => m.type === "video");
    expect(videos.length).toBeGreaterThan(0);
    for (const entry of videos) {
      expect(entry.audioConditioning, `${entry.id} missing audioConditioning`).toBeDefined();
      expect(typeof entry.audioConditioning?.supported).toBe("boolean");
    }
  });

  it("curates Hermes 3 8B/70B as agentic catalog entries (v1.19.2)", async () => {
    const file = await loadCatalog();
    const eight = findSpec(file, "hermes3:8b");
    expect(eight).toBeDefined();
    expect(eight?.family).toBe("hermes");
    expect(eight?.agentic).toBe(true);
    expect(eight?.origin).toBe("USA");
    expect(eight?.license).toMatch(/Llama 3\.1/);
    expect(eight?.source.protocol).toBe("ollama");
    expect(eight?.source.url).toBe("ollama://hermes3:8b");
    expect(eight?.modalities).toEqual(["text"]);
    expect(eight?.contextWindow).toBe(131072);
    const seventy = findSpec(file, "hermes3:70b");
    expect(seventy?.agentic).toBe(true);
    expect(seventy?.source.url).toBe("ollama://hermes3:70b");
    expect(seventy?.tags).toContain("advanced");
  });

  it("curates Inkling-Small as an opt-in patient-tier GGUF (v1.19.2)", async () => {
    const file = await loadCatalog();
    const inkling = findSpec(file, "inkling-small");
    expect(inkling).toBeDefined();
    expect(inkling?.tags).toContain("patient-tier");
    expect(inkling?.sizeGB).toBe(74.8);
    expect(inkling?.license).toBe("Apache-2.0");
    expect(inkling?.modalities).toEqual(["text"]);
    expect(inkling?.expectedSecondsPerToken).toBe(32);
    expect(inkling?.measuredPeakRssGB).toBe(8.24);
    expect(inkling?.patientRamPresets?.map((p) => p.id)).toEqual(["laptop", "workstation", "max"]);
    expect(inkling?.weights?.layoutVersion).toBe(2);
    expect(inkling?.weights?.defaultVariant).toBe("gguf-ud-iq1-s");
    const variant = inkling?.weights?.variants?.[0];
    expect(variant?.official).toBe(true);
    expect(variant?.precision).toBe("gguf");
    expect(variant?.files.length).toBe(3);
    for (const fileEntry of variant?.files ?? []) {
      expect(fileEntry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fileEntry.sha256).not.toBe("0".repeat(64));
    }
    const copy = [
      inkling?.description,
      inkling?.whyRecommended,
      inkling?.differentiators,
    ].join(" ");
    expect(copy.toLowerCase()).toContain("text-only");
    expect(copy.toLowerCase()).toContain("unverified");
  });

  it("does not add Inkling-Small to recommended.json defaults (v1.19.2)", async () => {
    const recommendedPath = path.resolve("core/registry/recommended.json");
    const recommended = JSON.parse(await fs.readFile(recommendedPath, "utf8")) as {
      tiers: Record<string, Record<string, string[]>>;
    };
    for (const [tier, sections] of Object.entries(recommended.tiers)) {
      for (const [section, ids] of Object.entries(sections)) {
        expect(ids, `${tier}/${section}`).not.toContain("inkling-small");
        expect(ids, `${tier}/${section}`).not.toContain("hermes3:70b");
      }
    }
  });

  it("validateSpec rejects unofficial weights variants", () => {
    expect(() =>
      validateSpec({
        id: "x",
        family: "x",
        name: "x",
        tag: "1",
        type: "image",
        displayName: "X",
        source: { protocol: "huggingface", url: "https://huggingface.co/x/resolve/main/a.bin" },
        weights: {
          layoutVersion: 2,
          variants: [
            {
              id: "community-fp8",
              precision: "fp8",
              official: false as unknown as true,
              files: [{ path: "a.bin", sha256: "a".repeat(64) }],
            },
          ],
        },
      }),
    ).toThrow(/not official/);
  });

  it("validateSpec rejects an unknown patientRamPreset id", () => {
    expect(() =>
      validateSpec({
        id: "x",
        family: "x",
        name: "x",
        tag: "1",
        type: "llm",
        displayName: "X",
        source: { protocol: "ollama", url: "ollama://x:1" },
        patientRamPresets: [
          {
            id: "handheld" as "laptop",
            label: "Handheld",
            peakRssGB: 4,
            expectedSecondsPerToken: 40,
            copy: "no",
          },
        ],
      }),
    ).toThrow(/invalid patientRamPreset id/);
  });

  it("validateSpec rejects unsafe or incomplete weights variants (v1.19.2)", () => {
    const hf: ModelSpec = {
      id: "x",
      family: "x",
      name: "x",
      tag: "1",
      type: "image",
      displayName: "X",
      source: { protocol: "huggingface", url: "https://huggingface.co/x/resolve/main/a.bin" },
    };
    const pin = "a".repeat(64);
    expect(() =>
      validateSpec({
        ...hf,
        weights: { layoutVersion: 2, files: [{ path: "../a.bin", sha256: pin }] },
      }),
    ).toThrow(/unsafe/);
    expect(() =>
      validateSpec({
        ...hf,
        weights: { layoutVersion: 2, files: [{ path: "a.bin", sha256: "nope" }] },
      }),
    ).toThrow(/malformed sha256/);
    expect(() => validateSpec({ ...hf, weights: { layoutVersion: 2 } })).toThrow(/no files or variants/);
    expect(() =>
      validateSpec({
        ...hf,
        weights: {
          layoutVersion: 2,
          variants: [{ id: "  ", precision: "int8", official: true, files: [{ path: "a.bin", sha256: pin }] }],
        },
      }),
    ).toThrow(/missing id/);
    expect(() =>
      validateSpec({
        ...hf,
        weights: {
          layoutVersion: 2,
          variants: [
            { id: "int8", precision: "int8", official: true, files: [{ path: "a.bin", sha256: pin }] },
            { id: "int8", precision: "int8", official: true, files: [{ path: "b.bin", sha256: pin }] },
          ],
        },
      }),
    ).toThrow(/duplicate weights variant id/);
    expect(() =>
      validateSpec({
        ...hf,
        weights: {
          layoutVersion: 2,
          variants: [
            {
              id: "q",
              precision: "int4" as "int8",
              official: true,
              files: [{ path: "a.bin", sha256: pin }],
            },
          ],
        },
      }),
    ).toThrow(/invalid precision/);
    expect(() =>
      validateSpec({
        ...hf,
        weights: {
          layoutVersion: 2,
          variants: [{ id: "int8", precision: "int8", official: true, files: [] }],
        },
      }),
    ).toThrow(/has no files/);
    expect(() =>
      validateSpec({
        ...hf,
        weights: {
          layoutVersion: 2,
          defaultVariant: "missing",
          variants: [{ id: "int8", precision: "int8", official: true, files: [{ path: "a.bin", sha256: pin }] }],
        },
      }),
    ).toThrow(/defaultVariant/);
  });

  it("validateSpec rejects invalid modality, audio, throughput, and preset fields (v1.19.2)", () => {
    const base: ModelSpec = {
      id: "x",
      family: "x",
      name: "x",
      tag: "1",
      type: "llm",
      displayName: "X",
      source: { protocol: "ollama", url: "ollama://x:1" },
    };
    const laptop = {
      id: "laptop" as const,
      label: "Laptop",
      peakRssGB: 8,
      expectedSecondsPerToken: 32,
      copy: "copy",
    };
    expect(() => validateSpec({ ...base, modalities: [] })).toThrow(/modalities must be a non-empty array/);
    expect(() => validateSpec({ ...base, modalities: ["smell" as "text"] })).toThrow(/invalid modality/);
    expect(() =>
      validateSpec({
        ...base,
        audioConditioning: { supported: "yes" as unknown as boolean },
      }),
    ).toThrow(/audioConditioning.supported must be a boolean/);
    expect(() =>
      validateSpec({
        ...base,
        audioConditioning: { supported: true, modes: "single" as unknown as string[] },
      }),
    ).toThrow(/audioConditioning.modes must be an array/);
    expect(() =>
      validateSpec({
        ...base,
        audioConditioning: { supported: true, modes: ["stereo" as "single"] },
      }),
    ).toThrow(/invalid audioConditioning mode/);
    expect(() => validateSpec({ ...base, expectedSecondsPerToken: 0 })).toThrow(/expectedSecondsPerToken/);
    expect(() => validateSpec({ ...base, measuredPeakRssGB: -1 })).toThrow(/measuredPeakRssGB/);
    expect(() => validateSpec({ ...base, patientRamPresets: [] })).toThrow(/patientRamPresets must be a non-empty array/);
    expect(() => validateSpec({ ...base, patientRamPresets: [laptop, laptop] })).toThrow(/duplicate patientRamPreset id/);
    expect(() =>
      validateSpec({ ...base, patientRamPresets: [{ ...laptop, peakRssGB: 0 }] }),
    ).toThrow(/peakRssGB must be positive/);
    expect(() =>
      validateSpec({ ...base, patientRamPresets: [{ ...laptop, expectedSecondsPerToken: -2 }] }),
    ).toThrow(/expectedSecondsPerToken must be positive/);
  });

  it("validateSpec rejects unpinned trustRemoteCode, bad revision, and inverted MoE fields", () => {
    const base: ModelSpec = {
      id: "x",
      family: "x",
      name: "x",
      tag: "1",
      type: "llm",
      displayName: "X",
      source: { protocol: "huggingface", url: "https://huggingface.co/x/resolve/main/a.bin" },
    };
    expect(() =>
      validateSpec({ ...base, source: { ...base.source, revision: "main" } }),
    ).toThrow(/malformed source.revision/);
    expect(() => validateSpec({ ...base, trustRemoteCode: true })).toThrow(/trustRemoteCode/);
    expect(() => validateSpec({ ...base, activeParams: 1 })).toThrow(/both activeParams and totalParams/);
    expect(() => validateSpec({ ...base, activeParams: 10, totalParams: 3 })).toThrow(/exceeds totalParams/);
    expect(() =>
      validateSpec({
        ...base,
        toolCallingVerified: true,
        toolCallingBenchmark: { suite: "s", date: "not-a-date", result: "ok" },
      }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it("validateSpec accepts an official precision-variant manifest", () => {
    expect(() =>
      validateSpec({
        id: "x",
        family: "x",
        name: "x",
        tag: "1",
        type: "image",
        displayName: "X",
        source: { protocol: "huggingface", url: "https://huggingface.co/x/resolve/main/a.bin" },
        weights: {
          layoutVersion: 2,
          defaultVariant: "int8",
          variants: [
            {
              id: "int8",
              precision: "int8",
              official: true,
              files: [{ path: "a.bin", sha256: "a".repeat(64) }],
            },
          ],
        },
      }),
    ).not.toThrow();
  });
});
