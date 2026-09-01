import { afterEach, describe, expect, it, vi } from "vitest";

import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import {
  pickWorkspaceFolders,
  setWorkspaceDialogOverride,
} from "../src/lib/workspacePicker";

afterEach(() => {
  setWorkspaceDialogOverride(null);
  clearInvokeOverride();
});

describe("workspace picker", () => {
  it("returns an empty root list on cancel without invoking canonicalization", async () => {
    const invoke = vi.fn();
    setInvokeOverride(invoke);
    setWorkspaceDialogOverride(async () => null);
    await expect(pickWorkspaceFolders()).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requests directories only and returns native-canonical roots", async () => {
    const open = vi.fn(async () => ["C:\\work\\one", "C:\\work\\two"]);
    setWorkspaceDialogOverride(open);
    setInvokeOverride(async (command, args) => {
      expect(command).toBe("canonicalize_workspace_roots");
      expect(args).toEqual({ paths: ["C:\\work\\one", "C:\\work\\two"] });
      return ["C:\\Work\\one", "C:\\Work\\two"];
    });
    await expect(pickWorkspaceFolders()).resolves.toEqual(["C:\\Work\\one", "C:\\Work\\two"]);
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: true,
      title: "Add folders to workspace",
    });
  });

  it("serializes concurrent picker requests", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    setWorkspaceDialogOverride(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return null;
    });
    const first = pickWorkspaceFolders();
    const second = pickWorkspaceFolders();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
  });
});
