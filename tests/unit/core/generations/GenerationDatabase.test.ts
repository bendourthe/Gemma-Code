import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import BetterSqlite from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  GenerationDatabase,
  type GenerationEnhancementMetadata,
} from "../../../../core/generations/GenerationDatabase.js";
import { GenerationIndex } from "../../../../core/generations/GenerationIndex.js";
import {
  GenerationQueue,
  INTERRUPTED_BY_RESTART,
} from "../../../../core/generations/GenerationQueue.js";
import {
  contentHash,
  contentHashFile,
} from "../../../../core/generations/contentHash.js";
import type { VideoEnhancementRequest } from "../../../../core/video/VideoEnhancement.js";

const databases: GenerationDatabase[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may retain a SQLite WAL handle until the test process exits.
    }
  }
});

function shared(dbPath = ":memory:"): {
  database: GenerationDatabase;
  queue: GenerationQueue;
  index: GenerationIndex;
} {
  const database = new GenerationDatabase({ dbPath });
  databases.push(database);
  return {
    database,
    queue: new GenerationQueue({ database }),
    index: new GenerationIndex({ database }),
  };
}

function finishSource(
  queue: GenerationQueue,
  index: GenerationIndex,
  parentJobId: string,
): { outputId: string; outputPath: string; hash: string } {
  const bytes = Buffer.from(`source:${parentJobId}`);
  const hash = contentHash(bytes);
  const outputId = `${parentJobId}-output`;
  const outputPath = path.join(tmpdir(), `${parentJobId}.mp4`);
  queue.enqueue({
    id: parentJobId,
    pillar: "video",
    jobType: "txt2vid",
    parameters: { prompt: "source" },
  });
  queue.markRunning(parentJobId);
  queue.markDone(parentJobId);
  index.putOutput({
    id: outputId,
    jobId: parentJobId,
    pillar: "video",
    outputPath,
    contentHash: hash,
    workflow: { prompt: "source" },
  });
  return { outputId, outputPath, hash };
}

function enhancementMetadata(
  parentJobId: string,
  source: { outputId: string; outputPath: string; hash: string },
  requestId: string,
): GenerationEnhancementMetadata {
  const request: VideoEnhancementRequest = {
    requestId,
    parentJobId,
    source: {
      path: source.outputPath,
      sha256: source.hash,
      sizeBytes: Buffer.byteLength(`source:${parentJobId}`),
      durationSeconds: 2,
      width: 640,
      height: 360,
      frameRate: { numerator: 24, denominator: 1 },
    },
    mode: "upscale",
    upscalePreset: "animation-upscale-2x",
    requestedAt: "2026-08-28T12:00:00.000Z",
    timeoutMs: 60_000,
  };
  return { request, sourceOutputId: source.outputId, backendId: "video2x" };
}

function enqueueEnhancement(
  queue: GenerationQueue,
  parentJobId: string,
  childJobId: string,
  metadata: GenerationEnhancementMetadata,
): void {
  queue.enqueue({
    id: childJobId,
    parentId: parentJobId,
    pillar: "video",
    jobType: "enhance",
    parameters: {},
    enhancement: metadata,
  });
}

function complete(
  queue: GenerationQueue,
  childJobId: string,
  suffix: string,
  outboxId = `${childJobId}-outbox`,
): void {
  queue.markRunning(childJobId);
  queue.completeEnhancement({
    childJobId,
    output: {
      id: `${childJobId}-output`,
      outputPath: path.join(tmpdir(), `${childJobId}-${suffix}.mp4`),
      contentHash: createHash("sha256")
        .update(`enhanced:${suffix}`)
        .digest("hex"),
      workflow: { mode: "enhanced", childJobId },
    },
    provenanceRecordId: `${childJobId}-provenance`,
    provenance: { childJobId, outcome: "completed" },
    outbox: { id: outboxId, payload: { childJobId } },
  });
}

describe("GenerationDatabase shared storage", () => {
  it("keeps shared queue and index facades on one owner without facade close closing it", () => {
    const { database, queue, index } = shared();
    const source = finishSource(queue, index, "parent-shared");
    queue.close();
    expect(index.getOutput(source.outputId)?.jobId).toBe("parent-shared");
    index.close();
    expect(database.getGenerationOutput(source.outputId)?.contentHash).toBe(
      source.hash,
    );
  });

  it.each(["image", "video"] as const)(
    "atomically completes a running %s generation with a streamed output hash",
    async (pillar) => {
      const { queue, index } = shared();
      const dir = mkdtempSync(
        path.join(tmpdir(), `nexus-${pillar}-completion-`),
      );
      tempDirs.push(dir);
      const jobId = `${pillar}-normal-completion`;
      const outputPath = path.join(
        dir,
        pillar === "image" ? "result.png" : "result.mp4",
      );
      const bytes = Buffer.from(`${pillar}:streamed-output`);
      writeFileSync(outputPath, bytes);
      queue.enqueue({
        id: jobId,
        pillar,
        jobType: pillar === "image" ? "txt2img" : "txt2vid",
        parameters: {},
      });
      queue.markRunning(jobId);

      const completion = await queue.completeGenerationOutput({
        jobId,
        output: {
          id: `${jobId}-output`,
          outputPath,
          workflow: { pillar, prompt: "complete" },
        },
      });

      expect(queue.get(jobId)?.state).toBe("done");
      expect(completion.output).toMatchObject({
        jobId,
        pillar,
        outputPath,
        contentHash: contentHash(bytes),
        workflow: { pillar, prompt: "complete" },
      });
      expect(index.getOutputForJob(jobId)).toEqual(completion.output);
      expect(index.get(contentHash(bytes))?.workflow.prompt).toBe("complete");
    },
  );

  it("rolls back a normal output insert when the running-to-done transition fails", async () => {
    const { database, queue, index } = shared();
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-generation-rollback-"));
    tempDirs.push(dir);
    const outputPath = path.join(dir, "result.mp4");
    const bytes = Buffer.from("normal-generation-rollback");
    const hash = contentHash(bytes);
    writeFileSync(outputPath, bytes);
    queue.enqueue({
      id: "normal-rollback",
      pillar: "video",
      jobType: "txt2vid",
      parameters: {},
    });
    queue.markRunning("normal-rollback");
    database.connection.exec(`
      CREATE TRIGGER force_normal_completion_rollback
      BEFORE UPDATE OF state ON jobs
      FOR EACH ROW
      WHEN NEW.id = 'normal-rollback' AND NEW.state = 'done'
      BEGIN
        SELECT RAISE(ABORT, 'forced normal completion rollback');
      END;
    `);

    await expect(
      queue.completeGenerationOutput({
        jobId: "normal-rollback",
        output: {
          id: "normal-rollback-output",
          outputPath,
          workflow: { prompt: "must roll back" },
        },
      }),
    ).rejects.toThrow(/forced normal completion rollback/);

    expect(queue.get("normal-rollback")?.state).toBe("running");
    expect(index.getOutput("normal-rollback-output")).toBeNull();
    expect(index.get(hash)).toBeNull();
  });

  it("does not let normal completion bypass enhancement provenance", async () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-normal-bypass");
    enqueueEnhancement(
      queue,
      "parent-normal-bypass",
      "child-normal-bypass",
      enhancementMetadata(
        "parent-normal-bypass",
        source,
        "00000000-0000-4000-8000-000000000012",
      ),
    );
    queue.markRunning("child-normal-bypass");
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-normal-bypass-"));
    tempDirs.push(dir);
    const outputPath = path.join(dir, "result.mp4");
    writeFileSync(outputPath, "must-not-publish");

    await expect(
      queue.completeGenerationOutput({
        jobId: "child-normal-bypass",
        output: {
          id: "child-normal-bypass-output",
          outputPath,
          workflow: {},
        },
      }),
    ).rejects.toThrow(/completeEnhancement/);

    expect(queue.get("child-normal-bypass")?.state).toBe("running");
    expect(index.getOutput("child-normal-bypass-output")).toBeNull();
  });

  it("migrates the legacy schema and preserves legacy queue/index rows", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-generation-migration-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "studio.db");
    const legacy = new BetterSqlite(dbPath);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, pillar TEXT NOT NULL, job_type TEXT NOT NULL,
        parameters_json TEXT NOT NULL, batch_spec_json TEXT, parent_id TEXT,
        sort_order INTEGER NOT NULL, state TEXT NOT NULL, priority TEXT NOT NULL,
        thread_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE generations (
        content_hash TEXT PRIMARY KEY, pillar TEXT NOT NULL,
        workflow_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE enhancement_runs (
        child_job_id TEXT PRIMARY KEY, parent_job_id TEXT NOT NULL,
        source_output_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
        metadata_json TEXT NOT NULL, state TEXT NOT NULL,
        retryable INTEGER NOT NULL DEFAULT 0,
        cancellation_requested INTEGER NOT NULL DEFAULT 0,
        progress_json TEXT, output_id TEXT, provenance_record_id TEXT,
        provenance_json TEXT, error_code TEXT, error_message TEXT,
        started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO meta VALUES ('schema', '1');
      INSERT INTO jobs VALUES (
        'legacy-job', 'image', 'txt2img', '{}', NULL, NULL, 0, 'done',
        'interactive', NULL, NULL, '2026-08-28T00:00:00.000Z',
        '2026-08-28T00:00:00.000Z'
      );
      INSERT INTO generations VALUES (
        '${"a".repeat(64)}', 'image', '{"prompt":"legacy"}',
        '2026-08-28T00:00:00.000Z'
      );
    `);
    legacy.close();

    const { database, queue, index } = shared(dbPath);
    expect(queue.get("legacy-job")?.enhancement).toBeNull();
    expect(index.get("a".repeat(64))?.workflow.prompt).toBe("legacy");
    const columns = database.connection
      .prepare("PRAGMA table_info(jobs)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("enhancement_json");
    const enhancementColumns = database.connection
      .prepare("PRAGMA table_info(enhancement_runs)")
      .all() as Array<{ name: string }>;
    expect(enhancementColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "error_stage",
        "error_diagnostics",
        "error_termination_confirmed",
      ]),
    );
    expect(
      database.connection
        .prepare("SELECT value FROM meta WHERE key = 'schema'")
        .get(),
    ).toEqual({ value: "4" });
    expect(database.connection.pragma("user_version", { simple: true })).toBe(
      4,
    );
  });

  it("persists parent lineage, typed enhancement metadata, and progress", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-progress");
    const metadata = enhancementMetadata(
      "parent-progress",
      source,
      "00000000-0000-4000-8000-000000000001",
    );
    enqueueEnhancement(queue, "parent-progress", "child-progress", metadata);
    queue.markRunning("child-progress");
    expect(
      queue.updateEnhancementProgress("child-progress", {
        requestId: metadata.request.requestId,
        childJobId: "child-progress",
        stage: "upscale",
        stageIndex: 1,
        stageCount: 2,
        processedFrames: 5,
        totalFrames: 10,
        percent: 50,
        message: "Upscaling",
      }),
    ).toBe(true);
    const job = queue.get("child-progress");
    const run = queue.getEnhancementRun("child-progress");
    expect(job?.parentId).toBe("parent-progress");
    expect(job?.enhancement).toEqual(metadata);
    expect(run).toMatchObject({
      parentJobId: "parent-progress",
      sourceOutputId: source.outputId,
      state: "running",
      retryable: false,
      progress: { percent: 50, message: "Upscaling" },
    });
  });

  it("claims only runnable enhancement rows and cannot revive a terminal child", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-claim");
    const first = enhancementMetadata(
      "parent-claim",
      source,
      "00000000-0000-4000-8000-000000000008",
    );
    const second = enhancementMetadata(
      "parent-claim",
      source,
      "00000000-0000-4000-8000-000000000009",
    );
    enqueueEnhancement(queue, "parent-claim", "child-skipped", first);
    enqueueEnhancement(queue, "parent-claim", "child-claimed", second);
    queue.requestEnhancementCancellation("child-skipped");

    expect(queue.nextQueued()?.id).toBe("child-claimed");
    expect(queue.claimNext()?.id).toBe("child-claimed");
    expect(queue.getEnhancementRun("child-claimed")?.state).toBe("running");
    expect(queue.get("child-skipped")?.state).toBe("queued");
    queue.markEnhancementFailed("child-claimed", {
      code: "process_failed",
      message: "failed",
      retryable: true,
    });
    expect(() => queue.markRunning("child-claimed")).toThrow(/cannot start/);
  });

  it("rejects incomplete, mismatched, and duplicate enhancement lineage", () => {
    const { queue, index } = shared();
    const first = finishSource(queue, index, "parent-one");
    const second = finishSource(queue, index, "parent-two");
    const requestId = "00000000-0000-4000-8000-000000000002";
    const metadata = enhancementMetadata("parent-one", first, requestId);
    enqueueEnhancement(queue, "parent-one", "child-one", metadata);
    expect(() =>
      enqueueEnhancement(queue, "parent-one", "child-mismatch", {
        ...metadata,
        sourceOutputId: second.outputId,
      }),
    ).toThrow(/does not belong/);
    expect(() =>
      enqueueEnhancement(
        queue,
        "parent-one",
        "child-duplicate-request",
        metadata,
      ),
    ).toThrow(/UNIQUE/);
    expect(queue.get("child-duplicate-request")).toBeNull();

    queue.enqueue({
      id: "parent-incomplete",
      pillar: "video",
      jobType: "txt2vid",
      parameters: {},
    });
    expect(() =>
      index.putOutput({
        id: "incomplete-output",
        jobId: "parent-incomplete",
        pillar: "video",
        outputPath: path.join(tmpdir(), "incomplete.mp4"),
        contentHash: "b".repeat(64),
        workflow: {},
      }),
    ).toThrow(/completed job/);
  });

  // v2.4.8 follow-up (2026-09-07): an interactive job from a previous run was
  // re-queued first on every launch and re-run, holding the GPU in front of
  // each new request while nobody was polling it any more.
  it("fails unfinished interactive jobs on restart and re-queues batch jobs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-interactive-recovery-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "studio.db");
    const first = shared(dbPath);
    first.queue.enqueue({
      id: "interactive-running",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "a" },
      priority: "interactive",
    });
    first.queue.markRunning("interactive-running");
    first.queue.enqueue({
      id: "interactive-queued",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "b" },
      priority: "interactive",
    });
    first.queue.enqueue({
      id: "batch-running",
      pillar: "image",
      jobType: "txt2img",
      parameters: { prompt: "c" },
      priority: "batch",
    });
    first.queue.markRunning("batch-running");
    first.queue.close();
    first.index.close();
    first.database.close();

    const second = shared(dbPath);
    expect(second.queue.get("interactive-running")).toMatchObject({
      state: "failed",
      error: INTERRUPTED_BY_RESTART,
    });
    expect(second.queue.get("interactive-queued")).toMatchObject({
      state: "failed",
      error: INTERRUPTED_BY_RESTART,
    });
    expect(second.queue.get("batch-running")?.state).toBe("queued");
    expect(second.queue.nextQueued()?.id).toBe("batch-running");
    second.queue.close();
    second.index.close();
    second.database.close();
  });

  it("leaves a restarted running enhancement interrupted and retryable", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-enhancement-recovery-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "studio.db");
    const first = shared(dbPath);
    const source = finishSource(first.queue, first.index, "parent-restart");
    enqueueEnhancement(
      first.queue,
      "parent-restart",
      "child-restart",
      enhancementMetadata(
        "parent-restart",
        source,
        "00000000-0000-4000-8000-000000000003",
      ),
    );
    first.queue.markRunning("child-restart");
    first.queue.updateEnhancementProgress("child-restart", {
      requestId: "00000000-0000-4000-8000-000000000003",
      childJobId: "child-restart",
      stage: "interpolate",
      stageIndex: 1,
      stageCount: 1,
      percent: 25,
      message: "Interpolating",
    });
    first.queue.close();
    first.index.close();
    first.database.close();

    const second = shared(dbPath);
    expect(second.queue.get("child-restart")?.state).toBe("interrupted");
    expect(second.queue.getEnhancementRun("child-restart")).toMatchObject({
      state: "interrupted",
      retryable: true,
      outputId: null,
      errorStage: "interpolate",
      errorDiagnostics: null,
      errorTerminationConfirmed: null,
    });
    second.queue.recover();
    expect(second.queue.get("child-restart")?.state).toBe("interrupted");
  });

  it("commits queue, legacy index, output, lineage, and outbox atomically", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-complete");
    enqueueEnhancement(
      queue,
      "parent-complete",
      "child-complete",
      enhancementMetadata(
        "parent-complete",
        source,
        "00000000-0000-4000-8000-000000000004",
      ),
    );
    complete(queue, "child-complete", "complete");

    const output = index.getOutputForJob("child-complete");
    expect(queue.get("child-complete")?.state).toBe("done");
    expect(output?.outputPath).toMatch(/child-complete-complete\.mp4$/);
    expect(index.get(output?.contentHash ?? "")?.workflow.childJobId).toBe(
      "child-complete",
    );
    expect(index.getEnhancementRun("child-complete")).toMatchObject({
      state: "completed",
      sourceOutputId: source.outputId,
      outputId: output?.id,
      provenanceRecordId: "child-complete-provenance",
      provenance: { childJobId: "child-complete", outcome: "completed" },
    });
    expect(index.listPendingCompletions()).toEqual([
      expect.objectContaining({
        id: "child-complete-outbox",
        jobId: "child-complete",
        eventType: "video.enhancement.completed",
      }),
    ]);
    expect(
      index.markCompletionDelivered(
        "child-complete-outbox",
        "2026-08-28T13:00:00.000Z",
      ),
    ).toBe(true);
    expect(index.listPendingCompletions()).toEqual([]);
  });

  it("rolls back every completion write when the final outbox insert conflicts", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-rollback");
    enqueueEnhancement(
      queue,
      "parent-rollback",
      "child-first",
      enhancementMetadata(
        "parent-rollback",
        source,
        "00000000-0000-4000-8000-000000000005",
      ),
    );
    enqueueEnhancement(
      queue,
      "parent-rollback",
      "child-second",
      enhancementMetadata(
        "parent-rollback",
        source,
        "00000000-0000-4000-8000-000000000006",
      ),
    );
    complete(queue, "child-first", "first", "duplicate-outbox");
    queue.markRunning("child-second");
    const secondHash = createHash("sha256")
      .update("enhanced:second")
      .digest("hex");
    expect(() =>
      queue.completeEnhancement({
        childJobId: "child-second",
        output: {
          id: "child-second-output",
          outputPath: path.join(tmpdir(), "child-second-second.mp4"),
          contentHash: secondHash,
          workflow: { childJobId: "child-second" },
        },
        provenanceRecordId: "child-second-provenance",
        provenance: { childJobId: "child-second" },
        outbox: {
          id: "duplicate-outbox",
          payload: { childJobId: "child-second" },
        },
      }),
    ).toThrow(/UNIQUE/);

    expect(queue.get("child-second")?.state).toBe("running");
    expect(index.getEnhancementRun("child-second")).toMatchObject({
      state: "running",
      outputId: null,
      provenanceRecordId: null,
    });
    expect(index.getOutput("child-second-output")).toBeNull();
    expect(index.get(secondHash)).toBeNull();
    expect(index.listPendingCompletions()).toHaveLength(1);
  });

  it("makes cancellation authoritative over a later completion", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-cancel");
    enqueueEnhancement(
      queue,
      "parent-cancel",
      "child-cancel",
      enhancementMetadata(
        "parent-cancel",
        source,
        "00000000-0000-4000-8000-000000000007",
      ),
    );
    queue.markRunning("child-cancel");
    expect(queue.cancel("child-cancel")?.state).toBe("running");
    expect(queue.getEnhancementRun("child-cancel")?.cancellationRequested).toBe(
      true,
    );
    expect(() =>
      queue.completeEnhancement({
        childJobId: "child-cancel",
        output: {
          id: "child-cancel-output",
          outputPath: path.join(tmpdir(), "child-cancel.mp4"),
          contentHash: "c".repeat(64),
          workflow: {},
        },
        provenanceRecordId: "child-cancel-provenance",
        provenance: {},
        outbox: { id: "child-cancel-outbox", payload: {} },
      }),
    ).toThrow(/cancelled/);
    expect(index.getOutput("child-cancel-output")).toBeNull();
  });

  it("keeps the first terminal failure authoritative and persists interruption separately", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-terminal-cas");
    enqueueEnhancement(
      queue,
      "parent-terminal-cas",
      "child-terminal-cas",
      enhancementMetadata(
        "parent-terminal-cas",
        source,
        "00000000-0000-4000-8000-000000000010",
      ),
    );
    queue.markRunning("child-terminal-cas");
    queue.markEnhancementFailed("child-terminal-cas", {
      code: "process_timeout",
      message: "timed out",
      retryable: true,
      stage: "upscale",
      diagnostics: "deadline exceeded",
      terminationConfirmed: false,
    });
    queue.markEnhancementFailed("child-terminal-cas", {
      code: "cancelled",
      message: "cancelled later",
      retryable: true,
    });
    expect(index.getEnhancementRun("child-terminal-cas")).toMatchObject({
      state: "failed",
      errorCode: "process_timeout",
      errorMessage: "timed out",
      errorStage: "upscale",
      errorDiagnostics: "deadline exceeded",
      errorTerminationConfirmed: false,
    });

    enqueueEnhancement(
      queue,
      "parent-terminal-cas",
      "child-interrupted",
      enhancementMetadata(
        "parent-terminal-cas",
        source,
        "00000000-0000-4000-8000-000000000011",
      ),
    );
    queue.markRunning("child-interrupted");
    expect(
      queue.markEnhancementInterrupted(
        "child-interrupted",
        "process tree termination was not confirmed",
        "publish",
        "shutdown deadline exceeded",
        false,
      ),
    ).toMatchObject({
      state: "interrupted",
      retryable: true,
      errorCode: null,
      errorStage: "publish",
      errorDiagnostics: "shutdown deadline exceeded",
      errorTerminationConfirmed: false,
    });
    expect(queue.get("child-interrupted")?.state).toBe("interrupted");
  });

  it("enriches interrupted and cancelled evidence monotonically without rewriting terminal facts", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-evidence-enrichment");
    enqueueEnhancement(
      queue,
      "parent-evidence-enrichment",
      "child-evidence-interrupted",
      enhancementMetadata(
        "parent-evidence-enrichment",
        source,
        "00000000-0000-4000-8000-000000000014",
      ),
    );
    queue.markRunning("child-evidence-interrupted");
    const firstInterrupted = queue.markEnhancementInterrupted(
      "child-evidence-interrupted",
      "shutdown interrupted the process",
      "upscale",
      "termination pending",
      false,
    );
    const interruptedCompletedAt = firstInterrupted?.completedAt;
    const interruptedStartedAt = firstInterrupted?.startedAt;
    queue.markEnhancementInterrupted(
      "child-evidence-interrupted",
      "later message must not replace the first terminal cause",
      "validate",
      "process tree exited",
      true,
    );
    queue.markEnhancementInterrupted(
      "child-evidence-interrupted",
      "regressive evidence",
      "preflight",
      null,
      false,
    );
    expect(index.getEnhancementRun("child-evidence-interrupted")).toMatchObject(
      {
        state: "interrupted",
        retryable: true,
        errorCode: null,
        errorMessage: "shutdown interrupted the process",
        errorStage: "validate",
        errorDiagnostics: "termination pending\nprocess tree exited",
        errorTerminationConfirmed: true,
        startedAt: interruptedStartedAt,
        completedAt: interruptedCompletedAt,
      },
    );
    expect(queue.get("child-evidence-interrupted")).toMatchObject({
      state: "interrupted",
      error: "shutdown interrupted the process",
    });

    enqueueEnhancement(
      queue,
      "parent-evidence-enrichment",
      "child-evidence-cancelled",
      enhancementMetadata(
        "parent-evidence-enrichment",
        source,
        "00000000-0000-4000-8000-000000000015",
      ),
    );
    queue.markRunning("child-evidence-cancelled");
    queue.requestEnhancementCancellation("child-evidence-cancelled");
    const firstCancelled = queue.markEnhancementFailed(
      "child-evidence-cancelled",
      {
        code: "cancelled",
        message: "cancel requested",
        retryable: true,
        stage: "upscale",
        diagnostics: "termination pending",
        terminationConfirmed: false,
      },
    );
    const cancelledCompletedAt = firstCancelled?.completedAt;
    queue.markEnhancementFailed("child-evidence-cancelled", {
      code: "process_failed",
      message: "late backend failure must not replace cancellation",
      retryable: false,
      stage: "validate",
      diagnostics: "process tree exited",
      terminationConfirmed: true,
    });
    expect(index.getEnhancementRun("child-evidence-cancelled")).toMatchObject({
      state: "cancelled",
      retryable: true,
      cancellationRequested: true,
      errorCode: "cancelled",
      errorMessage: "cancel requested",
      errorStage: "validate",
      errorDiagnostics: "termination pending\nprocess tree exited",
      errorTerminationConfirmed: true,
      completedAt: cancelledCompletedAt,
    });
    expect(queue.get("child-evidence-cancelled")).toMatchObject({
      state: "failed",
      error: "cancel requested",
    });
    expect(() =>
      queue.completeEnhancement({
        childJobId: "child-evidence-cancelled",
        output: {
          id: "child-evidence-cancelled-output",
          outputPath: path.join(tmpdir(), "child-evidence-cancelled.mp4"),
          contentHash: "d".repeat(64),
          workflow: {},
        },
        provenanceRecordId: "child-evidence-cancelled-provenance",
        provenance: {},
        outbox: {
          id: "child-evidence-cancelled-outbox",
          payload: {},
        },
      }),
    ).toThrow(/running/);
    expect(index.getOutput("child-evidence-cancelled-output")).toBeNull();
  });

  it("keeps explicit shutdown interruption distinct after cancellation is requested", () => {
    const { queue, index } = shared();
    const source = finishSource(queue, index, "parent-cancel-interruption");
    enqueueEnhancement(
      queue,
      "parent-cancel-interruption",
      "child-cancel-interruption",
      enhancementMetadata(
        "parent-cancel-interruption",
        source,
        "00000000-0000-4000-8000-000000000016",
      ),
    );
    queue.markRunning("child-cancel-interruption");
    queue.requestEnhancementCancellation("child-cancel-interruption");
    queue.markEnhancementInterrupted(
      "child-cancel-interruption",
      "shutdown interrupted cancellation",
      "publish",
      "termination not confirmed",
      false,
    );
    queue.markEnhancementFailed("child-cancel-interruption", {
      code: "process_failed",
      message: "late backend failure",
      retryable: false,
      stage: "publish",
      diagnostics: "late process exit",
      terminationConfirmed: true,
    });

    expect(index.getEnhancementRun("child-cancel-interruption")).toMatchObject({
      state: "interrupted",
      retryable: true,
      cancellationRequested: true,
      errorCode: null,
      errorMessage: "shutdown interrupted cancellation",
      errorStage: "publish",
      errorDiagnostics: "termination not confirmed",
      errorTerminationConfirmed: false,
    });
    expect(queue.get("child-cancel-interruption")?.state).toBe("interrupted");
  });

  it("redacts secrets and bounds persisted enhancement diagnostics", () => {
    const { database, queue, index } = shared();
    const source = finishSource(queue, index, "parent-diagnostic-bounds");
    enqueueEnhancement(
      queue,
      "parent-diagnostic-bounds",
      "child-diagnostic-bounds",
      enhancementMetadata(
        "parent-diagnostic-bounds",
        source,
        "00000000-0000-4000-8000-000000000013",
      ),
    );
    queue.markRunning("child-diagnostic-bounds");
    const secret = `ghp_${"a".repeat(36)}`;
    queue.markEnhancementFailed("child-diagnostic-bounds", {
      code: "process_failed",
      message: "Backend failed.",
      retryable: false,
      stage: "validate",
      diagnostics: `token=${secret}\n${"x".repeat(9_000)}`,
      terminationConfirmed: true,
    });

    const run = queue.getEnhancementRun("child-diagnostic-bounds");
    expect(run).toMatchObject({
      state: "failed",
      errorStage: "validate",
      errorTerminationConfirmed: true,
    });
    expect(run?.errorDiagnostics).toContain("<redacted>");
    expect(run?.errorDiagnostics).not.toContain(secret);
    expect(run?.errorDiagnostics).toHaveLength(8_192);
    expect(() =>
      database.connection
        .prepare(
          "UPDATE enhancement_runs SET error_diagnostics = ? WHERE child_job_id = ?",
        )
        .run("x".repeat(8_193), "child-diagnostic-bounds"),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      database.connection
        .prepare(
          "UPDATE enhancement_runs SET error_stage = 'unknown' WHERE child_job_id = ?",
        )
        .run("child-diagnostic-bounds"),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      database.connection
        .prepare(
          "UPDATE enhancement_runs SET error_termination_confirmed = 2 WHERE child_job_id = ?",
        )
        .run("child-diagnostic-bounds"),
    ).toThrow(/CHECK constraint/);
  });

  it("enforces one immutable output path per completed job", () => {
    const { queue, index } = shared();
    const first = finishSource(queue, index, "parent-path-one");
    queue.enqueue({
      id: "parent-path-two",
      pillar: "video",
      jobType: "txt2vid",
      parameters: {},
    });
    queue.markRunning("parent-path-two");
    queue.markDone("parent-path-two");
    expect(() =>
      index.putOutput({
        id: "parent-path-two-output",
        jobId: "parent-path-two",
        pillar: "video",
        outputPath: first.outputPath.toUpperCase(),
        contentHash: "d".repeat(64),
        workflow: {},
      }),
    ).toThrow(/UNIQUE/);
  });
});

describe("contentHashFile", () => {
  it("streams the complete file into the same SHA-256 as in-memory hashing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-content-hash-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "large.mp4");
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 31, 0x5a);
    writeFileSync(filePath, bytes);
    expect(await contentHashFile(filePath, { highWaterMark: 4093 })).toBe(
      contentHash(bytes),
    );
  });
});
