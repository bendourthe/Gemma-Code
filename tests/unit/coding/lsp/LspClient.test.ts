/**
 * v1.2.0 Phase 6.2 -- unit tests for `LspClient`.
 *
 * Uses an injected fake child process that scripts JSON-RPC frames over
 * stdin / stdout. The tests exercise:
 *   - request / response framing with Content-Length headers
 *   - initialize / didOpen / definition / references happy path
 *   - missing-server detection (launcher returns null)
 *   - request timeout
 *   - shutdown semantics
 */

import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  LspClient,
  type LspChildProcessLauncher,
  type LspLanguage,
} from "../../../../core/coding/lsp/LspClient.js";

class FakeStdout extends Readable {
  override _read(): void {
    // pull-based; tests push directly via this.push(...).
  }
  feed(buf: Buffer | string): void {
    this.push(typeof buf === "string" ? Buffer.from(buf, "utf-8") : buf);
  }
}

class FakeStdin extends Writable {
  written: Buffer = Buffer.alloc(0);
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    const b = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk;
    this.written = Buffer.concat([this.written, b]);
    cb();
  }
}

class FakeChild extends EventEmitter {
  readonly stdin: FakeStdin = new FakeStdin();
  readonly stdout: FakeStdout = new FakeStdout();
  readonly stderr: FakeStdout = new FakeStdout();
  exitCode: number | null = null;
  killCalled = false;
  kill(): boolean {
    this.killCalled = true;
    this.exitCode = 0;
    this.emit("close", 0);
    return true;
  }
}

function makeFakeLauncher(child: FakeChild): LspChildProcessLauncher {
  return {
    launch(): ChildProcess | null {
      return child as unknown as ChildProcess;
    },
  };
}

function buildFrame(payload: unknown): Buffer {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
  return Buffer.from(header + body, "utf-8");
}

function parseFramesFromStdin(buf: Buffer): unknown[] {
  const out: unknown[] = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const headerEnd = buf.indexOf("\r\n\r\n", cursor);
    if (headerEnd < 0) break;
    const header = buf.slice(cursor, headerEnd).toString("ascii");
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) break;
    const len = parseInt(m[1]!, 10);
    const bodyStart = headerEnd + 4;
    const body = buf.slice(bodyStart, bodyStart + len).toString("utf-8");
    out.push(JSON.parse(body));
    cursor = bodyStart + len;
  }
  return out;
}

describe("LspClient", () => {
  it("returns ok:false when the LSP server is not installed", async () => {
    const launcher: LspChildProcessLauncher = { launch: () => null };
    let missingNotice: { lang: LspLanguage; name: string } | null = null;
    const client = new LspClient({
      launcher,
      onServerMissing: (language, config) => {
        missingNotice = { lang: language, name: config.displayName };
      },
    });
    const res = await client.definition({
      language: "typescript",
      filePath: "/tmp/x.ts",
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not installed/);
    expect(missingNotice).not.toBeNull();
    expect(missingNotice!.lang).toBe("typescript");
    // Subsequent calls do not re-warn.
    let warnCount = 0;
    const client2 = new LspClient({
      launcher,
      onServerMissing: () => {
        warnCount += 1;
      },
    });
    await client2.definition({
      language: "typescript",
      filePath: "/tmp/x.ts",
      line: 0,
      column: 0,
      fileContents: "",
    });
    await client2.references({
      language: "typescript",
      filePath: "/tmp/x.ts",
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(warnCount).toBe(1);
    expect(client2.isServerAvailable("typescript")).toBe(false);
  });

  it("frames JSON-RPC correctly and decodes definition responses", async () => {
    const child = new FakeChild();
    const client = new LspClient({
      launcher: makeFakeLauncher(child),
      requestTimeoutMs: 1000,
    });

    // Helper that answers requests as they arrive.
    const answerNextRequest = (
      method: string,
      result: unknown,
    ): Promise<unknown> => {
      return new Promise((resolve) => {
        const tick = () => {
          const frames = parseFramesFromStdin(child.stdin.written);
          const found = frames.find((f) => {
            const obj = f as Record<string, unknown>;
            return obj["method"] === method && typeof obj["id"] === "number";
          }) as Record<string, unknown> | undefined;
          if (found) {
            child.stdout.feed(
              buildFrame({ jsonrpc: "2.0", id: found["id"], result }),
            );
            resolve(found);
          } else {
            setTimeout(tick, 5);
          }
        };
        tick();
      });
    };

    const expected = [
      {
        uri: "file:///tmp/x.ts",
        range: { start: { line: 5, character: 4 }, end: { line: 5, character: 10 } },
      },
    ];

    // The client will issue: initialize -> definition. Answer each in
    // order; the initialize result must resolve before definition is sent.
    const resPromise = client.definition({
      language: "typescript",
      filePath: "/tmp/x.ts",
      line: 5,
      column: 4,
      fileContents: "// hello",
    });
    await answerNextRequest("initialize", { capabilities: {} });
    await answerNextRequest("textDocument/definition", expected);
    const res = await resPromise;
    expect(res.ok).toBe(true);
    expect(res.locations).toEqual(expected);

    // The client emitted `initialized` and `textDocument/didOpen`
    // notifications (no id) interleaved with the two requests.
    const frames = parseFramesFromStdin(child.stdin.written);
    const methods = frames.map(
      (f) => (f as Record<string, unknown>)["method"],
    );
    expect(methods).toContain("initialize");
    expect(methods).toContain("initialized");
    expect(methods).toContain("textDocument/didOpen");
    expect(methods).toContain("textDocument/definition");
    await client.shutdown();
  });

  it("returns reference locations as an array even for single results", async () => {
    const child = new FakeChild();
    const client = new LspClient({
      launcher: makeFakeLauncher(child),
      requestTimeoutMs: 1000,
    });

    const answerNextRequest = (method: string, result: unknown) =>
      new Promise<void>((resolve) => {
        const tick = () => {
          const frames = parseFramesFromStdin(child.stdin.written);
          const found = frames.find((f) => {
            const obj = f as Record<string, unknown>;
            return obj["method"] === method && typeof obj["id"] === "number";
          }) as Record<string, unknown> | undefined;
          if (found) {
            child.stdout.feed(
              buildFrame({ jsonrpc: "2.0", id: found["id"], result }),
            );
            resolve();
          } else {
            setTimeout(tick, 5);
          }
        };
        tick();
      });

    const single = {
      uri: "file:///tmp/y.ts",
      range: { start: { line: 1, character: 1 }, end: { line: 1, character: 5 } },
    };

    const resPromise = client.references({
      language: "typescript",
      filePath: "/tmp/y.ts",
      line: 1,
      column: 1,
      fileContents: "// content",
    });
    await answerNextRequest("initialize", { capabilities: {} });
    await answerNextRequest("textDocument/references", single);
    const res = await resPromise;
    expect(res.ok).toBe(true);
    expect(res.locations).toHaveLength(1);
    expect(res.locations?.[0]?.uri).toBe(single.uri);
    await client.shutdown();
  });

  it("times out a request with no response", async () => {
    const child = new FakeChild();
    const client = new LspClient({
      launcher: makeFakeLauncher(child),
      requestTimeoutMs: 25,
    });
    const res = await client.definition({
      language: "python",
      filePath: "/tmp/m.py",
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/);
    await client.shutdown();
  });

  it("isServerAvailable reflects launcher result", () => {
    const launcherMissing: LspChildProcessLauncher = { launch: () => null };
    const c1 = new LspClient({ launcher: launcherMissing });
    // Force a launch attempt by issuing a request synchronously.
    void c1.definition({
      language: "rust",
      filePath: "/tmp/x.rs",
      line: 0,
      column: 0,
      fileContents: "",
    });
    expect(c1.isServerAvailable("rust")).toBe(false);
  });
});
