import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryFiles, deriveWorkspaceId } from "../../../src/storage/MemoryFiles.js";
import { MemorySnapshot, readWithSnapshot } from "../../../src/storage/MemorySnapshot.js";

describe("MemorySnapshot", () => {
  let baseDir: string;
  let workspaceId: string;
  let memoryFiles: MemoryFiles;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-mem-snap-"));
    workspaceId = deriveWorkspaceId(path.join(baseDir, "workspace"));
    memoryFiles = new MemoryFiles(workspaceId, baseDir);
    memoryFiles.init();
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("captures the three memory files at session start", () => {
    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\n## Decisions\n\n- Pin tier 2 by default.\n");
    fs.writeFileSync(memoryFiles.contextPath, "# Context\n\nVS Code extension.\n");
    memoryFiles.invalidateCache();

    const snap = MemorySnapshot.captureAtSessionStart(workspaceId, memoryFiles);
    expect(snap.info.mode).toBe("frozen");
    expect(snap.info.workspaceId).toBe(workspaceId);
    expect(snap.contents.memory).toContain("Pin tier 2 by default");
    expect(snap.contents.context).toContain("VS Code extension");
  });

  it("snapshot contents do not reflect mid-session writes (frozen mode)", () => {
    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\n## Preferences\n\n- Original.\n");
    memoryFiles.invalidateCache();
    const snap = MemorySnapshot.captureAtSessionStart(workspaceId, memoryFiles);

    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\n## Preferences\n\n- Edited.\n");
    memoryFiles.invalidateCache();

    expect(snap.contents.memory).toContain("Original");
    expect(snap.contents.memory).not.toContain("Edited");
  });

  it("contents object is frozen so callers cannot mutate it", () => {
    const snap = MemorySnapshot.captureAtSessionStart(workspaceId, memoryFiles);
    expect(() => {
      (snap.contents as { memory: string }).memory = "tampered";
    }).toThrow(TypeError);
  });

  it("readWithSnapshot returns snapshot content in frozen mode", () => {
    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\nfrozen-content\n");
    memoryFiles.invalidateCache();
    const snap = MemorySnapshot.captureAtSessionStart(workspaceId, memoryFiles, "frozen");
    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\nlive-content\n");
    memoryFiles.invalidateCache();

    const result = readWithSnapshot(snap, memoryFiles);
    expect(result?.memory).toContain("frozen-content");
    expect(result?.memory).not.toContain("live-content");
  });

  it("readWithSnapshot reads fresh from disk in live mode", () => {
    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\nfrozen-content\n");
    memoryFiles.invalidateCache();
    const snap = MemorySnapshot.captureAtSessionStart(workspaceId, memoryFiles, "live");
    fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\nlive-content\n");
    memoryFiles.invalidateCache();

    const result = readWithSnapshot(snap, memoryFiles);
    expect(result?.memory).toContain("live-content");
  });

  it("readWithSnapshot with no snapshot and no memoryFiles returns null", () => {
    expect(readWithSnapshot(null, null)).toBeNull();
  });

  it("fromContents builds a synthetic snapshot for tests", () => {
    const snap = MemorySnapshot.fromContents(
      workspaceId,
      {
        instructions: "i",
        memory: "m",
        context: "c",
        instructionsPath: "/tmp/i",
        memoryPath: "/tmp/m",
        contextPath: "/tmp/c",
      },
      "live",
      1234,
    );
    expect(snap.info.mode).toBe("live");
    expect(snap.info.capturedAt).toBe(1234);
    expect(snap.contents.memory).toBe("m");
  });
});
