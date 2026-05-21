import { describe, it, expect } from "vitest";
import {
  ContradictionResolver,
  bm25Jaccard,
  buildAdjudicationPrompt,
  cosineSimilarity,
  createContradictionSweepTask,
  parseAdjudication,
  type OllamaChatLike,
  type ResolutionLogEntry,
  type SemanticRow,
  type SemanticTierProvider,
} from "../../../../core/memory/ContradictionResolver.js";
import type { Embedder } from "../../../../core/memory/LocalEmbedder.js";

/** Deterministic embedder used to pin similarity assertions. */
class StubEmbedder implements Embedder {
  readonly dim = 8;
  readonly backend = "hash-fallback" as const;
  private readonly _map: Map<string, Float32Array>;
  constructor(map: Map<string, Float32Array>) {
    this._map = map;
  }
  async embed(text: string): Promise<Float32Array> {
    const found = this._map.get(text);
    if (found) return found;
    // Default fallback: 1 at position 0 (orthogonal to every fixture).
    const vec = new Float32Array(this.dim);
    vec[0] = 1;
    return vec;
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

class StubOllama implements OllamaChatLike {
  readonly model: string;
  readonly replies: string[];
  readonly prompts: string[] = [];
  private _ix = 0;
  constructor(model: string, replies: string[]) {
    this.model = model;
    this.replies = replies;
  }
  async chat(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const reply = this.replies[this._ix] ?? this.replies[this.replies.length - 1] ?? "";
    this._ix += 1;
    return reply;
  }
  get invocationCount(): number {
    return this.prompts.length;
  }
}

class ArrayProvider implements SemanticTierProvider {
  rows: Array<SemanticRow & { resolutionLog?: ResolutionLogEntry[] }> = [];
  calls: Array<{ loserId: string; winnerId: string; log: ResolutionLogEntry }> = [];
  list(): Iterable<SemanticRow> {
    return this.rows.filter((r) => !r.supersededBy);
  }
  async markSuperseded(
    loserId: string,
    winnerId: string,
    log: ResolutionLogEntry,
  ): Promise<void> {
    this.calls.push({ loserId, winnerId, log });
    const target = this.rows.find((r) => r.id === loserId);
    if (target) {
      target.supersededBy = winnerId;
      target.resolutionLog = [...(target.resolutionLog ?? []), log];
    }
  }
}

const VEC_A = (() => {
  const v = new Float32Array(8);
  v[0] = 0.9;
  v[1] = 0.435889894354067;
  return v;
})();

const VEC_A_PRIME = (() => {
  const v = new Float32Array(8);
  v[0] = 0.91;
  v[1] = 0.4145177;
  return v;
})();

const VEC_B = (() => {
  const v = new Float32Array(8);
  v[2] = 1;
  return v;
})();

describe("bm25Jaccard", () => {
  it("returns 0 for empty inputs", () => {
    expect(bm25Jaccard("", "anything")).toBe(0);
    expect(bm25Jaccard("anything", "")).toBe(0);
  });

  it("returns 1 for identical token sets", () => {
    expect(bm25Jaccard("python uses tabs always", "python uses tabs always")).toBe(1);
  });

  it("returns a small value for disjoint token sets", () => {
    const overlap = bm25Jaccard(
      "python uses tabs",
      "javascript favours semicolons",
    );
    expect(overlap).toBeLessThan(0.2);
  });
});

describe("cosineSimilarity", () => {
  it("matches the dot product on normalized vectors", () => {
    expect(cosineSimilarity(VEC_A, VEC_A)).toBeCloseTo(1, 4);
  });
  it("matches the expected value for two near-aligned vectors", () => {
    expect(cosineSimilarity(VEC_A, VEC_A_PRIME)).toBeGreaterThan(0.85);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(VEC_A, VEC_B)).toBeCloseTo(0, 6);
  });
});

describe("parseAdjudication", () => {
  it("parses a bare single-line JSON reply", () => {
    expect(parseAdjudication('{"winner":"A","justification":"newer"}')).toEqual({
      winner: "A",
      justification: "newer",
    });
  });
  it("tolerates code-fenced replies", () => {
    expect(
      parseAdjudication('```json\n{"winner":"B","justification":"more specific"}\n```'),
    ).toEqual({ winner: "B", justification: "more specific" });
  });
  it("returns null on missing winner", () => {
    expect(parseAdjudication('{"justification":"no winner"}')).toBeNull();
  });
  it("returns null on un-parseable garbage", () => {
    expect(parseAdjudication("not json at all")).toBeNull();
  });
});

describe("buildAdjudicationPrompt", () => {
  it("includes both entry ids and texts", () => {
    const a: SemanticRow = { id: "a-1", text: "Python uses tabs" };
    const b: SemanticRow = { id: "b-1", text: "Python uses 4 spaces" };
    const prompt = buildAdjudicationPrompt(a, b);
    expect(prompt).toContain("a-1");
    expect(prompt).toContain("b-1");
    expect(prompt).toContain("Python uses tabs");
    expect(prompt).toContain("Python uses 4 spaces");
  });
});

describe("ContradictionResolver.detect", () => {
  it("returns an empty list when text length is below the threshold", async () => {
    const embedder = new StubEmbedder(new Map());
    const provider = new ArrayProvider();
    provider.rows.push({
      id: "a",
      text: "Python uses tabs always for indentation",
      embedding: VEC_A,
    });
    const resolver = new ContradictionResolver({
      embedder,
      provider,
      ollama: new StubOllama("gemma4:e4b", []),
      options: { enabled: true },
    });
    const groups = await resolver.detect({ id: "candidate", text: "short" });
    expect(groups).toEqual([]);
  });

  it("flags pairs that pass the dense-high / overlap-low predicate", async () => {
    const embedder = new StubEmbedder(
      new Map([
        ["Python uses tabs always for indentation", VEC_A],
        ["The Python convention prescribes four spaces of indent", VEC_A_PRIME],
      ]),
    );
    const provider = new ArrayProvider();
    provider.rows.push({
      id: "old",
      text: "Python uses tabs always for indentation",
      embedding: VEC_A,
    });
    const resolver = new ContradictionResolver({
      embedder,
      provider,
      ollama: new StubOllama("gemma4:e4b", []),
      options: { enabled: true },
    });
    const groups = await resolver.detect({
      id: "new",
      text: "The Python convention prescribes four spaces of indent",
      embedding: VEC_A_PRIME,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.denseSimilarity).toBeGreaterThan(0.85);
    expect(groups[0]!.bm25Overlap).toBeLessThan(0.4);
  });

  it("skips rows already marked as superseded", async () => {
    const embedder = new StubEmbedder(new Map());
    const provider = new ArrayProvider();
    provider.rows.push({
      id: "old",
      text: "Python uses tabs always for indentation",
      embedding: VEC_A,
      supersededBy: "newer",
    });
    const resolver = new ContradictionResolver({
      embedder,
      provider,
      ollama: new StubOllama("gemma4:e4b", []),
      options: { enabled: true },
    });
    const groups = await resolver.detect({
      id: "candidate",
      text: "The Python convention prescribes four spaces of indent",
      embedding: VEC_A_PRIME,
    });
    expect(groups).toEqual([]);
  });
});

describe("ContradictionResolver.resolve", () => {
  it("no-op when consolidation is disabled (no LLM call)", async () => {
    const ollama = new StubOllama("gemma4:e4b", [
      '{"winner":"A","justification":"unused"}',
    ]);
    const provider = new ArrayProvider();
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: false },
    });
    const ok = await resolver.resolve({
      a: { id: "a", text: "x" },
      b: { id: "b", text: "y" },
      denseSimilarity: 0.99,
      bm25Overlap: 0,
    });
    expect(ok).toBe(false);
    expect(ollama.invocationCount).toBe(0);
    expect(provider.calls).toEqual([]);
  });

  it("marks the loser superseded when the LLM picks A", async () => {
    const ollama = new StubOllama("gemma4:e4b", [
      '{"winner":"A","justification":"newer source"}',
    ]);
    const provider = new ArrayProvider();
    provider.rows.push(
      { id: "a", text: "Python uses 4 spaces for indentation" },
      { id: "b", text: "Python uses tabs for indentation" },
    );
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: true, now: () => 1234 },
    });
    const ok = await resolver.resolve({
      a: { id: "a", text: "Python uses 4 spaces for indentation" },
      b: { id: "b", text: "Python uses tabs for indentation" },
      denseSimilarity: 0.92,
      bm25Overlap: 0.2,
    });
    expect(ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.loserId).toBe("b");
    expect(provider.calls[0]!.winnerId).toBe("a");
    expect(provider.calls[0]!.log.justification).toBe("newer source");
    expect(provider.calls[0]!.log.at).toBe(1234);
  });

  it("returns false on un-parseable LLM reply", async () => {
    const ollama = new StubOllama("gemma4:e4b", ["this is not json"]);
    const provider = new ArrayProvider();
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: true },
    });
    const ok = await resolver.resolve({
      a: { id: "a", text: "x" },
      b: { id: "b", text: "y" },
      denseSimilarity: 0.99,
      bm25Overlap: 0,
    });
    expect(ok).toBe(false);
    expect(ollama.invocationCount).toBe(1);
    expect(provider.calls).toEqual([]);
  });
});

describe("ContradictionResolver.sweep", () => {
  it("short-circuits with zero LLM calls when disabled", async () => {
    const ollama = new StubOllama("gemma4:e4b", []);
    const provider = new ArrayProvider();
    provider.rows.push(
      {
        id: "a",
        text: "Python uses tabs always for indentation",
        embedding: VEC_A,
      },
      {
        id: "b",
        text: "Python convention prescribes four spaces of indent",
        embedding: VEC_A_PRIME,
      },
    );
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: false },
    });
    const result = await resolver.sweep();
    expect(result).toEqual({ scanned: 0, groups: 0, resolved: 0, llmCalls: 0 });
    expect(ollama.invocationCount).toBe(0);
  });

  it("adjudicates contradicting pairs when enabled", async () => {
    const ollama = new StubOllama("gemma4:e4b", [
      '{"winner":"B","justification":"more recent and specific"}',
    ]);
    const provider = new ArrayProvider();
    provider.rows.push(
      {
        id: "a",
        text: "Python uses tabs always for indentation",
        embedding: VEC_A,
      },
      {
        id: "b",
        text: "Python convention prescribes four spaces of indent",
        embedding: VEC_A_PRIME,
      },
    );
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: true },
    });
    const result = await resolver.sweep();
    expect(result.scanned).toBe(2);
    expect(result.groups).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.llmCalls).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.loserId).toBe("a");
    expect(provider.calls[0]!.winnerId).toBe("b");
  });

  it("ignores pairs whose Jaccard overlap is high (same fact, same words)", async () => {
    const ollama = new StubOllama("gemma4:e4b", []);
    const provider = new ArrayProvider();
    provider.rows.push(
      {
        id: "a",
        text: "Python uses tabs for indentation always",
        embedding: VEC_A,
      },
      {
        id: "b",
        text: "Python uses tabs for indentation always (truly)",
        embedding: VEC_A_PRIME,
      },
    );
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: true },
    });
    const result = await resolver.sweep();
    expect(result.groups).toBe(0);
    expect(ollama.invocationCount).toBe(0);
  });
});

describe("createContradictionSweepTask", () => {
  it("returns the expected IdleTimeScheduler shape", () => {
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider: new ArrayProvider(),
      ollama: new StubOllama("gemma4:e4b", []),
      options: { enabled: false },
    });
    const task = createContradictionSweepTask(resolver);
    expect(task.id).toBe("memory.contradiction-sweep");
    expect(task.cadenceMs).toBe(60 * 60 * 1000);
    expect(task.idleThresholdMs).toBe(5 * 60 * 1000);
    expect(typeof task.run).toBe("function");
  });

  it("task.run() is a no-op when consolidation is disabled", async () => {
    const ollama = new StubOllama("gemma4:e4b", []);
    const provider = new ArrayProvider();
    provider.rows.push({ id: "a", text: "Python uses tabs always for indentation", embedding: VEC_A });
    const resolver = new ContradictionResolver({
      embedder: new StubEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: false },
    });
    const task = createContradictionSweepTask(resolver);
    await task.run();
    expect(ollama.invocationCount).toBe(0);
  });
});
