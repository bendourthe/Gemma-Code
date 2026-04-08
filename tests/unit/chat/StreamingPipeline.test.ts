import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OllamaClient, OllamaChatRequest } from "../../../src/ollama/types.js";
import { OllamaError } from "../../../src/ollama/types.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

// ConversationManager and StreamingPipeline both import vscode; the global
// mock in tests/setup.ts handles that.
const { ConversationManager } = await import("../../../src/chat/ConversationManager.js");
const { StreamingPipeline } = await import("../../../src/chat/StreamingPipeline.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an async generator that yields the given chunks. */
async function* makeStream(
  chunks: Array<{ content: string; done: boolean }>
): AsyncGenerator<{ message: { role: string; content: string }; done: boolean }> {
  for (const c of chunks) {
    yield { message: { role: "assistant", content: c.content }, done: c.done };
  }
}

function makeMockClient(
  streamImpl: OllamaClient["streamChat"] = () => makeStream([])
): OllamaClient {
  return {
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(streamImpl),
  };
}

// ---------------------------------------------------------------------------

describe("StreamingPipeline", () => {
  let manager: InstanceType<typeof ConversationManager>;
  let postMessage: ReturnType<typeof vi.fn<[ExtensionToWebviewMessage], void>>;

  beforeEach(() => {
    manager = new ConversationManager();
    postMessage = vi.fn();
  });

  // ---- successful stream ---------------------------------------------------

  it("posts thinking → streaming → tokens → messageComplete → idle on success", async () => {
    const client = makeMockClient(() =>
      makeStream([
        { content: "Hello", done: false },
        { content: " world", done: false },
        { content: "", done: true },
      ])
    );
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("hi", postMessage);

    const types = postMessage.mock.calls.map((c) => c[0]?.type);
    expect(types[0]).toBe("status"); // thinking
    expect(types[1]).toBe("status"); // streaming
    expect(types).toContain("token");
    expect(types).toContain("messageComplete");
    const lastStatus = [...postMessage.mock.calls]
      .reverse()
      .find((c) => c[0]?.type === "status");
    expect((lastStatus?.[0] as { state: string })?.state).toBe("idle");
  });

  it("adds the user message to the manager before streaming", async () => {
    const client = makeMockClient(() => makeStream([{ content: "ok", done: true }]));
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("user input", postMessage);

    const history = manager.getHistory();
    expect(history.some((m) => m.role === "user" && m.content === "user input")).toBe(true);
  });

  it("commits the assistant message to the manager on completion", async () => {
    const client = makeMockClient(() =>
      makeStream([
        { content: "part1", done: false },
        { content: "part2", done: true },
      ])
    );
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("question", postMessage);

    const history = manager.getHistory();
    const assistantMsg = history.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toBe("part1part2");
  });

  it("posts each token as a separate token message", async () => {
    const client = makeMockClient(() =>
      makeStream([
        { content: "A", done: false },
        { content: "B", done: false },
        { content: "C", done: true },
      ])
    );
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("x", postMessage);

    const tokens = postMessage.mock.calls
      .filter((c) => c[0]?.type === "token")
      .map((c) => (c[0] as { value: string }).value);
    expect(tokens).toEqual(["A", "B", "C"]);
  });

  // ---- error handling ------------------------------------------------------

  it("posts error with human-readable message on OllamaError 404", async () => {
    const client = makeMockClient(() => {
      throw new OllamaError("not found", 404);
    });
    const pipeline = new StreamingPipeline(client, manager, "my-model");

    await pipeline.send("q", postMessage);

    const errorCall = postMessage.mock.calls.find((c) => c[0]?.type === "error");
    expect(errorCall).toBeTruthy();
    const text = (errorCall?.[0] as { text: string })?.text ?? "";
    expect(text).toContain("my-model");
    expect(text.toLowerCase()).toContain("pull");
  });

  it("posts a generic error message for unknown errors", async () => {
    const client = makeMockClient(() => {
      throw new Error("something unexpected");
    });
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("q", postMessage);

    const errorCall = postMessage.mock.calls.find((c) => c[0]?.type === "error");
    expect(errorCall).toBeTruthy();
  });

  it("always posts status:idle in the finally block, even on error", async () => {
    const client = makeMockClient(() => {
      throw new OllamaError("boom", 500);
    });
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("q", postMessage);

    const lastStatus = [...postMessage.mock.calls]
      .reverse()
      .find((c) => c[0]?.type === "status");
    expect((lastStatus?.[0] as { state: string })?.state).toBe("idle");
  });

  // ---- cancel --------------------------------------------------------------

  it("cancel() posts 'Stream cancelled.' error and idle status", async () => {
    let resolveHold!: () => void;
    const holdPromise = new Promise<void>((r) => { resolveHold = r; });

    const client: OllamaClient = {
      checkHealth: vi.fn(),
      listModels: vi.fn(),
      streamChat: async function* (_req: OllamaChatRequest, signal?: AbortSignal) {
        // Block until aborted or released
        await new Promise<void>((res, rej) => {
          holdPromise.then(res);
          signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        });
      },
    };

    const pipeline = new StreamingPipeline(client, manager, "gemma4");
    const sendPromise = pipeline.send("q", postMessage);

    // Give the pipeline a tick to start streaming, then cancel
    await new Promise((r) => setTimeout(r, 0));
    pipeline.cancel();
    resolveHold();

    await sendPromise;

    const errorCall = postMessage.mock.calls.find((c) => c[0]?.type === "error");
    expect(errorCall).toBeTruthy();
    const errText = (errorCall?.[0] as { text: string })?.text ?? "";
    expect(errText.toLowerCase()).toContain("cancel");

    const lastStatus = [...postMessage.mock.calls]
      .reverse()
      .find((c) => c[0]?.type === "status");
    expect((lastStatus?.[0] as { state: string })?.state).toBe("idle");
  });

  // ---- retry logic ---------------------------------------------------------

  it("retries once when stream fails before 3 tokens, succeeds on second attempt", async () => {
    let attempt = 0;
    const client: OllamaClient = {
      checkHealth: vi.fn(),
      listModels: vi.fn(),
      streamChat: vi.fn(async function* () {
        attempt++;
        if (attempt === 1) {
          // Yield only 1 token then throw — triggers early failure retry
          yield { message: { role: "assistant", content: "x" }, done: false };
          throw new OllamaError("transient", 503);
        }
        yield { message: { role: "assistant", content: "success" }, done: true };
      }),
    };

    const pipeline = new StreamingPipeline(client, manager, "gemma4");
    await pipeline.send("q", postMessage);

    expect(attempt).toBe(2);

    const completeCall = postMessage.mock.calls.find((c) => c[0]?.type === "messageComplete");
    expect(completeCall).toBeTruthy();

    const errorCall = postMessage.mock.calls.find((c) => c[0]?.type === "error");
    expect(errorCall).toBeUndefined();
  });

  it("does not retry when stream fails after 3+ tokens", async () => {
    let attempt = 0;
    const client: OllamaClient = {
      checkHealth: vi.fn(),
      listModels: vi.fn(),
      streamChat: vi.fn(async function* () {
        attempt++;
        for (let i = 0; i < 5; i++) {
          yield { message: { role: "assistant", content: "t" }, done: false };
        }
        throw new OllamaError("late failure", 503);
      }),
    };

    const pipeline = new StreamingPipeline(client, manager, "gemma4");
    await pipeline.send("q", postMessage);

    expect(attempt).toBe(1);
    const errorCall = postMessage.mock.calls.find((c) => c[0]?.type === "error");
    expect(errorCall).toBeTruthy();
  });
});
