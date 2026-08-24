import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SANDBOX_MARKER,
  ensureSandbox,
  isSandboxPath,
  resetSandbox,
  sandboxRootFor,
} from "../../../../core/project/DurableSandbox.js";
import { createProjectScope } from "../../../../core/project/ProjectScope.js";

describe("DurableSandbox", () => {
  it("keeps a tool file across ensure calls for the same project only", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "nexus-sbx-"));
    try {
      const a = await ensureSandbox("proj-a", home);
      await writeFile(path.join(a, "tool.bin"), "keep", "utf8");
      const again = await ensureSandbox("proj-a", home);
      expect(again).toBe(a);
      expect(await readFile(path.join(again, "tool.bin"), "utf8")).toBe("keep");
      const b = await ensureSandbox("proj-b", home);
      await expect(readFile(path.join(b, "tool.bin"), "utf8")).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reset wipes contents and restores the untrusted marker", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "nexus-sbx-"));
    try {
      const root = await ensureSandbox("proj-a", home);
      await writeFile(path.join(root, "tool.bin"), "gone", "utf8");
      await resetSandbox("proj-a", home);
      await expect(readFile(path.join(root, "tool.bin"), "utf8")).rejects.toThrow();
      expect(await readFile(path.join(root, SANDBOX_MARKER), "utf8")).toMatch(/untrusted/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("treats sandbox paths as untrusted for memory indexing", () => {
    const home = "/tmp/nexus-home";
    const root = sandboxRootFor("proj-a", home);
    expect(isSandboxPath(root, home)).toBe(true);
    expect(isSandboxPath(path.join(root, "tool.bin"), home)).toBe(true);
    expect(isSandboxPath(path.join(home, "memory", "index"), home)).toBe(false);
  });

  it("keys the durable root off ProjectScope.projectId", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "nexus-sbx-"));
    try {
      const scope = createProjectScope({
        projectId: "proj-a",
        memoryScopeId: "proj:a",
        mcpAllowlist: [],
        skillIds: [],
        permissionFloor: {},
      });
      const root = await ensureSandbox(scope.projectId, home);
      expect(root).toBe(sandboxRootFor("proj-a", home));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
