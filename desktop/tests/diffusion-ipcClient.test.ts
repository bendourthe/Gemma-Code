import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIpcDiffusionClient } from "../src/modules/image/diffusionClient";
import { setInvokeOverride, clearInvokeOverride } from "../src/lib/ipc";

describe("createIpcDiffusionClient", () => {
  beforeEach(() => {
    setInvokeOverride(async (cmd, args) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const method = params.method as string | undefined;
      if (cmd !== "ipc_call") throw new Error(`unexpected cmd ${cmd}`);
      switch (method) {
        case "diffusion.txt2img":
        case "diffusion.img2img":
        case "diffusion.inpaint":
        case "diffusion.outpaint":
          return { jobId: `job-${method}`, mode: method.split(".")[1], offloadStrategy: "stub" };
        case "diffusion.job.drainEvents":
          return { events: [{ kind: "progress", jobId: "j1", step: 1 }] };
        case "diffusion.workflow.extract":
          return { workflow: { mode: "txt2img", prompt: "ok" } };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
  });
  afterEach(() => {
    clearInvokeOverride();
  });

  function baseReq() {
    return {
      modelId: "sdxl-turbo",
      prompt: "fox",
      width: 512,
      height: 512,
      steps: 4,
      cfgScale: 1.5,
      sampler: "euler_a",
      seed: 1,
    };
  }

  it("txt2img forwards through ipc.call", async () => {
    const client = createIpcDiffusionClient();
    const accepted = await client.txt2img(baseReq());
    expect(accepted.jobId).toContain("job-");
  });

  it("img2img forwards through ipc.call", async () => {
    const client = createIpcDiffusionClient();
    const accepted = await client.img2img({ ...baseReq(), sourceImage: "data:image/png;base64,AAA" });
    expect(accepted.mode).toBe("img2img");
  });

  it("inpaint forwards through ipc.call", async () => {
    const client = createIpcDiffusionClient();
    const accepted = await client.inpaint({
      ...baseReq(),
      sourceImage: "data:image/png;base64,AAA",
      mask: "data:image/png;base64,AAA",
    });
    expect(accepted.mode).toBe("inpaint");
  });

  it("outpaint forwards through ipc.call", async () => {
    const client = createIpcDiffusionClient();
    const accepted = await client.outpaint({
      ...baseReq(),
      sourceImage: "data:image/png;base64,AAA",
      direction: "left",
      pixels: 64,
    });
    expect(accepted.mode).toBe("outpaint");
  });

  it("drainEvents unwraps the events array", async () => {
    const client = createIpcDiffusionClient();
    const events = await client.drainEvents("j1");
    expect(events).toHaveLength(1);
  });

  it("extractWorkflow forwards a base64 buffer and returns the parsed workflow", async () => {
    const client = createIpcDiffusionClient();
    const workflow = (await client.extractWorkflow("AAA")) as { mode: string };
    expect(workflow.mode).toBe("txt2img");
  });

  it("propagates IPC errors as thrown errors", async () => {
    setInvokeOverride(async () => {
      throw new Error("nope");
    });
    const client = createIpcDiffusionClient();
    await expect(client.txt2img(baseReq())).rejects.toThrow(/nope/);
  });
});
