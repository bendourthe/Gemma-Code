import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

import {
  COMPAT_WORKFLOW_KEY,
  NEXUS_WORKFLOW_KEY,
  createMinimalPng,
  embedWorkflow,
  extractWorkflow,
  readTextChunks,
  type WorkflowMetadata,
} from "../../../../core/image/WorkflowMetadata.js";

function sampleWorkflow(): WorkflowMetadata {
  return {
    tool: "nexus",
    version: "1.0.0",
    mode: "txt2img",
    prompt: "a watercolor of a fox",
    negativePrompt: "blurry",
    modelId: "sdxl-turbo",
    width: 1024,
    height: 1024,
    steps: 4,
    cfgScale: 1.5,
    sampler: "euler_a",
    seed: 12345,
    timestamp: "2026-05-17T12:00:00Z",
    loras: [{ id: "lora:cinematic", weight: 0.8 }],
  };
}

describe("WorkflowMetadata", () => {
  it("createMinimalPng returns a valid PNG", () => {
    const png = createMinimalPng();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("embedWorkflow + extractWorkflow round-trips", () => {
    const base = createMinimalPng();
    const wf = sampleWorkflow();
    const embedded = embedWorkflow(base, wf);
    expect(embedded.length).toBeGreaterThan(base.length);
    const extracted = extractWorkflow(embedded);
    expect(extracted).not.toBeNull();
    expect(extracted?.prompt).toBe(wf.prompt);
    expect(extracted?.loras?.[0]?.id).toBe("lora:cinematic");
  });

  it("embeds both nexus_workflow and ComfyUI compat keys", () => {
    const embedded = embedWorkflow(createMinimalPng(), sampleWorkflow());
    const chunks = readTextChunks(embedded);
    expect(chunks).toHaveProperty(NEXUS_WORKFLOW_KEY);
    expect(chunks).toHaveProperty(COMPAT_WORKFLOW_KEY);
    expect(chunks[NEXUS_WORKFLOW_KEY]).toBe(chunks[COMPAT_WORKFLOW_KEY]);
  });

  it("returns null when the PNG has no workflow chunk", () => {
    const png = createMinimalPng();
    expect(extractWorkflow(png)).toBeNull();
  });

  it("returns null when the buffer is not a PNG", () => {
    const notPng = Buffer.from("not a png");
    expect(extractWorkflow(notPng)).toBeNull();
  });

  it("embedding twice is idempotent (does not duplicate chunks)", () => {
    const wf = sampleWorkflow();
    const once = embedWorkflow(createMinimalPng(), wf);
    const twice = embedWorkflow(once, wf);
    const chunksOnce = readTextChunks(once);
    const chunksTwice = readTextChunks(twice);
    expect(Object.keys(chunksOnce).sort()).toEqual(Object.keys(chunksTwice).sort());
  });

  it("readTextChunks throws on a non-PNG buffer", () => {
    expect(() => readTextChunks(Buffer.from("definitely not png"))).toThrow();
  });

  it("embedWorkflow throws when given a non-PNG buffer", () => {
    expect(() => embedWorkflow(Buffer.from("definitely not png"), sampleWorkflow())).toThrow();
  });

  it("ignores workflow chunks whose mode is unrecognized", () => {
    const wf = sampleWorkflow();
    const embedded = embedWorkflow(createMinimalPng(), wf);
    const chunks = readTextChunks(embedded);
    expect(chunks[NEXUS_WORKFLOW_KEY]).toMatch(/"mode":"txt2img"/);
    const corrupted = embedded
      .toString("binary")
      .replace(/"mode":"txt2img"/g, '"mode":"weird"');
    const corruptedBuf = Buffer.from(corrupted, "binary");
    // CRC is now invalid but the reader tolerates that since it does not
    // verify CRC; the validator should still reject the mode.
    expect(extractWorkflow(corruptedBuf)).toBeNull();
  });

  it("round-trips UTF-8 prompts via iTXt and ignores unknown fields", () => {
    const wf = {
      ...sampleWorkflow(),
      prompt: "renard aquarelle cafe\u00e9",
      extraVendorField: 42,
      schemaVersion: 1,
    };
    const extracted = extractWorkflow(embedWorkflow(createMinimalPng(), wf));
    expect(extracted?.prompt).toBe("renard aquarelle cafe\u00e9");
    expect((extracted as { extraVendorField?: number } | null)?.extraVendorField).toBe(42);
    expect(extracted?.schemaVersion).toBe(1);
  });
});
