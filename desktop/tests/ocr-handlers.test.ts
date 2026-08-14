/**
 * v1.16.0 Phase 3 (adoption item A5) -- the `ocr.*` IPC handlers.
 *
 * Asserts the handlers route to the injected runtime, that every response
 * validates against its strict wire schema, and that a missing Python runtime is
 * reported as an explained unhealthy state rather than an IPC failure.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import {
  OcrHealthResponse,
  OcrJobAccepted,
  OcrJobDrainResponse,
  type OcrHealthResponseT,
  type OcrJobDrainResponseT,
} from "../sidecar/src/protocol";
import { OcrParseManager, resetOcrJobIdFactory, setOcrJobIdFactory } from "../../core/documents/OcrParseManager";
import { InMemoryOcrRuntime } from "../../core/documents/OcrRuntimeClient";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let runtime: InMemoryOcrRuntime;

function ctx() {
  return createHandlerContext(
    { pid: 1, platform: process.platform },
    new CodingSessionManager(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { client: runtime, parser: new OcrParseManager(runtime) },
  );
}

beforeEach(() => {
  let n = 0;
  setOcrJobIdFactory(() => `job-${++n}`);
  runtime = new InMemoryOcrRuntime();
});

afterEach(() => resetOcrJobIdFactory());

describe("ocr.health", () => {
  it("maps the runtime's per-engine availability", async () => {
    runtime.setResponse("health", {
      ok: true,
      device: "cpu",
      platform: "Darwin/arm64",
      vramTotalGB: null,
      engines: {
        rapidocr: { available: true, reason: "ready (CPU)" },
        "unlimited-ocr": { available: false, reason: "NVIDIA-only" },
      },
    });
    const reply = (await dispatch("ocr.health", {}, ctx())) as OcrHealthResponseT;
    expect(OcrHealthResponse.safeParse(reply).success).toBe(true);
    expect(reply.ok).toBe(true);
    expect(reply.engines["unlimited-ocr"]?.available).toBe(false);
  });

  it("reports a missing Python runtime as unhealthy with a reason", async () => {
    runtime.setError("health", "spawn python ENOENT");
    const reply = (await dispatch("ocr.health", {}, ctx())) as OcrHealthResponseT;
    expect(reply.ok).toBe(false);
    expect(reply.engines.rapidocr?.reason).toContain("ENOENT");
    // Still a well-formed response -- the UI can render it.
    expect(OcrHealthResponse.safeParse(reply).success).toBe(true);
  });
});

describe("ocr.parseDocument", () => {
  it("accepts a parse and returns a job id", async () => {
    runtime.setResponse("parse", { ok: true, engine: "stub", text: "x", pageCount: 1, pages: [] });
    const reply = await dispatch("ocr.parseDocument", { documentBase64: "AAAA" }, ctx());
    expect(OcrJobAccepted.safeParse(reply).success).toBe(true);
  });

  it("rejects a missing payload via the strict schema", async () => {
    await expect(dispatch("ocr.parseDocument", {}, ctx())).rejects.toThrow();
  });

  it("rejects an unknown engine via the strict schema", async () => {
    await expect(
      dispatch("ocr.parseDocument", { documentBase64: "AAAA", engine: "nope" }, ctx()),
    ).rejects.toThrow();
  });

  it("rejects unexpected params", async () => {
    await expect(
      dispatch("ocr.parseDocument", { documentBase64: "AAAA", bogus: 1 }, ctx()),
    ).rejects.toThrow();
  });
});

describe("ocr.job.drainEvents", () => {
  it("returns a schema-valid terminal drain", async () => {
    runtime.setResponse("parse", {
      ok: true,
      engine: "rapidocr",
      text: "hello",
      markdown: null,
      pageCount: 1,
      pages: [{ index: 0, text: "hello" }],
    });
    const context = ctx();
    const accepted = (await dispatch(
      "ocr.parseDocument",
      { documentBase64: "AAAA" },
      context,
    )) as { jobId: string };
    await settle();
    const drained = (await dispatch(
      "ocr.job.drainEvents",
      { jobId: accepted.jobId },
      context,
    )) as OcrJobDrainResponseT;
    expect(OcrJobDrainResponse.safeParse(drained).success).toBe(true);
    expect(drained.done).toBe(true);
    expect(drained.result?.text).toBe("hello");
  });

  it("returns a null result for an unknown job", async () => {
    const drained = (await dispatch(
      "ocr.job.drainEvents",
      { jobId: "nope" },
      ctx(),
    )) as OcrJobDrainResponseT;
    expect(drained.result).toBeNull();
    expect(OcrJobDrainResponse.safeParse(drained).success).toBe(true);
  });
});

describe("ocr.job.cancel", () => {
  it("cancels a running job", async () => {
    runtime.setResponse("parse", { ok: true, engine: "stub", text: "x", pageCount: 1, pages: [] });
    const context = ctx();
    const accepted = (await dispatch(
      "ocr.parseDocument",
      { documentBase64: "AAAA" },
      context,
    )) as { jobId: string };
    expect(await dispatch("ocr.job.cancel", { jobId: accepted.jobId }, context)).toEqual({
      ok: true,
    });
    await settle();
    const drained = (await dispatch(
      "ocr.job.drainEvents",
      { jobId: accepted.jobId },
      context,
    )) as OcrJobDrainResponseT;
    expect(drained.result).toBeNull();
  });

  it("is a no-op for an unknown job", async () => {
    expect(await dispatch("ocr.job.cancel", { jobId: "nope" }, ctx())).toEqual({ ok: true });
  });
});
