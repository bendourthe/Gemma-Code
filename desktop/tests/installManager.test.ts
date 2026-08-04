/**
 * v1.15.0 Phase 4 (Issue 3) -- install job manager (start / drain / cancel).
 */

import { describe, it, expect } from "vitest";

import { InstallManager } from "../sidecar/src/models/installManager";
import type { NexusModelRegistry } from "../../core/registry/NexusModelRegistry";

function fakeRegistry(installById: NexusModelRegistry["installById"]): NexusModelRegistry {
  return { installById } as unknown as NexusModelRegistry;
}

async function drain(mgr: InstallManager, id: string): Promise<{ kinds: string[]; error: string }> {
  const kinds: string[] = [];
  let error = "";
  for (let i = 0; i < 200; i++) {
    const { events, done } = mgr.drain(id);
    for (const e of events) {
      kinds.push(e.kind);
      if (e.kind === "error") error = e.message ?? "";
    }
    if (done) break;
    await new Promise((r) => setTimeout(r, 2));
  }
  return { kinds, error };
}

describe("InstallManager", () => {
  it("emits progress then a terminal complete", async () => {
    const registry = fakeRegistry(async (id, opts) => {
      opts?.onProgress?.(50, 100);
      opts?.onProgress?.(100, 100);
      return { id, status: "installed", bytesDownloaded: 0, manifestPath: "" };
    });
    const mgr = new InstallManager(registry);
    const jobId = mgr.start("gemma-4-12b-it-gguf");
    expect(jobId).toBe("gemma-4-12b-it-gguf");
    const { kinds } = await drain(mgr, jobId);
    expect(kinds).toContain("progress");
    expect(kinds[kinds.length - 1]).toBe("complete");
  });

  it("surfaces a failure as an error event", async () => {
    const registry = fakeRegistry(async () => {
      throw new Error("boom");
    });
    const mgr = new InstallManager(registry);
    const { kinds, error } = await drain(mgr, mgr.start("x"));
    expect(kinds).toContain("error");
    expect(error).toBe("boom");
  });

  it("cancel aborts the install and reports 'cancelled'", async () => {
    const registry = fakeRegistry(
      (_id, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const mgr = new InstallManager(registry);
    const jobId = mgr.start("x");
    mgr.cancel(jobId);
    const { kinds, error } = await drain(mgr, jobId);
    expect(kinds).toContain("error");
    expect(error).toBe("cancelled");
  });
});
