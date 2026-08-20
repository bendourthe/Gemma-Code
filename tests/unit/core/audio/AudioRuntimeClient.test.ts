import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { ChildProcessAudioRuntime } from "../../../../core/audio/AudioRuntimeClient.js";

function fakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  };
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", 0);
    return true;
  };
  stdin.on("data", (buf: Buffer) => {
    const line = String(buf).trim();
    if (!line) return;
    const req = JSON.parse(line) as { id: number; method: string };
    if (req.method === "health") {
      stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            ok: true,
            stt: { available: false, reason: "missing" },
            tts: { available: false, reason: "missing" },
            platform: "fake",
          },
        })}\n`,
      );
      return;
    }
    if (req.method === "transcribe") {
      stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { transcript: "hello" } })}\n`,
      );
      return;
    }
    stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { message: "nope" } })}\n`,
    );
  });
  return child;
}

describe("ChildProcessAudioRuntime", () => {
  it("health and transcribe round-trip over JSON-RPC stdio", async () => {
    const runtime = new ChildProcessAudioRuntime({
      spawnFn: (() => fakeChild()) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 2000,
    });
    const health = await runtime.health();
    expect(health.platform).toBe("fake");
    const text = await runtime.transcribe({ audioBase64: "AAAA" });
    expect(text.origin).toBe("stt_transcript");
    expect(text.transcript).toContain("hello");
    await runtime.shutdown();
  });

  it("times out when the child never replies", async () => {
    const runtime = new ChildProcessAudioRuntime({
      spawnFn: (() => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const child = new EventEmitter() as EventEmitter & {
          stdin: PassThrough;
          stdout: PassThrough;
          stderr: PassThrough;
          kill: () => boolean;
        };
        child.stdin = stdin;
        child.stdout = stdout;
        child.stderr = new PassThrough();
        child.kill = () => true;
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 30,
    });
    await expect(runtime.health()).rejects.toThrow(/timeout/i);
    await runtime.shutdown();
  });

  it("ignores a non-JSON stdout line and still answers the next request", async () => {
    const runtime = new ChildProcessAudioRuntime({
      spawnFn: (() => {
        const child = fakeChild();
        queueMicrotask(() => child.stdout.write("not-json\n"));
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 2000,
    });
    const health = await runtime.health();
    expect(health.platform).toBe("fake");
    await runtime.shutdown();
  });

  it("rejects in-flight calls when the child exits", async () => {
    const runtime = new ChildProcessAudioRuntime({
      spawnFn: (() => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const child = new EventEmitter() as EventEmitter & {
          stdin: PassThrough;
          stdout: PassThrough;
          stderr: PassThrough;
          kill: () => boolean;
        };
        child.stdin = stdin;
        child.stdout = stdout;
        child.stderr = new PassThrough();
        child.kill = () => true;
        queueMicrotask(() => child.emit("exit", 1));
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
      requestTimeoutMs: 2000,
    });
    await expect(runtime.health()).rejects.toThrow(/audio-runtime-exited/);
    await runtime.shutdown();
  });
});
