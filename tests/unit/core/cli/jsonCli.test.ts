import { describe, expect, it } from "vitest";

import {
  dispatchJsonCli,
  parseJsonInput,
  requireFields,
  SESSION_NEW_SCHEMA,
} from "../../../../core/cli/jsonCli.js";

describe("json CLI client", () => {
  it("rejects malformed JSON before touching the network", async () => {
    let called = 0;
    const result = await dispatchJsonCli({
      command: "session",
      subcommand: "new",
      flags: { json: "{not-json" },
      client: {
        baseUrl: "http://127.0.0.1:9",
        token: "t",
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      },
    });
    expect(called).toBe(0);
    expect(result.exitCode).toBe(2);
    expect((result.body as { error: { code: string } }).error.code).toBe("schema");
  });

  it("rejects missing schema fields before touching the network", async () => {
    let called = 0;
    const parsed = parseJsonInput("{}");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(requireFields(parsed.value, SESSION_NEW_SCHEMA.required)).toMatch(/modelId/);
    const result = await dispatchJsonCli({
      command: "session",
      subcommand: "new",
      flags: { json: "{}" },
      client: {
        baseUrl: "http://127.0.0.1:9",
        token: "t",
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      },
    });
    expect(called).toBe(0);
    expect(result.exitCode).toBe(2);
  });

  it("maps 401 to auth exit 1", async () => {
    const result = await dispatchJsonCli({
      command: "session",
      subcommand: "list",
      flags: {},
      client: {
        baseUrl: "http://127.0.0.1:11500",
        token: "bad",
        fetchImpl: async () => ({
          status: 401,
          ok: false,
          json: async () => ({ error: "nope" }),
        }),
      },
    });
    expect(result.exitCode).toBe(1);
    expect((result.body as { error: { code: string } }).error.code).toBe("auth");
  });

  it("maps connection failure to sidecar-down exit 1", async () => {
    const result = await dispatchJsonCli({
      command: "models",
      subcommand: "list",
      flags: {},
      client: {
        baseUrl: "http://127.0.0.1:1",
        token: "t",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    });
    expect(result.exitCode).toBe(1);
    expect((result.body as { error: { code: string } }).error.code).toBe("sidecar-down");
  });

  it("scripted session new/send against a stub fetch", async () => {
    const calls: string[] = [];
    const result = await dispatchJsonCli({
      command: "session",
      subcommand: "new",
      flags: { json: JSON.stringify({ modelId: "gemma4:e4b" }) },
      client: {
        baseUrl: "http://127.0.0.1:11500",
        token: "secret",
        fetchImpl: async (url, init) => {
          calls.push(`${init.method} ${url}`);
          expect(init.headers.authorization).toBe("Bearer secret");
          return {
            status: 200,
            ok: true,
            json: async () => ({ sessionId: "s-1", modelId: "gemma4:e4b" }),
          };
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toContain("/nexus/session/new");
  });

  it("rejects a JSON array before touching the network", async () => {
    const parsed = parseJsonInput("[]");
    expect(parsed.ok).toBe(false);
    const result = await dispatchJsonCli({
      command: "session",
      subcommand: "send",
      flags: { json: "[]" },
      client: {
        baseUrl: "http://127.0.0.1:9",
        token: "t",
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      },
    });
    expect(result.exitCode).toBe(2);
  });

  it("queues a generation and requires an id for status", async () => {
    const calls: string[] = [];
    const queued = await dispatchJsonCli({
      command: "generate",
      subcommand: "queue",
      flags: {
        json: JSON.stringify({ pillar: "image", jobType: "txt2img", parameters: { prompt: "a" } }),
      },
      client: {
        baseUrl: "http://127.0.0.1:11500",
        token: "t",
        fetchImpl: async (url, init) => {
          calls.push(`${init.method} ${url}`);
          return { status: 200, ok: true, json: async () => ({ id: "j1" }) };
        },
      },
    });
    expect(queued.ok).toBe(true);
    expect(calls[0]).toContain("/nexus/generate/queue");

    const missingId = await dispatchJsonCli({
      command: "generate",
      subcommand: "status",
      flags: {},
      client: {
        baseUrl: "http://127.0.0.1:9",
        token: "t",
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      },
    });
    expect(missingId.exitCode).toBe(2);

    const status = await dispatchJsonCli({
      command: "generate",
      subcommand: "status",
      flags: { id: "j1" },
      client: {
        baseUrl: "http://127.0.0.1:11500",
        token: "t",
        fetchImpl: async (url) => {
          calls.push(url);
          return { status: 200, ok: true, json: async () => ({ id: "j1", state: "queued" }) };
        },
      },
    });
    expect(status.ok).toBe(true);
    expect(calls[1]).toContain("/nexus/generate/status?id=j1");
  });

  it("maps sidecar HTTP 500 and unknown commands", async () => {
    const sidecar = await dispatchJsonCli({
      command: "session",
      subcommand: "list",
      flags: {},
      client: {
        baseUrl: "http://127.0.0.1:11500",
        token: "t",
        fetchImpl: async () => ({
          status: 500,
          ok: false,
          json: async () => {
            throw new Error("empty");
          },
        }),
      },
    });
    expect(sidecar.exitCode).toBe(1);
    expect((sidecar.body as { error: { code: string } }).error.code).toBe("sidecar");

    const usage = await dispatchJsonCli({
      command: "session",
      subcommand: "wipe",
      flags: {},
      client: {
        baseUrl: "http://127.0.0.1:9",
        token: "t",
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      },
    });
    expect(usage.exitCode).toBe(2);
    expect((usage.body as { error: { code: string } }).error.code).toBe("usage");
  });
});
