/**
 * v1.16.0 Phase 3 (adoption item A5) -- document-parse job manager.
 *
 * The load-bearing behaviours: a parse never blocks the IPC channel, a failure
 * arrives as a typed event rather than a thrown transport error, and a completed
 * job is forgotten so parsed document text cannot linger for the process
 * lifetime.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OcrParseManager,
  resetOcrJobIdFactory,
  setOcrJobIdFactory,
} from "../../core/documents/OcrParseManager";
import { InMemoryOcrRuntime } from "../../core/documents/OcrRuntimeClient";

const OK_ENVELOPE = {
  ok: true,
  engine: "stub",
  text: "hello world",
  markdown: null,
  pageCount: 2,
  pages: [
    { index: 0, text: "hello" },
    { index: 1, text: "world" },
  ],
};

/** Let the manager's in-flight promise settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let runtime: InMemoryOcrRuntime;
let manager: OcrParseManager;

beforeEach(() => {
  let n = 0;
  setOcrJobIdFactory(() => `job-${++n}`);
  runtime = new InMemoryOcrRuntime();
  manager = new OcrParseManager(runtime);
});

afterEach(() => resetOcrJobIdFactory());

describe("OcrParseManager.start", () => {
  it("returns a job id immediately without awaiting the parse", () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    expect(manager.start({ documentBase64: "AAAA" })).toBe("job-1");
  });

  it("forwards the request to the runtime under a jobId", async () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    manager.start({ documentBase64: "AAAA", engine: "stub", dpi: 150 });
    await settle();
    expect(runtime.lastParams).toMatchObject({
      jobId: "job-1",
      request: { documentBase64: "AAAA", engine: "stub", dpi: 150 },
    });
  });

  it("issues distinct ids for concurrent jobs", () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    expect(manager.start({ documentBase64: "A" })).not.toBe(
      manager.start({ documentBase64: "B" }),
    );
  });
});

describe("OcrParseManager.drain", () => {
  it("reports the terminal result once the parse completes", async () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    const jobId = manager.start({ documentBase64: "AAAA" });
    await settle();
    const drained = manager.drain(jobId);
    expect(drained.done).toBe(true);
    expect(drained.events.map((e) => e.kind)).toContain("complete");
    expect(drained.result).toMatchObject({ engine: "stub", pageCount: 2 });
    expect(drained.result?.pages).toHaveLength(2);
  });

  it("is not done while the parse is still running", () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    const jobId = manager.start({ documentBase64: "AAAA" });
    expect(manager.drain(jobId).done).toBe(false);
  });

  it("merges the runtime's per-page progress events", async () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    const jobId = manager.start({ documentBase64: "AAAA" });
    runtime.emit({ kind: "progress", jobId, page: 1, totalPages: 2 } as never);
    runtime.emit({ kind: "progress", jobId, page: 2, totalPages: 2 } as never);
    await settle();
    const progress = manager
      .drain(jobId)
      .events.filter((e) => e.kind === "progress")
      .map((e) => [e.page, e.totalPages]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("turns a failure envelope into an error event, not a throw", async () => {
    runtime.setResponse("parse", {
      ok: false,
      error: "model-not-installed",
      message: "install it from Settings > Models",
    });
    const jobId = manager.start({ documentBase64: "AAAA" });
    await settle();
    const drained = manager.drain(jobId);
    expect(drained.done).toBe(true);
    expect(drained.result).toBeNull();
    const error = drained.events.find((e) => e.kind === "error");
    expect(error?.message).toContain("Settings > Models");
  });

  it("surfaces a transport failure as an error event", async () => {
    runtime.setError("parse", "ocr-runtime-exited");
    const jobId = manager.start({ documentBase64: "AAAA" });
    await settle();
    const error = manager.drain(jobId).events.find((e) => e.kind === "error");
    expect(error?.message).toContain("ocr-runtime-exited");
  });

  it("handles a null envelope defensively", async () => {
    runtime.setResponse("parse", null);
    const jobId = manager.start({ documentBase64: "AAAA" });
    await settle();
    expect(manager.drain(jobId).events.some((e) => e.kind === "error")).toBe(true);
  });

  it("forgets a finished job so parsed text does not linger", async () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    const jobId = manager.start({ documentBase64: "AAAA" });
    await settle();
    expect(manager.activeJobs).toBe(1);
    manager.drain(jobId);
    expect(manager.activeJobs).toBe(0);
    // A second drain of the same id is an unknown job, not stale text.
    const again = manager.drain(jobId);
    expect(again.result).toBeNull();
    expect(again.events[0]?.message).toContain("unknown job");
  });

  it("reports an unknown job id as done with an error", () => {
    const drained = manager.drain("nope");
    expect(drained.done).toBe(true);
    expect(drained.events[0]?.kind).toBe("error");
  });
});

describe("OcrParseManager.cancel", () => {
  it("marks the job cancelled and discards its result", async () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    const jobId = manager.start({ documentBase64: "AAAA" });
    manager.cancel(jobId);
    await settle();
    const drained = manager.drain(jobId);
    expect(drained.done).toBe(true);
    expect(drained.result).toBeNull();
    expect(drained.events[0]?.message).toBe("cancelled");
  });

  it("is a no-op for an unknown id", () => {
    expect(() => manager.cancel("nope")).not.toThrow();
  });

  it("is idempotent", async () => {
    runtime.setResponse("parse", OK_ENVELOPE);
    const jobId = manager.start({ documentBase64: "AAAA" });
    manager.cancel(jobId);
    manager.cancel(jobId);
    await settle();
    expect(manager.drain(jobId).events).toHaveLength(1);
  });
});
