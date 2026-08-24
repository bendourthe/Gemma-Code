/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- serving-gateway integration tests.
 *
 * These start a REAL `node:http` listener on an ephemeral loopback port and
 * drive it with `fetch`, against a fake `LLMClient`. That is deliberate: the
 * things most likely to break (SSE framing, header ordering, the auth path, the
 * "no port bound when disabled" guarantee) only exist at the socket boundary.
 */

import { afterEach, describe, expect, it } from "vitest";
import { connect } from "node:net";

import type {
  LLMChatRequest,
  LLMClient,
  LLMModel,
  LLMStreamChunk,
} from "../../modules/coding/llm/types";
import type { ListedModelDto } from "../sidecar/src/models/modelsService";
import type { ServingAdapter } from "../sidecar/src/serving/adapters";
import type { ServingConfig } from "../sidecar/src/serving/config";
import { ServingBindError } from "../sidecar/src/serving/guard";
import { ServingGateway } from "../sidecar/src/serving/gateway";

const TOKEN = "test-local-token";

const INSTALLED: readonly ListedModelDto[] = [
  {
    id: "gemma-4-12b",
    displayName: "Gemma 4 12B",
    tag: "gemma4:12b",
    type: "llm",
    installed: true,
    source: "registry",
  },
];

/**
 * Records the request it was given and streams a fixed token sequence.
 *
 * `counters` (v1.16.0 Phase 2.1) are attached to the terminal chunk, mimicking
 * how Ollama and OpenAI-compatible runtimes report usage, so the gateway's usage
 * envelopes can be asserted against real numbers.
 */
function fakeClient(
  tokens: readonly string[] = ["Hello", ", ", "world"],
  counters: Partial<LLMStreamChunk> = {},
): LLMClient & { lastRequest: LLMChatRequest | null } {
  const state = { lastRequest: null as LLMChatRequest | null };
  return {
    get lastRequest() {
      return state.lastRequest;
    },
    async checkHealth() {
      return true;
    },
    async listModels(): Promise<LLMModel[]> {
      return [{ name: "gemma4:12b", modified_at: "", size: 0 }];
    },
    async *streamChat(request: LLMChatRequest) {
      state.lastRequest = request;
      for (const t of tokens) {
        yield { message: { role: "assistant", content: t }, done: false };
      }
      yield { message: { role: "assistant", content: "" }, done: true, ...counters };
    },
  };
}

/** Ollama-shaped counters on the final chunk. */
const OLLAMA_COUNTERS: Partial<LLMStreamChunk> = {
  prompt_eval_count: 17,
  eval_count: 42,
  eval_duration: 2_100_000_000,
};

function adaptersFor(client: LLMClient): () => readonly ServingAdapter[] {
  const adapters: ServingAdapter[] = [{ name: "fake", chat: true, createClient: () => client }];
  return () => adapters;
}

function config(over: Partial<ServingConfig> = {}): ServingConfig {
  // Port 0 -> the OS picks a free ephemeral port, so tests never collide.
  return { enabled: true, host: "127.0.0.1", port: 0, token: TOKEN, ...over };
}

const started: ServingGateway[] = [];

async function startGateway(
  opts: { client?: LLMClient; installed?: readonly ListedModelDto[]; config?: Partial<ServingConfig> } = {},
): Promise<{ gateway: ServingGateway; base: string; client: LLMClient }> {
  const client = opts.client ?? fakeClient();
  const gateway = new ServingGateway({
    listInstalled: async () => opts.installed ?? INSTALLED,
    adapters: adaptersFor(client),
    log: () => {},
  });
  started.push(gateway);
  await gateway.start(config(opts.config));
  return { gateway, base: `http://127.0.0.1:${gateway.boundPort}`, client };
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()?.stop();
  }
});

describe("ServingGateway lifecycle", () => {
  it("binds for JSON CLI when serving and ACP are off", async () => {
    const gateway = new ServingGateway({ listInstalled: async () => INSTALLED, log: () => {} });
    started.push(gateway);
    await gateway.start(config({ enabled: false, jsonCliEnabled: true }));
    expect(gateway.running).toBe(true);
    expect(gateway.boundPort).toBeGreaterThan(0);
  });

  it("binds no port when the opt-in is disabled", async () => {
    const gateway = new ServingGateway({ listInstalled: async () => INSTALLED, log: () => {} });
    started.push(gateway);
    await gateway.start(config({ enabled: false }));
    expect(gateway.running).toBe(false);
    expect(gateway.boundPort).toBeNull();
  });

  it("refuses to start on a non-loopback host, before binding", async () => {
    const gateway = new ServingGateway({ listInstalled: async () => INSTALLED, log: () => {} });
    await expect(gateway.start(config({ host: "0.0.0.0" }))).rejects.toThrow(ServingBindError);
    expect(gateway.running).toBe(false);
  });

  it("stops listening on toggle-off, refusing further connections", async () => {
    const { gateway, base } = await startGateway();
    const port = gateway.boundPort!;
    expect(gateway.running).toBe(true);
    expect((await fetch(`${base}/health`)).status).toBe(200);

    await gateway.applyConfig(config({ enabled: false }));
    expect(gateway.running).toBe(false);
    await expect(canConnect(port)).resolves.toBe(false);
  });

  it("stop() is idempotent on a never-started gateway", async () => {
    const gateway = new ServingGateway({ listInstalled: async () => INSTALLED, log: () => {} });
    await expect(gateway.stop()).resolves.toBeUndefined();
    await expect(gateway.stop()).resolves.toBeUndefined();
  });

  it("reports status with the bound port and base URL", async () => {
    const { gateway } = await startGateway();
    const status = gateway.status(config());
    expect(status.running).toBe(true);
    expect(status.port).toBe(gateway.boundPort);
    expect(status.baseUrl).toBe(`http://127.0.0.1:${gateway.boundPort}/v1`);
  });
});

describe("ServingGateway auth", () => {
  it("rejects a request with no token", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/models`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe("authentication_error");
  });

  it("rejects a request with the wrong token", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/models`, {
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the x-api-key header form", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/models`, { headers: { "x-api-key": TOKEN } });
    expect(res.status).toBe(200);
  });

  it("serves /health without a token", async () => {
    const { base } = await startGateway();
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("returns 404 for an unknown route", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/embeddings`, { method: "POST", headers: auth, body: "{}" });
    expect(res.status).toBe(404);
  });

  it("exposes no filesystem or tool route", async () => {
    const { base } = await startGateway();
    for (const path of ["/v1/files", "/etc/passwd", "/v1/tools", "/../../package.json"]) {
      const res = await fetch(`${base}${path}`, { headers: auth });
      expect(res.status).toBe(404);
    }
  });
});

describe("GET /v1/models", () => {
  it("returns the installed models in the OpenAI list shape", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/models`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      data: Array<{ id: string; object: string; owned_by: string }>;
    };
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: "gemma-4-12b", object: "model", owned_by: "nexus" });
  });

  it("returns an empty list when nothing is installed", async () => {
    const { base } = await startGateway({ installed: [] });
    const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as {
      data: unknown[];
    };
    expect(body.data).toEqual([]);
  });
});

describe("POST /v1/chat/completions", () => {
  it("returns a buffered OpenAI completion", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gemma-4-12b", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      model: string;
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
    };
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("gemma-4-12b");
    expect(body.choices[0]?.message).toEqual({ role: "assistant", content: "Hello, world" });
    expect(body.choices[0]?.finish_reason).toBe("stop");
  });

  it("streams OpenAI chat.completion.chunk frames terminated by [DONE]", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSse(await res.text());
    expect(frames.at(-1)?.data).toBe("[DONE]");

    const parsed = frames
      .filter((f) => f.data !== "[DONE]")
      .map((f) => JSON.parse(f.data) as { object: string; choices: Array<Record<string, unknown>> });
    expect(parsed.every((p) => p.object === "chat.completion.chunk")).toBe(true);
    const text = parsed
      .map((p) => (p.choices[0]?.delta as { content?: string } | undefined)?.content ?? "")
      .join("");
    expect(text).toBe("Hello, world");
    expect(parsed.at(-1)?.choices[0]?.finish_reason).toBe("stop");
  });

  it("passes sampling options through to the model client", async () => {
    const client = fakeClient();
    const { base } = await startGateway({ client });
    await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.25,
        top_p: 0.9,
      }),
    });
    expect(client.lastRequest?.options).toEqual({ temperature: 0.25, top_p: 0.9 });
  });

  it("flattens structured content parts into text", async () => {
    const client = fakeClient();
    const { base } = await startGateway({ client });
    await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            ],
          },
        ],
      }),
    });
    expect(client.lastRequest?.messages[0]).toEqual({
      role: "user",
      content: "describe",
      images: ["AAAA"],
    });
  });

  it("maps a missing model field to a 400", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("maps an unknown model to a 404", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "ghost", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(404);
  });

  it("maps malformed JSON to a 400", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized body with 413", async () => {
    const client = fakeClient();
    const gateway = new ServingGateway({
      listInstalled: async () => INSTALLED,
      adapters: adaptersFor(client),
      maxBodyBytes: 256,
      log: () => {},
    });
    started.push(gateway);
    await gateway.start(config());
    const res = await fetch(`http://127.0.0.1:${gateway.boundPort}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [{ role: "user", content: "x".repeat(2000) }],
      }),
    });
    expect(res.status).toBe(413);
  });

  it("does not leak a host path when the upstream client fails", async () => {
    const exploding: LLMClient = {
      async checkHealth() {
        return true;
      },
      async listModels() {
        return [{ name: "gemma4:12b", modified_at: "", size: 0 }];
      },
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error("ENOENT: open 'C:\\Users\\bob\\.nexus\\models\\a.gguf'");
      },
    };
    const { base } = await startGateway({ client: exploding });
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gemma-4-12b", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("Users");
    expect(text).toContain("[redacted]");
  });
});

describe("POST /v1/messages", () => {
  it("returns a buffered Anthropic message", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      role: string;
      model: string;
      content: Array<{ type: string; text: string }>;
      stop_reason: string;
      usage: Record<string, number>;
    };
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.model).toBe("gemma-4-12b");
    expect(body.content).toEqual([{ type: "text", text: "Hello, world" }]);
    expect(body.stop_reason).toBe("end_turn");
    expect(body.usage).toHaveProperty("input_tokens");
  });

  it("folds the out-of-band system prompt into a leading system turn", async () => {
    const client = fakeClient();
    const { base } = await startGateway({ client });
    await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        system: "You are terse.",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(client.lastRequest?.messages).toEqual([
      { role: "system", content: "You are terse." },
      { role: "user", content: "hi" },
    ]);
  });

  it("streams the Anthropic event sequence in order", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSse(await res.text());
    expect(frames.map((f) => f.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const text = frames
      .filter((f) => f.event === "content_block_delta")
      .map((f) => (JSON.parse(f.data) as { delta: { text: string } }).delta.text)
      .join("");
    expect(text).toBe("Hello, world");
  });

  it("renders errors in the Anthropic envelope, not the OpenAI one", async () => {
    const { base } = await startGateway();
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "ghost", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("not_found_error");
  });
});

// v1.16.0 Phase 2.1 (closes gap LSO.P1.A): before this phase both dialects
// reported usage as unconditional zeros because the port carried no counters.
describe("token usage reporting", () => {
  it("reports real OpenAI usage from the backend's counters", async () => {
    const { base } = await startGateway({ client: fakeClient(["hi"], OLLAMA_COUNTERS) });
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gemma-4-12b", messages: [{ role: "user", content: "hi" }] }),
    });
    const body = (await res.json()) as { usage: Record<string, number> };
    expect(body.usage).toEqual({ prompt_tokens: 17, completion_tokens: 42, total_tokens: 59 });
  });

  it("reports real Anthropic usage from the backend's counters", async () => {
    const { base } = await startGateway({ client: fakeClient(["hi"], OLLAMA_COUNTERS) });
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gemma-4-12b", messages: [{ role: "user", content: "hi" }] }),
    });
    const body = (await res.json()) as { usage: Record<string, number> };
    expect(body.usage).toEqual({ input_tokens: 17, output_tokens: 42 });
  });

  it("accepts an OpenAI-shaped usage block from the runtime", async () => {
    const { base } = await startGateway({
      client: fakeClient(["hi"], { usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    });
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gemma-4-12b", messages: [{ role: "user", content: "hi" }] }),
    });
    const body = (await res.json()) as { usage: Record<string, number> };
    expect(body.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  });

  it("reports usage on the streamed OpenAI finish chunk", async () => {
    const { base } = await startGateway({ client: fakeClient(["hi"], OLLAMA_COUNTERS) });
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    const frames = parseSse(await res.text()).filter((f) => f.data !== "[DONE]");
    const final = JSON.parse(String(frames.at(-1)?.data)) as {
      usage?: Record<string, number>;
      choices: Array<{ finish_reason: string | null }>;
    };
    expect(final.choices[0]?.finish_reason).toBe("stop");
    expect(final.usage).toEqual({ prompt_tokens: 17, completion_tokens: 42, total_tokens: 59 });
  });

  it("reports output_tokens on the streamed Anthropic message_delta", async () => {
    const { base } = await startGateway({ client: fakeClient(["hi"], OLLAMA_COUNTERS) });
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gemma-4-12b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    const frames = parseSse(await res.text());
    const delta = frames.find((f) => f.event === "message_delta");
    expect((JSON.parse(String(delta?.data)) as { usage: { output_tokens: number } }).usage).toEqual({
      output_tokens: 42,
    });

    // message_start precedes any generation, so its usage is legitimately zero.
    const start = frames.find((f) => f.event === "message_start");
    const startUsage = (
      JSON.parse(String(start?.data)) as { message: { usage: Record<string, number> } }
    ).message.usage;
    expect(startUsage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it("still emits a well-formed zeroed usage block when the runtime reports nothing", async () => {
    const { base } = await startGateway({ client: fakeClient(["hi"]) });
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gemma-4-12b", messages: [{ role: "user", content: "hi" }] }),
    });
    const body = (await res.json()) as { usage: Record<string, number> };
    expect(body.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });
});

/** Parse an SSE payload into `{ event, data }` frames. */
function parseSse(raw: string): Array<{ event: string | null; data: string }> {
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event: string | null = null;
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      return { event, data: data.join("\n") };
    });
}

/** True when a TCP connection to the loopback port succeeds. */
function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
