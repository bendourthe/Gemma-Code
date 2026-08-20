import { afterEach, describe, expect, it } from "vitest";

import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import { createIpcFineTuningClient } from "../src/pages/settings/ipcFineTuningClient";

afterEach(() => clearInvokeOverride());

function stub(handler: (method: string, params: Record<string, unknown>) => unknown): void {
  setInvokeOverride(async (_cmd, args) => {
    const a = args as { method: string; params: Record<string, unknown> };
    return handler(a.method, a.params);
  });
}

describe("ipcFineTuningClient", () => {
  it("maps tuning.status and dataset.build", async () => {
    stub((method) => {
      if (method === "tuning.status") {
        return {
          supported: true,
          reason: "NVIDIA GPU with enough VRAM.",
          provisionStatus: "ready",
          provisionError: null,
          vramGB: 24,
          gpuVendor: "nvidia",
          osFamily: "linux",
          pins: [],
        };
      }
      if (method === "tuning.dataset.build") {
        return { id: "d", outputPath: "/x", written: 1, redacted: 0, skipped: [], preview: [] };
      }
      throw new Error(method);
    });
    const client = createIpcFineTuningClient();
    const status = await client.status();
    expect(status.supported).toBe(true);
    const ds = await client.buildDataset(["/tmp/a"]);
    expect(ds.id).toBe("d");
  });
});
