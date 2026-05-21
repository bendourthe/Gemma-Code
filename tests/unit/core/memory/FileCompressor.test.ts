import { describe, it, expect } from "vitest";
import {
  FileCompressor,
  buildCompressionPrompt,
  chunkText,
  compressionEntryId,
  parseShardExtraction,
  renderObservationContent,
  type SemanticWriter,
  type GraphLinker,
} from "../../../../core/memory/FileCompressor.js";
import type { OllamaChatLike } from "../../../../core/memory/ContradictionResolver.js";
import type { Embedder } from "../../../../core/memory/LocalEmbedder.js";

class FakeEmbedder implements Embedder {
  readonly dim = 8;
  readonly backend = "hash-fallback" as const;
  async embed(_text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dim);
    v[0] = 1;
    return v;
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(this.dim);
      v[0] = 1;
      return v;
    });
  }
}

class FakeOllama implements OllamaChatLike {
  readonly model = "gemma4:e4b";
  readonly prompts: string[] = [];
  private readonly _replies: string[];
  private _ix = 0;
  constructor(replies: string[]) {
    this._replies = replies;
  }
  async chat(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const reply = this._replies[this._ix] ?? this._replies[this._replies.length - 1] ?? "";
    this._ix += 1;
    return reply;
  }
  get invocationCount(): number {
    return this.prompts.length;
  }
}

class RecordingWriter implements SemanticWriter {
  rows: Array<Parameters<SemanticWriter["upsert"]>[0]> = [];
  async upsert(args: Parameters<SemanticWriter["upsert"]>[0]): Promise<void> {
    this.rows.push(args);
  }
}

class RecordingGraph implements GraphLinker {
  links: Array<Parameters<GraphLinker["link"]>[0]> = [];
  async link(args: Parameters<GraphLinker["link"]>[0]): Promise<void> {
    this.links.push(args);
  }
}

describe("chunkText", () => {
  it("returns the original text when it fits in a single chunk", () => {
    expect(chunkText("hello world", 2_000)).toEqual(["hello world"]);
  });

  it("returns an empty list for empty input", () => {
    expect(chunkText("", 2_000)).toEqual([]);
  });

  it("splits long text into approximately equal-sized chunks", () => {
    // ~40 KiB of repeated paragraphs; 2000 tokens -> ~8000 char chunks.
    const body = ("paragraph X.\n\n".repeat(200) + "end.\n\n").repeat(12);
    const chunks = chunkText(body, 2_000);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk should exceed roughly the target window.
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(9_000);
    // Concatenation round-trips losslessly.
    expect(chunks.join("")).toBe(body);
  });
});

describe("parseShardExtraction", () => {
  it("parses well-formed JSON", () => {
    const r = parseShardExtraction(
      '{"summary":"a","key_facts":["k1","k2"],"code_patterns":["p1"]}',
    );
    expect(r.summary).toBe("a");
    expect(r.keyFacts).toEqual(["k1", "k2"]);
    expect(r.codePatterns).toEqual(["p1"]);
  });
  it("tolerates code fences", () => {
    const r = parseShardExtraction(
      '```json\n{"summary":"x","key_facts":[],"code_patterns":[]}\n```',
    );
    expect(r.summary).toBe("x");
  });
  it("falls back to a truncated raw summary on un-parseable output", () => {
    const r = parseShardExtraction("no JSON here, just prose.");
    expect(r.summary).toBe("no JSON here, just prose.");
    expect(r.keyFacts).toEqual([]);
    expect(r.codePatterns).toEqual([]);
  });
});

describe("renderObservationContent", () => {
  it("renders an empty observation gracefully", () => {
    const out = renderObservationContent({
      summary: "",
      keyFacts: [],
      codePatterns: [],
      shards: [],
      sourcePath: "/x.txt",
      chunkCount: 0,
      model: "gemma4:e4b",
    });
    expect(out).toContain("# Compressed observation: /x.txt");
    expect(out).toContain("(no summary)");
  });
  it("renders key facts and code patterns as bullet lists", () => {
    const out = renderObservationContent({
      summary: "A summary",
      keyFacts: ["fact 1", "fact 2"],
      codePatterns: ["pattern X"],
      shards: [],
      sourcePath: "/x.txt",
      chunkCount: 3,
      model: "gemma4:e4b",
    });
    expect(out).toContain("- fact 1");
    expect(out).toContain("- fact 2");
    expect(out).toContain("- pattern X");
    expect(out).toContain("Chunks: 3");
  });
});

describe("compressionEntryId", () => {
  it("produces a stable identifier per path", () => {
    expect(compressionEntryId("/a/b.txt")).toBe("memory.compress::/a/b.txt");
    expect(compressionEntryId("/a/b.txt")).toBe(compressionEntryId("/a/b.txt"));
  });
});

describe("buildCompressionPrompt", () => {
  it("includes shard ordinal numbering", () => {
    const prompt = buildCompressionPrompt("hello", 1, 4);
    expect(prompt).toContain("shard 2 of 4");
    expect(prompt).toContain("hello");
  });
});

describe("FileCompressor.compressFile", () => {
  it("returns kind=disabled when compression is off (no LLM call)", async () => {
    const ollama = new FakeOllama([]);
    const writer = new RecordingWriter();
    const compressor = new FileCompressor({
      embedder: new FakeEmbedder(),
      writer,
      ollama,
      options: {
        enabled: false,
        readFile: async () => "anything",
      },
    });
    const result = await compressor.compressFile("/x.txt", {
      sessionId: "s",
      hookKind: "test",
    });
    expect(result.kind).toBe("disabled");
    expect(ollama.invocationCount).toBe(0);
    expect(writer.rows).toEqual([]);
  });

  it("writes a single semantic-tier row with provenance.toolName = memory.compress", async () => {
    const ollama = new FakeOllama([
      '{"summary":"hello world","key_facts":["uses tabs"],"code_patterns":["python"]}',
    ]);
    const writer = new RecordingWriter();
    const graph = new RecordingGraph();
    const compressor = new FileCompressor({
      embedder: new FakeEmbedder(),
      writer,
      graph,
      ollama,
      options: {
        enabled: true,
        readFile: async () => "tiny file content",
      },
    });
    const result = await compressor.compressFile("/foo/bar.txt", {
      sessionId: "session-1",
      hookKind: "slash.memory.compress",
    });
    expect(result.kind).toBe("compressed");
    expect(writer.rows).toHaveLength(1);
    const row = writer.rows[0]!;
    expect(row.id).toBe("memory.compress::/foo/bar.txt");
    expect(row.provenance.toolName).toBe("memory.compress");
    expect(row.provenance.sessionId).toBe("session-1");
    expect(row.metadata.sourcePath).toBe("/foo/bar.txt");
    expect(row.metadata.model).toBe("gemma4:e4b");
    expect(row.content).toContain("uses tabs");
    expect(row.content).toContain("python");
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0]!.from).toBe("memory.compress::/foo/bar.txt");
    expect(graph.links[0]!.to).toBe("file:///foo/bar.txt");
  });

  it("aggregates many shards into a single observation (~1,000 lines)", async () => {
    const replies = Array.from(
      { length: 64 },
      (_unused, i) =>
        `{"summary":"shard-${i}","key_facts":["k${i}"],"code_patterns":["p${i}"]}`,
    );
    const ollama = new FakeOllama(replies);
    const writer = new RecordingWriter();
    const longText = Array.from({ length: 1_000 }, (_unused, i) => `line ${i}`).join("\n");
    const compressor = new FileCompressor({
      embedder: new FakeEmbedder(),
      writer,
      ollama,
      options: {
        enabled: true,
        readFile: async () => longText,
        chunkTokens: 200,
      },
    });
    const result = await compressor.compressFile("/long.txt", {
      sessionId: "session-1",
      hookKind: "slash.memory.compress",
    });
    expect(result.kind).toBe("compressed");
    expect(writer.rows).toHaveLength(1);
    expect(result.observation!.chunkCount).toBeGreaterThan(1);
    expect(result.observation!.keyFacts.length).toBeGreaterThanOrEqual(1);
    expect(ollama.invocationCount).toBe(result.observation!.chunkCount);
  });

  it("returns kind=empty when the file is empty", async () => {
    const compressor = new FileCompressor({
      embedder: new FakeEmbedder(),
      writer: new RecordingWriter(),
      ollama: new FakeOllama([]),
      options: { enabled: true, readFile: async () => "" },
    });
    const result = await compressor.compressFile("/empty.txt", {
      sessionId: "s",
      hookKind: "t",
    });
    expect(result.kind).toBe("empty");
  });

  it("returns kind=too-large when the file exceeds the ceiling", async () => {
    const compressor = new FileCompressor({
      embedder: new FakeEmbedder(),
      writer: new RecordingWriter(),
      ollama: new FakeOllama([]),
      options: {
        enabled: true,
        readFile: async () => "x".repeat(101),
        maxFileBytes: 100,
      },
    });
    const result = await compressor.compressFile("/big.txt", {
      sessionId: "s",
      hookKind: "t",
    });
    expect(result.kind).toBe("too-large");
  });

  it("returns kind=llm-failed when the chat call throws", async () => {
    const failing: OllamaChatLike = {
      model: "gemma4:e4b",
      async chat() {
        throw new Error("ollama not reachable");
      },
    };
    const compressor = new FileCompressor({
      embedder: new FakeEmbedder(),
      writer: new RecordingWriter(),
      ollama: failing,
      options: { enabled: true, readFile: async () => "some content" },
    });
    const result = await compressor.compressFile("/x.txt", {
      sessionId: "s",
      hookKind: "t",
    });
    expect(result.kind).toBe("llm-failed");
    expect(result.message).toContain("ollama not reachable");
  });
});
