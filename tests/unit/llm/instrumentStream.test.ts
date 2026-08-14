// v1.16.0 Phase 2.3 (adoption item A2) -- stream instrumentation.
//
// Two properties matter most and are asserted first: the wrapper is TRANSPARENT
// (same chunks, same errors) and it still records on an abnormal end, because a
// cancelled or failed stream is exactly when a reader wants the partial timing.

import { describe, expect, it } from "vitest";

import { InferenceMetricsRegistry } from "../../../core/observability/InferenceMetrics.js";
import { instrumentStream } from "../../../modules/coding/llm/instrumentStream.js";
import type { LLMStreamChunk } from "../../../modules/coding/llm/types.js";

function chunk(content: string, done = false, extra: Partial<LLMStreamChunk> = {}): LLMStreamChunk {
  return { message: { role: "assistant", content }, done, ...extra };
}

async function* gen(chunks: readonly LLMStreamChunk[]): AsyncGenerator<LLMStreamChunk> {
  for (const c of chunks) yield c;
}

/** A clock that advances a fixed step per read, so timings are deterministic. */
function steppedClock(stepMs: number): () => number {
  let t = 0;
  return () => {
    const current = t;
    t += stepMs;
    return current;
  };
}

async function drain(g: AsyncGenerator<LLMStreamChunk>): Promise<LLMStreamChunk[]> {
  const out: LLMStreamChunk[] = [];
  for await (const c of g) out.push(c);
  return out;
}

describe("instrumentStream transparency", () => {
  it("yields exactly the chunks it receives, in order", async () => {
    const input = [chunk("a"), chunk("b"), chunk("", true)];
    const out = await drain(
      instrumentStream(gen(input), { model: "m", registry: new InferenceMetricsRegistry() }),
    );
    expect(out).toEqual(input);
  });

  it("re-throws the inner generator's error unchanged", async () => {
    async function* boom(): AsyncGenerator<LLMStreamChunk> {
      yield chunk("partial");
      throw new Error("upstream exploded");
    }
    const registry = new InferenceMetricsRegistry();
    await expect(
      drain(instrumentStream(boom(), { model: "m", registry })),
    ).rejects.toThrow("upstream exploded");
    // Still recorded the partial request.
    expect(registry.size).toBe(1);
  });

  it("records when the consumer abandons the stream early", async () => {
    const registry = new InferenceMetricsRegistry();
    const g = instrumentStream(gen([chunk("a"), chunk("b"), chunk("", true)]), {
      model: "m",
      registry,
    });
    await g.next();
    await g.return(undefined);
    expect(registry.size).toBe(1);
  });
});

describe("instrumentStream timing", () => {
  it("measures TTFT to the first NON-EMPTY content chunk", async () => {
    const registry = new InferenceMetricsRegistry();
    // Clock reads: start=0, then 10 per call. The role-only opening delta must
    // not count as the first token.
    await drain(
      instrumentStream(gen([chunk(""), chunk("hello"), chunk("", true)]), {
        model: "m",
        registry,
        now: steppedClock(10),
      }),
    );
    const record = registry.recent()[0];
    // Reads: 0 (start), 10 (ttft at the "hello" chunk), 20 (total).
    expect(record?.ttftMs).toBe(10);
    expect(record?.totalMs).toBe(20);
  });

  it("reports a null TTFT when no content ever arrived", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("", true)]), {
        model: "m",
        registry,
        now: steppedClock(5),
      }),
    );
    expect(registry.recent()[0]?.ttftMs).toBeNull();
  });

  it("stamps the completion wall-clock time", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("x", true)]), {
        model: "m",
        registry,
        wallClock: () => 1_700_000_000_000,
      }),
    );
    expect(registry.recent()[0]?.at).toBe(1_700_000_000_000);
  });
});

describe("instrumentStream token counting", () => {
  it("reads Ollama counters from the final chunk", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(
        gen([
          chunk("hi"),
          chunk("", true, {
            prompt_eval_count: 11,
            eval_count: 22,
            eval_duration: 1_100_000_000,
          }),
        ]),
        { model: "m", registry },
      ),
    );
    const record = registry.recent()[0];
    expect(record?.promptTokens).toBe(11);
    expect(record?.completionTokens).toBe(22);
    expect(record?.tokenSource).toBe("reported");
    // 22 tokens / 1.1s = 20/s
    expect(record?.tokensPerSec).toBe(20);
  });

  it("reads an OpenAI-shaped usage block", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(
        gen([chunk("hi"), chunk("", true, { usage: { prompt_tokens: 7, completion_tokens: 9 } })]),
        { model: "m", registry },
      ),
    );
    const record = registry.recent()[0];
    expect(record?.promptTokens).toBe(7);
    expect(record?.completionTokens).toBe(9);
    expect(record?.tokenSource).toBe("reported");
  });

  it("estimates completion tokens when the backend reports none", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("hello world"), chunk("", true)]), { model: "m", registry }),
    );
    const record = registry.recent()[0];
    expect(record?.tokenSource).toBe("estimated");
    expect(record?.completionTokens).toBeGreaterThan(0);
    // No prompt count is knowable from the stream alone.
    expect(record?.promptTokens).toBeNull();
  });

  it("reports unavailable rather than estimating when estimation is off", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("hello"), chunk("", true)]), {
        model: "m",
        registry,
        estimateWhenMissing: false,
      }),
    );
    const record = registry.recent()[0];
    expect(record?.tokenSource).toBe("unavailable");
    expect(record?.completionTokens).toBeNull();
    expect(record?.tokensPerSec).toBeNull();
  });

  it("reports unavailable for an empty response with nothing to estimate from", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(instrumentStream(gen([chunk("", true)]), { model: "m", registry }));
    expect(registry.recent()[0]?.tokenSource).toBe("unavailable");
  });
});

describe("instrumentStream metadata", () => {
  it("records the model and adapter it was told", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("x", true)]), {
        model: "gemma4:12b",
        adapter: "ollama",
        registry,
      }),
    );
    const record = registry.recent()[0];
    expect(record?.model).toBe("gemma4:12b");
    expect(record?.adapter).toBe("ollama");
  });

  it("records a null adapter when none is given", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(instrumentStream(gen([chunk("x", true)]), { model: "m", registry }));
    expect(registry.recent()[0]?.adapter).toBeNull();
  });

  it("reads the memory probe", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("x", true)]), {
        model: "m",
        registry,
        memoryProbe: () => 4096,
      }),
    );
    expect(registry.recent()[0]?.memoryBytes).toBe(4096);
  });

  it("tolerates a throwing memory probe", async () => {
    const registry = new InferenceMetricsRegistry();
    await drain(
      instrumentStream(gen([chunk("x", true)]), {
        model: "m",
        registry,
        memoryProbe: () => {
          throw new Error("ollama gone");
        },
      }),
    );
    expect(registry.recent()[0]?.memoryBytes).toBeNull();
  });
});
