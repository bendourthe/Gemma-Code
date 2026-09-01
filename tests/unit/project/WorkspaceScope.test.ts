import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceScope,
  workspaceIdForRoots,
  workspaceScopeFromPersisted,
} from "../../../core/project/WorkspaceScope.js";
import { WorkspaceScopeStore } from "../../../core/project/WorkspaceScopeStore.js";

describe("WorkspaceScope", () => {
  it("defaults a new workspace to the OS home directory", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-home-"));
    const scope = await createWorkspaceScope({}, { homeDir: () => home });
    expect(scope.workspaceRoots).toEqual([await fs.realpath(home)]);
    expect(scope.primaryRoot).toBe(await fs.realpath(home));
  });

  it("preserves display order but hashes the sorted normalized root set", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-order-"));
    const a = path.join(base, "a");
    const b = path.join(base, "b");
    await fs.mkdir(a);
    await fs.mkdir(b);
    const first = await createWorkspaceScope({ workspaceRoots: [a, b], primaryRoot: b });
    const second = await createWorkspaceScope({ workspaceRoots: [b, a], primaryRoot: b });
    expect(first.workspaceRoots).toEqual([await fs.realpath(a), await fs.realpath(b)]);
    expect(second.workspaceRoots).toEqual([await fs.realpath(b), await fs.realpath(a)]);
    expect(first.workspaceId).toBe(second.workspaceId);
    expect(first.primaryRoot).toBe(await fs.realpath(b));
  });

  it("keeps an ancestor and selected child as distinct roots", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-ancestor-"));
    const child = path.join(parent, "child");
    await fs.mkdir(child);
    const scope = await createWorkspaceScope({ workspaceRoots: [parent, child] });
    expect(scope.workspaceRoots).toEqual([await fs.realpath(parent), await fs.realpath(child)]);
    expect(scope.identityRoots).toHaveLength(2);
  });

  it("deduplicates Windows-equivalent case and separator roots", async () => {
    const calls: string[] = [];
    const scope = await createWorkspaceScope(
      { workspaceRoots: ["C:\\Work\\Repo", "c:\\work\\repo\\"] },
      {
        platform: "win32",
        stat: async () => ({ isDirectory: () => true }),
        realpath: async (root) => {
          calls.push(root);
          return root;
        },
      },
    );
    expect(scope.workspaceRoots).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it.each(["relative/project", "../escape"])("rejects malformed root %s", async (root) => {
    await expect(createWorkspaceScope({ workspaceRoots: [root] })).rejects.toThrow();
  });

  it("rejects files, unavailable roots, and bounded slow canonicalization", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-invalid-"));
    const file = path.join(base, "file.txt");
    await fs.writeFile(file, "x");
    await expect(createWorkspaceScope({ workspaceRoots: [file] })).rejects.toThrow(/not a directory/);
    await expect(createWorkspaceScope({ workspaceRoots: [path.join(base, "missing")] })).rejects.toThrow(/unavailable/);
    await expect(
      createWorkspaceScope(
        { workspaceRoots: [base] },
        { timeoutMs: 5, stat: () => new Promise(() => undefined) },
      ),
    ).rejects.toThrow(/timed out/);
  });

  it("migrates a legacy workspacePath without changing a supplied session id", () => {
    const scope = workspaceScopeFromPersisted({ workspacePath: path.resolve("legacy") });
    expect(scope.workspaceRoots).toEqual([path.resolve("legacy")]);
    expect(scope.workspaceId).toBe(workspaceIdForRoots([path.resolve("legacy")]));
  });
});

describe("WorkspaceScopeStore", () => {
  it("deduplicates by identity and preserves createdAt on last-used updates", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-store-"));
    const root = path.join(base, "root");
    await fs.mkdir(root);
    const first = await createWorkspaceScope({ workspaceRoots: [root] }, { now: () => new Date("2026-01-01T00:00:00Z") });
    const second = await createWorkspaceScope({ workspaceRoots: [root] }, { now: () => new Date("2026-01-02T00:00:00Z") });
    const file = path.join(base, "workspaces.json");
    const store = new WorkspaceScopeStore(file);
    store.upsert(first);
    const updated = store.upsert(second);
    expect(store.list()).toHaveLength(1);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.lastUsedAt).toBe(second.lastUsedAt);
    expect(new WorkspaceScopeStore(file).get(first.workspaceId)).toEqual(updated);
  });

  it("fails closed on malformed persisted workspace data", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-malformed-"));
    const file = path.join(base, "workspaces.json");
    await fs.writeFile(file, JSON.stringify({ version: 1, workspaces: [{ workspaceId: "bad" }] }));
    expect(() => new WorkspaceScopeStore(file)).toThrow(/malformed workspace/);
  });
});
