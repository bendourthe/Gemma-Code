import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import {
  ChildProcessDiffusionRuntime,
  InMemoryDiffusionRuntime,
  DEFAULT_DIFFUSION_REQUEST_TIMEOUT_MS,
  GENERATION_DIFFUSION_REQUEST_TIMEOUT_MS,
  diffusionRequestTimeoutMs,
} from "../sidecar/src/diffusion/runtimeClient";

class FakeChild extends EventEmitter {
  public readonly stdin: Writable;
  public readonly stdout: Readable;
  public readonly stderr: Readable;
  public written = "";
  constructor() {
    super();
    const self = this;
    this.stdin = new Writable({
      write(chunk, _enc, cb) {
        self.written += chunk.toString();
        cb();
      },
    });
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  kill(): boolean {
    this.emit("exit", 0);
    return true;
  }
  emitStdout(line: string): void {
    this.stdout.push(`${line}\n`);
  }
}

/** Let the microtask queue and one macrotask drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 1));
}

describe("InMemoryDiffusionRuntime", () => {
  it("returns stubbed responses", async () => {
    const rt = new InMemoryDiffusionRuntime();
    rt.setResponse("health", { ok: true });
    await expect(rt.call("health", {})).resolves.toEqual({ ok: true });
  });

  it("rejects when no response is stubbed", async () => {
    const rt = new InMemoryDiffusionRuntime();
    await expect(rt.call("missing", {})).rejects.toThrow(/no response stubbed/);
  });

  it("yields stubbed errors", async () => {
    const rt = new InMemoryDiffusionRuntime();
    rt.setError("boom", "fail");
    await expect(rt.call("boom", {})).rejects.toThrow(/fail/);
  });

  it("queues + drains events per job id", () => {
    const rt = new InMemoryDiffusionRuntime();
    rt.emit({ kind: "progress", jobId: "j1", step: 1, totalSteps: 4 });
    rt.emit({ kind: "complete", jobId: "j1" });
    rt.emit({ kind: "progress", jobId: "j2", step: 2, totalSteps: 4 });
    const drainedA = rt.drainEvents("j1");
    expect(drainedA).toHaveLength(2);
    expect(rt.drainEvents("j1")).toHaveLength(0);
    expect(rt.drainEvents("j2")).toHaveLength(1);
  });

  it("shutdown clears state", async () => {
    const rt = new InMemoryDiffusionRuntime();
    rt.emit({ kind: "progress", jobId: "j1", step: 1 });
    rt.setResponse("x", 1);
    await rt.shutdown();
    expect(rt.drainEvents("j1")).toHaveLength(0);
  });
});

describe("ChildProcessDiffusionRuntime", () => {
  it("spawns a child on first call and parses responses", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 500,
    });
    const pending = rt.call("health", {});
    // Allow the request to flush before we respond.
    await Promise.resolve();
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fake.written).toContain("\"method\":\"health\"");
    await rt.shutdown();
  });

  it("queues notifications by job id", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 500,
    });
    // Trigger spawn by issuing a call we will resolve.
    const pending = rt.call("health", {});
    await Promise.resolve();
    fake.emitStdout(JSON.stringify({ kind: "progress", jobId: "abc", step: 2, totalSteps: 4 }));
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    await pending;
    expect(rt.drainEvents("abc")).toHaveLength(1);
    await rt.shutdown();
  });

  // v2.4.8 follow-up (2026-09-07): the Python runtime emits JSON-RPC
  // notifications, so the job id lives under `params`. Reading only the top
  // level dropped every loading / generating / heartbeat event.
  // v2.4.8 follow-up (2026-09-07): the runtime runs job methods on worker
  // threads, and a first torch import from one of those never finishes on
  // Windows -- the operator's runtime emitted 169 heartbeats without reaching
  // a single pipeline stage. `health` is a control method and runs inline on
  // the runtime's main thread, so it is always sent first on a fresh spawn.
  it("warms a fresh runtime with health before it sends the first job", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 500,
      readyTimeoutMs: 500,
    });
    const job = rt.call("txt2img", { jobId: "j1" });
    await settle();
    expect(fake.written).toContain('"method":"health"');
    expect(fake.written).not.toContain('"method":"txt2img"');
    // The job goes out only once the runtime has answered.
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    await settle();
    expect(fake.written).toContain('"method":"txt2img"');
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }));
    await expect(job).resolves.toEqual({ ok: true });
    // Already warm: a second job is sent without another health.
    const before = (fake.written.match(/"method":"health"/g) ?? []).length;
    const second = rt.call("txt2img", { jobId: "j2" });
    await settle();
    expect((fake.written.match(/"method":"health"/g) ?? []).length).toBe(before);
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { ok: true } }));
    await expect(second).resolves.toEqual({ ok: true });
    await rt.shutdown();
  });

  it("sends health itself without waiting on a warm-up", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 500,
    });
    const pending = rt.call("health", {});
    await settle();
    expect((fake.written.match(/"method":"health"/g) ?? []).length).toBe(1);
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
    await rt.shutdown();
  });

  it("queues JSON-RPC notifications whose payload sits under params", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 500,
    });
    const pending = rt.call("health", {});
    await Promise.resolve();
    fake.emitStdout(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "progress",
        params: {
          kind: "progress",
          jobId: "job-9",
          stage: "loading",
          loadedBytes: 5,
          totalBytes: 10,
        },
      }),
    );
    fake.emitStdout(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    await pending;
    const drained = rt.drainEvents("job-9");
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ kind: "progress", stage: "loading", loadedBytes: 5 });
    await rt.shutdown();
  });

  it("surfaces RPC errors", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 500,
    });
    const pending = rt.call("health", {});
    await Promise.resolve();
    fake.emitStdout(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "bad" } }),
    );
    await expect(pending).rejects.toThrow(/bad/);
    await rt.shutdown();
  });

  it("times out when no response arrives", async () => {
    const fake = new FakeChild();
    const rt = new ChildProcessDiffusionRuntime({
      spawnFn: (() => fake) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 50,
    });
    await expect(rt.call("never", {})).rejects.toThrow(/timeout/);
    await rt.shutdown();
  });
});

describe("diffusionRequestTimeoutMs", () => {
  it("keeps status calls on the short default", () => {
    expect(diffusionRequestTimeoutMs("runtime.status")).toBe(
      DEFAULT_DIFFUSION_REQUEST_TIMEOUT_MS,
    );
  });

  it("gives generation methods 30 minutes for first GPU model load", () => {
    expect(diffusionRequestTimeoutMs("txt2img")).toBe(
      GENERATION_DIFFUSION_REQUEST_TIMEOUT_MS,
    );
    expect(diffusionRequestTimeoutMs("video.text2video")).toBe(
      GENERATION_DIFFUSION_REQUEST_TIMEOUT_MS,
    );
  });

  it("honors an explicit override", () => {
    expect(diffusionRequestTimeoutMs("txt2img", 50)).toBe(50);
  });
});
