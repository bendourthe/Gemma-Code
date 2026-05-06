import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let mockWorkspacePath: string | undefined;

vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() {
      return mockWorkspacePath ? [{ uri: { fsPath: mockWorkspacePath } }] : undefined;
    },
  },
}));

/**
 * v0.7.0 Phase 2 -- exercise `buildMemoryFiles` end-to-end. The bootstrap
 * helper is responsible for: scaffolding the three files on first run, and
 * triggering an auto-archive when the most-recent snapshot is older than the
 * threshold dictated by `gemma-code.memoryAutoArchive`.
 *
 * Tests pass an explicit `baseDir` because Windows `os.homedir()` ignores
 * `USERPROFILE` env overrides (it reads `GetUserProfileDirectoryW` directly),
 * so simply mutating env would not redirect the on-disk paths.
 */

describe("buildMemoryFiles + auto-archive (v0.7.0 Phase 2)", () => {
  let workspaceDir: string;
  let baseDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-ws-"));
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-mem-"));
    mockWorkspacePath = workspaceDir;
  });

  afterEach(() => {
    mockWorkspacePath = undefined;
  });

  function makeSettings(memoryAutoArchive: "off" | "weekly" | "monthly") {
    return { memoryAutoArchive } as never;
  }

  it("scaffolds the three files on first session", async () => {
    const { buildMemoryFiles } = await import("../../src/panels/ChatPanelInit.js");
    const memoryFiles = buildMemoryFiles(makeSettings("off"), baseDir);
    expect(memoryFiles).not.toBeNull();
    expect(fs.existsSync(memoryFiles!.instructionsPath)).toBe(true);
    expect(fs.existsSync(memoryFiles!.memoryPath)).toBe(true);
    expect(fs.existsSync(memoryFiles!.contextPath)).toBe(true);
  });

  it("returns null when no workspace folder is open", async () => {
    mockWorkspacePath = undefined;
    const { buildMemoryFiles } = await import("../../src/panels/ChatPanelInit.js");
    expect(buildMemoryFiles(makeSettings("off"), baseDir)).toBeNull();
  });

  it("does NOT auto-archive when memoryAutoArchive=off", async () => {
    const { buildMemoryFiles } = await import("../../src/panels/ChatPanelInit.js");
    const memoryFiles = buildMemoryFiles(makeSettings("off"), baseDir);
    expect(memoryFiles).not.toBeNull();
    expect(fs.existsSync(memoryFiles!.archiveDir)).toBe(false);
  });

  it("auto-archives when the latest snapshot is older than the weekly threshold", async () => {
    const { deriveWorkspaceId } = await import("../../src/storage/MemoryFiles.js");
    const workspaceId = deriveWorkspaceId(workspaceDir);
    const archiveDir = path.join(baseDir, workspaceId, "Archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const stale = new Date();
    stale.setDate(stale.getDate() - 30);
    fs.mkdirSync(path.join(archiveDir, formatLocalDate(stale)), { recursive: true });

    const { buildMemoryFiles } = await import("../../src/panels/ChatPanelInit.js");
    const memoryFiles = buildMemoryFiles(makeSettings("weekly"), baseDir);
    expect(memoryFiles).not.toBeNull();

    const today = formatLocalDate(new Date());
    expect(fs.existsSync(path.join(memoryFiles!.archiveDir, today))).toBe(true);
  });

  it("does NOT auto-archive when the latest snapshot is fresh", async () => {
    const { deriveWorkspaceId } = await import("../../src/storage/MemoryFiles.js");
    const workspaceId = deriveWorkspaceId(workspaceDir);
    const archiveDir = path.join(baseDir, workspaceId, "Archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const fresh = new Date();
    fresh.setDate(fresh.getDate() - 2);
    const stamp = formatLocalDate(fresh);
    const freshSnapshot = path.join(archiveDir, stamp);
    fs.mkdirSync(freshSnapshot, { recursive: true });
    fs.writeFileSync(path.join(freshSnapshot, "Memory.md"), "fresh\n");

    const { buildMemoryFiles } = await import("../../src/panels/ChatPanelInit.js");
    const memoryFiles = buildMemoryFiles(makeSettings("weekly"), baseDir);
    expect(memoryFiles).not.toBeNull();

    const today = formatLocalDate(new Date());
    if (today !== stamp) {
      expect(fs.existsSync(path.join(memoryFiles!.archiveDir, today))).toBe(false);
    }
    expect(fs.existsSync(freshSnapshot)).toBe(true);
  });
});

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
