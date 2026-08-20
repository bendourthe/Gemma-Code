import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryMemoryHub } from "../../../../core/memory/MemoryHub.js";
import { createProjectScope } from "../../../../core/project/ProjectScope.js";
import { createSandboxSeam } from "../../../../core/project/DurableSandbox.js";
import type { MemorySeam, SandboxSeam, SessionStoreSeam } from "../../../../core/project/seams.js";

describe("project substrate seams", () => {
  it("types the current memory, session, and sandbox implementations", async () => {
    const memory: MemorySeam = new InMemoryMemoryHub();
    const sessions: SessionStoreSeam<{ readonly id: string }> = {
      get(id) {
        return id === "s1" ? { id: "s1" } : undefined;
      },
      list() {
        return [{ id: "s1" }];
      },
    };
    const home = await mkdtemp(path.join(os.tmpdir(), "nexus-seam-"));
    try {
      const sandbox: SandboxSeam = await createSandboxSeam("alpha", home);
      const scope = createProjectScope({
        projectId: "alpha",
        memoryScopeId: "proj:alpha",
        mcpAllowlist: [],
        skillIds: [],
        permissionFloor: {},
      });
      expect(memory.retrieve).toBeTypeOf("function");
      expect(sessions.get("s1")?.id).toBe("s1");
      expect(sandbox.projectId).toBe(scope.projectId);
      expect(sandbox.root.length).toBeGreaterThan(0);
      await sandbox.reset();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
