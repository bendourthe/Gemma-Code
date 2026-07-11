import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ContradictionResolver,
  type OllamaChatLike,
  type ResolutionLogEntry,
  type SemanticRow,
  type SemanticTierProvider,
} from "../../core/memory/ContradictionResolver.js";
import {
  FileCompressor,
  compressionEntryId,
  type GraphLinker,
  type SemanticWriter,
} from "../../core/memory/FileCompressor.js";
import type { Embedder } from "../../core/memory/LocalEmbedder.js";

/**
 * v1.1.0 Phase 9 -- opt-in memory consolidation integration tests.
 *
 * Verifies the stability gate from `docs/v1/v1.1/plans/phase-09-memory-consolidation-optin.md`:
 *
 *   * With `nexus.memory.consolidation.enabled = true`, writing two contradicting
 *     semantic-tier rows ("Python uses tabs", "Python uses 4 spaces") and running
 *     the sweep marks one row as `superseded_by` the other with a `resolution_log`
 *     entry attached.
 *   * With the consolidation gate at its default (`false`), no Ollama call is ever
 *     issued -- the resolver short-circuits before invoking the LLM.
 *   * `compressFile` on a 1,000-line fixture produces exactly one semantic-tier row
 *     with `provenance.toolName = "memory.compress"` and the file path embedded
 *     under `metadata.sourcePath`. With the compression gate off, no LLM call is
 *     issued and no row is written.
 */

class RecordingOllama implements OllamaChatLike {
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

class FixtureProvider implements SemanticTierProvider {
  rows: Array<
    SemanticRow & { resolutionLog?: ResolutionLogEntry[] }
  > = [];

  list(): Iterable<SemanticRow> {
    return this.rows;
  }
  async markSuperseded(
    loserId: string,
    winnerId: string,
    log: ResolutionLogEntry,
  ): Promise<void> {
    const target = this.rows.find((r) => r.id === loserId);
    if (target) {
      target.supersededBy = winnerId;
      target.resolutionLog = [...(target.resolutionLog ?? []), log];
    }
  }
}

class FixtureEmbedder implements Embedder {
  readonly dim = 8;
  readonly backend = "hash-fallback" as const;
  private readonly _map: Map<string, Float32Array>;
  constructor(map: Map<string, Float32Array>) {
    this._map = map;
  }
  async embed(text: string): Promise<Float32Array> {
    const exact = this._map.get(text);
    if (exact) return exact;
    // Default to zero vector so unrelated rows can never accidentally
    // satisfy the dense-similarity threshold.
    return new Float32Array(this.dim);
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

class FixtureWriter implements SemanticWriter {
  rows: Array<Parameters<SemanticWriter["upsert"]>[0]> = [];
  async upsert(args: Parameters<SemanticWriter["upsert"]>[0]): Promise<void> {
    this.rows.push(args);
  }
}

class FixtureGraph implements GraphLinker {
  links: Array<Parameters<GraphLinker["link"]>[0]> = [];
  async link(args: Parameters<GraphLinker["link"]>[0]): Promise<void> {
    this.links.push(args);
  }
}

function buildVec(coord1: number, coord2: number, dim = 8): Float32Array {
  const v = new Float32Array(dim);
  v[0] = coord1;
  v[1] = coord2;
  return v;
}

describe("Phase 9 -- opt-in memory consolidation (integration)", () => {
  it("default (consolidation disabled) -- no Ollama call is ever made", async () => {
    const ollama = new RecordingOllama([
      '{"winner":"A","justification":"unused"}',
    ]);
    const provider = new FixtureProvider();
    provider.rows.push(
      {
        id: "row-tabs",
        text: "Python uses tabs always for indentation in source files",
        embedding: buildVec(0.9, 0.435889894354067),
      },
      {
        id: "row-spaces",
        text: "Python convention prescribes four spaces of indent for code",
        embedding: buildVec(0.91, 0.4145177),
      },
    );

    const resolver = new ContradictionResolver({
      embedder: new FixtureEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: false },
    });
    const result = await resolver.sweep();

    expect(result.llmCalls).toBe(0);
    expect(ollama.invocationCount).toBe(0);
    for (const row of provider.rows) expect(row.supersededBy).toBeUndefined();
  });

  it("contradicting semantic rows trigger adjudication when enabled", async () => {
    const ollama = new RecordingOllama([
      '{"winner":"B","justification":"newer source overrides legacy fact"}',
    ]);
    const provider = new FixtureProvider();
    // Two rows whose embeddings agree (dense > 0.85) but whose tokenization
    // disagrees enough that the BM25 jaccard overlap stays under 0.4.
    provider.rows.push(
      {
        id: "row-tabs",
        text: "Python uses tabs always for indentation in source files",
        embedding: buildVec(0.9, 0.435889894354067),
        createdAt: new Date("2026-04-01T00:00:00Z").toISOString(),
      },
      {
        id: "row-spaces",
        text: "Python convention prescribes four spaces of indent for code",
        embedding: buildVec(0.91, 0.4145177),
        createdAt: new Date("2026-04-01T00:30:00Z").toISOString(),
      },
    );

    const resolver = new ContradictionResolver({
      embedder: new FixtureEmbedder(new Map()),
      provider,
      ollama,
      options: { enabled: true },
    });
    const result = await resolver.sweep();

    expect(result.llmCalls).toBe(1);
    expect(result.resolved).toBe(1);
    // Loser is whichever row the LLM did not pick; for the canned "B" reply
    // and our (A=tabs, B=spaces) ordering, the loser is row-tabs.
    const loser = provider.rows.find((r) => r.id === "row-tabs")!;
    const winner = provider.rows.find((r) => r.id === "row-spaces")!;
    expect(loser.supersededBy).toBe(winner.id);
    expect(winner.supersededBy).toBeUndefined();
    expect(loser.resolutionLog).toBeDefined();
    expect(loser.resolutionLog![0]!.winnerId).toBe(winner.id);
    expect(loser.resolutionLog![0]!.loserId).toBe(loser.id);
    expect(loser.resolutionLog![0]!.justification).toContain("newer source");
  });

  it("file compressor writes a single semantic-tier row for a 1,000-line fixture", async () => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-compress-"));
    const fixturePath = path.join(tmpdir, "long.py");
    const lines: string[] = [];
    for (let i = 0; i < 1_000; i++) {
      lines.push(`# line ${i}`);
      if (i % 50 === 0) lines.push(`def step_${i}(): return ${i}`);
    }
    fs.writeFileSync(fixturePath, lines.join("\n"));

    const writer = new FixtureWriter();
    const graph = new FixtureGraph();
    const ollama = new RecordingOllama(
      Array.from(
        { length: 64 },
        (_unused, i) =>
          `{"summary":"shard-${i}","key_facts":["fact ${i}"],"code_patterns":["pat${i}"]}`,
      ),
    );
    const compressor = new FileCompressor({
      embedder: new FixtureEmbedder(new Map()),
      writer,
      graph,
      ollama,
      options: { enabled: true, chunkTokens: 250 },
    });
    const result = await compressor.compressFile(fixturePath, {
      sessionId: "integration-session",
      hookKind: "integration.test",
    });

    expect(result.kind).toBe("compressed");
    expect(writer.rows).toHaveLength(1);
    const row = writer.rows[0]!;
    expect(row.id).toBe(compressionEntryId(fixturePath));
    expect(row.provenance.toolName).toBe("memory.compress");
    expect(row.metadata.sourcePath).toBe(fixturePath);
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0]!.kind).toBe("memory.compress.source");
    expect(graph.links[0]!.to).toContain("file://");
    expect(ollama.invocationCount).toBe(result.observation!.chunkCount);

    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("file compressor short-circuits when the compression gate is off", async () => {
    const ollama = new RecordingOllama([]);
    const compressor = new FileCompressor({
      embedder: new FixtureEmbedder(new Map()),
      writer: new FixtureWriter(),
      ollama,
      options: {
        enabled: false,
        readFile: async () => "lots of text".repeat(100),
      },
    });
    const result = await compressor.compressFile("/never-read.txt", {
      sessionId: "s",
      hookKind: "t",
    });
    expect(result.kind).toBe("disabled");
    expect(ollama.invocationCount).toBe(0);
  });
});
