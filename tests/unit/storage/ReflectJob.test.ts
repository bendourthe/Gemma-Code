import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ReflectJob,
  shouldRunReflectJob,
  type EpisodicReader,
  type HardwareTier,
  type ReflectManifest,
} from "../../../src/storage/ReflectJob.js";
import type { EpisodicEntry } from "../../../src/storage/MemoryLayers.types.js";

function makeEvent(overrides: Partial<EpisodicEntry>): EpisodicEntry {
  return {
    id: overrides.id ?? "id-" + Math.random().toString(36).slice(2),
    sessionId: overrides.sessionId ?? "sess-1",
    action: overrides.action ?? "write_file",
    context: overrides.context ?? "/tmp/x.ts",
    outcome: overrides.outcome ?? "ok",
    timestamp: overrides.timestamp ?? 0,
    provenance: overrides.provenance ?? {
      source: "tool_verified",
      sourceSessionId: "sess-1",
      sourceMessageId: null,
      timestamp: 0,
      confidence: 1,
    },
    tags: overrides.tags ?? [],
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reflect-job-test-"));
}

function reader(events: readonly EpisodicEntry[]): EpisodicReader {
  return {
    listSince: (sinceMs: number) => events.filter((e) => e.timestamp >= sinceMs),
  };
}

describe("ReflectJob", () => {
  it("clusters events by action key and filters small clusters", async () => {
    const dir = makeTempDir();
    const memoryFile = path.join(dir, "Memory.md");
    const events = [
      makeEvent({ action: "write_file", context: "/foo.ts", timestamp: 1 }),
      makeEvent({ action: "write_file", context: "/foo.ts", timestamp: 2 }),
      makeEvent({ action: "write_file", context: "/foo.ts", timestamp: 3 }),
      makeEvent({ action: "write_file", context: "/bar.ts", timestamp: 4 }),
    ];
    const job = new ReflectJob(reader(events), async () => "lesson", {
      manifestDir: dir,
      memoryFilePath: memoryFile,
      lookbackMs: 1000,
      minClusterSize: 3,
      hardwareTier: "balanced",
      now: () => 1000,
    });
    const manifest = await job.dryRun();
    expect(manifest.clusters).toHaveLength(1);
    expect(manifest.clusters[0]?.occurrences).toBe(3);
    expect(manifest.lessons).toHaveLength(1);
  });

  it("skips lesson generation on a constrained hardware tier", async () => {
    const dir = makeTempDir();
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ action: "edit_file", context: "/a.ts", timestamp: i + 1 }),
    );
    const lessonFn = vi.fn(async () => "lesson");
    const job = new ReflectJob(reader(events), lessonFn, {
      manifestDir: dir,
      memoryFilePath: path.join(dir, "Memory.md"),
      lookbackMs: 1000,
      hardwareTier: "constrained",
      now: () => 1000,
    });
    const manifest = await job.dryRun();
    expect(manifest.clusters).toHaveLength(1);
    expect(manifest.lessons).toEqual([]);
    expect(lessonFn).not.toHaveBeenCalled();
  });

  it("apply writes a Reflected Lessons section into Memory.md", async () => {
    const dir = makeTempDir();
    const memoryFile = path.join(dir, "Memory.md");
    fs.writeFileSync(memoryFile, "Existing content.\n");
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ action: "grep", context: "/src/foo.ts", timestamp: i + 1 }),
    );
    const job = new ReflectJob(reader(events), async () => "Insightful lesson.", {
      manifestDir: dir,
      memoryFilePath: memoryFile,
      lookbackMs: 1000,
      hardwareTier: "balanced",
      now: () => 1000,
    });
    const manifest = await job.dryRun();
    const result = await job.apply(manifest.id);
    expect(result.lessonsAppended).toBe(1);
    const updated = fs.readFileSync(memoryFile, "utf-8");
    expect(updated).toContain("## Reflected Lessons");
    expect(updated).toContain("Insightful lesson.");
  });

  it("rollback restores the previous Memory.md bytes", async () => {
    const dir = makeTempDir();
    const memoryFile = path.join(dir, "Memory.md");
    const before = "Original content.\n";
    fs.writeFileSync(memoryFile, before);
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ action: "create_file", context: "/foo.ts", timestamp: i + 1 }),
    );
    const job = new ReflectJob(reader(events), async () => "L", {
      manifestDir: dir,
      memoryFilePath: memoryFile,
      lookbackMs: 1000,
      hardwareTier: "balanced",
      now: () => 1000,
    });
    const manifest = await job.dryRun();
    const applied = await job.apply(manifest.id);
    expect(fs.readFileSync(memoryFile, "utf-8")).not.toBe(before);
    await job.rollback(applied.rollbackId);
    expect(fs.readFileSync(memoryFile, "utf-8")).toBe(before);
  });

  it("apply is a no-op when there are no qualifying clusters", async () => {
    const dir = makeTempDir();
    const memoryFile = path.join(dir, "Memory.md");
    const job = new ReflectJob(reader([]), async () => "L", {
      manifestDir: dir,
      memoryFilePath: memoryFile,
      lookbackMs: 1000,
      hardwareTier: "balanced",
      now: () => 1000,
    });
    const manifest = await job.dryRun();
    const result = await job.apply(manifest.id);
    expect(result.lessonsAppended).toBe(0);
    expect(fs.existsSync(memoryFile)).toBe(false);
  });

  it("handles a 10K-event stress workload without hanging", async () => {
    const dir = makeTempDir();
    const events: EpisodicEntry[] = [];
    for (let i = 0; i < 10_000; i++) {
      events.push(
        makeEvent({
          action: i % 5 === 0 ? "edit_file" : "read_file",
          context: `/src/file-${i % 50}.ts`,
          timestamp: i + 1,
        }),
      );
    }
    const job = new ReflectJob(reader(events), async () => "lesson", {
      manifestDir: dir,
      memoryFilePath: path.join(dir, "Memory.md"),
      lookbackMs: 100_000,
      hardwareTier: "balanced",
      now: () => 100_000,
    });
    const t0 = Date.now();
    const manifest: ReflectManifest = await job.dryRun();
    const elapsed = Date.now() - t0;
    // Clustering 10K events should finish well under 5 seconds.
    expect(elapsed).toBeLessThan(5000);
    expect(manifest.clusters.length).toBeGreaterThan(0);
  });
});

describe("shouldRunReflectJob", () => {
  it.each<[HardwareTier, boolean]>([
    ["constrained", false],
    ["balanced", true],
    ["full", true],
  ])("tier=%s -> %s", (tier, expected) => {
    expect(shouldRunReflectJob(tier)).toBe(expected);
  });
});
