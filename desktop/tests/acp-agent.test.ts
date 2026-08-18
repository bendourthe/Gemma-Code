/**
 * v1.18.0 Phase 5 (OI-A3) -- ACP JSON-RPC round-trip on the shared surface.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LLMChatRequest, LLMClient, LLMModel, LLMStreamChunk } from "../../modules/coding/llm/types";
import { AcpAgent } from "../sidecar/src/acp/AcpAgent";
import { ServingBindError } from "../sidecar/src/serving/guard";
import { ServingGateway } from "../sidecar/src/serving/gateway";
import type { ServingConfig } from "../sidecar/src/serving/config";

const TOKEN = "acp-test-token";

function fakeClient(script: (n: number) => readonly string[]): LLMClient {
  let n = 0;
  return {
    async checkHealth() {
      return true;
    },
    async listModels(): Promise<LLMModel[]> {
      return [{ name: "gemma4:e4b", modified_at: "", size: 0 }];
    },
    async *streamChat(_request: LLMChatRequest) {
      n += 1;
      const tokens = script(n);
      for (const t of tokens) {
        yield { message: { role: "assistant", content: t }, done: false } satisfies LLMStreamChunk;
      }
      yield { message: { role: "assistant", content: "" }, done: true } satisfies LLMStreamChunk;
    },
  };
}

function config(over: Partial<ServingConfig> = {}): ServingConfig {
  return { enabled: false, acpEnabled: true, host: "127.0.0.1", port: 0, token: TOKEN, ...over };
}

const started: ServingGateway[] = [];

async function startAcp(llm: LLMClient): Promise<{ gateway: ServingGateway; acp: AcpAgent; base: string }> {
  const gateway = new ServingGateway({ listInstalled: async () => [], log: () => {} });
  const acp = new AcpAgent({ llm });
  gateway.surface.mount(acp.asRoute());
  acp.setEnabled(true);
  started.push(gateway);
  await gateway.start(config());
  return { gateway, acp, base: `http://127.0.0.1:${gateway.boundPort}` };
}

async function rpc(
  base: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/acp`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return { status: 204, json: {} };
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()?.stop();
  }
});

describe("ACP transport", () => {
  it("rejects unauthenticated POST /acp before protocol handling", async () => {
    const { base } = await startAcp(fakeClient(() => ["hi"]));
    const res = await fetch(`${base}/acp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/API key/i);
  });

  it("rejects a bad bearer token", async () => {
    const { base } = await startAcp(fakeClient(() => ["hi"]));
    const res = await fetch(`${base}/acp`, {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } }),
    });
    expect(res.status).toBe(401);
  });

  it("does not serve ACP when the mount is disabled", async () => {
    const gateway = new ServingGateway({ listInstalled: async () => [], log: () => {} });
    const acp = new AcpAgent({ llm: fakeClient(() => ["hi"]) });
    gateway.surface.mount(acp.asRoute());
    started.push(gateway);
    await gateway.start(config({ enabled: true, acpEnabled: false }));
    acp.setEnabled(false);
    const { status } = await rpc(`http://127.0.0.1:${gateway.boundPort}`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1 },
    });
    expect(status).toBe(404);
  });
});

describe("ACP protocol", () => {
  it("initialize -> session/new -> session/prompt -> streamed updates", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-"));
    try {
      const { base } = await startAcp(fakeClient(() => ["Hello from ACP"]));
      const init = await rpc(base, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1 },
      });
      expect(init.status).toBe(200);
      const initResult = init.json.result as { protocolVersion: number; agentInfo: { name: string } };
      expect(initResult.protocolVersion).toBe(1);
      expect(initResult.agentInfo.name).toBe("nexus-coding");

      const created = await rpc(base, {
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd },
      });
      const sessionId = (created.json.result as { sessionId: string }).sessionId;
      expect(sessionId).toMatch(/[0-9a-f-]{36}/i);

      const prompted = await rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "Say hi" }] },
      });
      const result = prompted.json.result as {
        stopReason: string;
        updates: Array<{ update: { sessionUpdate: string } }>;
      };
      expect(result.stopReason).toBe("end_turn");
      expect(result.updates.some((u) => u.update.sessionUpdate === "agent_message_chunk")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("session/cancel aborts an in-flight prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-"));
    try {
      const llm: LLMClient = {
        async checkHealth() {
          return true;
        },
        async listModels() {
          return [];
        },
        async *streamChat(_req, signal) {
          yield { message: { role: "assistant", content: "partial" }, done: false };
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 5_000);
            signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          });
        },
      };
      const { base } = await startAcp(llm);
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.json.result as { sessionId: string }).sessionId;

      const promptPromise = rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "slow" }] },
      });
      await new Promise((r) => setTimeout(r, 50));
      await rpc(base, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
      const prompted = await promptPromise;
      const result = prompted.json.result as { stopReason: string };
      expect(result.stopReason).toBe("cancelled");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("unknown method returns JSON-RPC -32601", async () => {
    const { base } = await startAcp(fakeClient(() => ["x"]));
    await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
    const res = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/load", params: {} });
    expect((res.json.error as { code: number }).code).toBe(-32601);
  });

  it("rejects invalid JSON as a JSON-RPC parse error", async () => {
    const { base } = await startAcp(fakeClient(() => ["x"]));
    const res = await fetch(`${base}/acp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });

  it("rejects a request with no method", async () => {
    const { base } = await startAcp(fakeClient(() => ["x"]));
    const res = await rpc(base, { jsonrpc: "2.0", id: 1, params: {} });
    expect((res.json.error as { code: number }).code).toBe(-32600);
  });

  it("authenticate succeeds after initialize; session/new requires cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-"));
    try {
      const { base } = await startAcp(fakeClient(() => ["x"]));
      const before = await rpc(base, { jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd } });
      expect((before.json.error as { code: number }).code).toBe(-32600);

      const noVersion = await rpc(base, { jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
      expect((noVersion.json.error as { code: number }).code).toBe(-32602);

      await rpc(base, { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: 1 } });
      const auth = await rpc(base, { jsonrpc: "2.0", id: 3, method: "authenticate", params: {} });
      expect(auth.json.result).toEqual({});

      const missingCwd = await rpc(base, { jsonrpc: "2.0", id: 4, method: "session/new", params: {} });
      expect((missingCwd.json.error as { code: number }).code).toBe(-32602);

      const created = await rpc(base, {
        jsonrpc: "2.0",
        id: 5,
        method: "session/new",
        params: { cwd, model: "gemma4:e4b" },
      });
      expect((created.json.result as { sessionId: string }).sessionId).toMatch(/[0-9a-f-]{36}/i);

      const emptyPrompt = await rpc(base, {
        jsonrpc: "2.0",
        id: 6,
        method: "session/prompt",
        params: { sessionId: (created.json.result as { sessionId: string }).sessionId, prompt: [] },
      });
      expect((emptyPrompt.json.error as { code: number }).code).toBe(-32602);

      const missingSession = await rpc(base, {
        jsonrpc: "2.0",
        id: 7,
        method: "session/prompt",
        params: { sessionId: "no-such", prompt: [{ type: "text", text: "hi" }] },
      });
      expect((missingSession.json.error as { code: number }).code).toBe(-32001);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("accepts resource_link prompt blocks and streams SSE updates", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-"));
    try {
      const { base } = await startAcp(fakeClient(() => ["noted"]));
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.json.result as { sessionId: string }).sessionId;
      const res = await fetch(`${base}/acp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "session/prompt",
          params: {
            sessionId,
            prompt: [
              { type: "text", text: "look" },
              { type: "resource_link", uri: "file:///tmp/x.ts" },
            ],
          },
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      const body = await res.text();
      expect(body).toMatch(/agent_message_chunk|noted/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("maps an LLM failure to stopReason refusal", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-"));
    try {
      const llm: LLMClient = {
        async checkHealth() {
          return true;
        },
        async listModels() {
          return [];
        },
        async *streamChat() {
          throw new Error("ollama down");
        },
      };
      const { base } = await startAcp(llm);
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.json.result as { sessionId: string }).sessionId;
      const prompted = await rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "hi" }] },
      });
      expect((prompted.json.result as { stopReason: string }).stopReason).toBe("refusal");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("ACP serving-gateway bind sharing", () => {
  it("refuses a non-loopback ACP-enabled start", async () => {
    const gateway = new ServingGateway({ listInstalled: async () => [], log: () => {} });
    await expect(gateway.start(config({ host: "8.8.8.8" }))).rejects.toThrow(ServingBindError);
  });
});
