import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import {
  ChildProcessDiffusionRuntime,
  InMemoryDiffusionRuntime,
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
