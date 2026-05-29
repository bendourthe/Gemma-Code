/**
 * v1.1.0 Phase 9.2 -- opt-in file compressor.
 *
 * Reads a file from disk, chunks it into ~2,000-token shards, asks a small
 * local Ollama model to extract `{summary, key_facts[], code_patterns[]}`
 * for each shard, and stores the aggregated result as a single semantic-tier
 * observation with `provenance.toolName = "memory.compress"`, the file path
 * recorded in `metadata.sourcePath`, and a back-reference link in the graph
 * layer to the original file.
 *
 * Gated entirely on the `nexus.memory.compression.enabled` Settings key
 * (default `false`); when the gate is off, `compressFile()` short-circuits
 * before any LLM call and returns a `disabled` result.
 *
 * Adopts agentmemory A9 (see docs/versions/v1/v1.1.0/comparison-agentmemory.md
 * Section 11.3 P2).
 */

import { promises as fs } from "node:fs";
import type { Embedder } from "./LocalEmbedder.js";
import type { OllamaChatLike } from "./ContradictionResolver.js";
import type { LifecycleProvenance } from "./types.js";

/** Default chunk size in approximate tokens (~ 4 chars / token). */
export const DEFAULT_CHUNK_TOKENS = 2_000;
/** Heuristic char-per-token ratio used to size chunks without a tokenizer. */
export const CHARS_PER_TOKEN = 4;

export interface CompressedShard {
  readonly index: number;
  readonly summary: string;
  readonly keyFacts: ReadonlyArray<string>;
  readonly codePatterns: ReadonlyArray<string>;
}

export interface CompressedObservation {
  readonly summary: string;
  readonly keyFacts: ReadonlyArray<string>;
  readonly codePatterns: ReadonlyArray<string>;
  readonly shards: ReadonlyArray<CompressedShard>;
  readonly sourcePath: string;
  readonly chunkCount: number;
  readonly model: string;
}

/**
 * Writer port the compressor uses to materialize the semantic observation.
 * The sidecar implementation wraps `MemoryStore.upsert(...)`; the in-memory
 * hub wraps `InMemorySemanticMemory.upsert(...)`; tests record calls.
 */
export interface SemanticWriter {
  upsert(args: {
    readonly id: string;
    readonly content: string;
    readonly provenance: LifecycleProvenance;
    readonly metadata: { readonly sourcePath: string; readonly chunkCount: number; readonly model: string };
    readonly embedding?: Float32Array | null;
  }): Promise<void>;
}

/** Optional graph back-reference port. */
export interface GraphLinker {
  link(args: {
    readonly from: string;
    readonly to: string;
    readonly kind: string;
  }): Promise<void>;
}

export interface FileCompressorOptions {
  /** `nexus.memory.compression.enabled`. When `false` (default), `compressFile` is a no-op. */
  readonly enabled?: boolean;
  /** Approximate tokens per chunk. Default 2,000. */
  readonly chunkTokens?: number;
  /** Maximum number of chunks per compression. Default 32 (caps cost). */
  readonly maxChunks?: number;
  /** Maximum file size in bytes. Default 10 MB. Anything larger is rejected. */
  readonly maxFileBytes?: number;
  /** Injectable file reader (defaults to `fs.readFile`). */
  readonly readFile?: (path: string) => Promise<string>;
  /** Injectable clock for deterministic ids. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export type CompressResultKind = "compressed" | "disabled" | "empty" | "too-large" | "llm-failed";

export interface CompressResult {
  readonly kind: CompressResultKind;
  readonly entryId?: string;
  readonly observation?: CompressedObservation;
  readonly message?: string;
}

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Split `text` into approximately equal-sized chunks of `chunkTokens`
 * tokens each (using the `CHARS_PER_TOKEN` heuristic since we deliberately
 * avoid tiktoken on this path -- it is enough to keep prompts under the
 * model's context window). Boundaries prefer paragraph / line breaks when
 * available; falls back to a hard char-count cut.
 */
export function chunkText(text: string, chunkTokens: number = DEFAULT_CHUNK_TOKENS): string[] {
  if (!text) return [];
  const target = Math.max(1, chunkTokens) * CHARS_PER_TOKEN;
  if (text.length <= target) return [text];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + target);
    if (end < text.length) {
      // Prefer the last paragraph break inside the window; otherwise the
      // last newline; otherwise the last whitespace; otherwise hard cut.
      const window = text.slice(cursor, end);
      const para = window.lastIndexOf("\n\n");
      const nl = window.lastIndexOf("\n");
      const ws = window.lastIndexOf(" ");
      const boundary = para > target / 2 ? para : nl > target / 2 ? nl : ws > target / 2 ? ws : -1;
      if (boundary > 0) end = cursor + boundary + 1;
    }
    chunks.push(text.slice(cursor, end));
    cursor = end;
  }
  return chunks;
}

/**
 * Build the per-shard prompt body. Exported for fixture-based tests.
 */
export function buildCompressionPrompt(shardText: string, shardIndex: number, total: number): string {
  return [
    "You are a careful documentation summarizer. Read the following code/text",
    `chunk (shard ${shardIndex + 1} of ${total}) and respond with compact JSON`,
    "on a single line:",
    "",
    '  {"summary":"<one paragraph>","key_facts":["..."],"code_patterns":["..."]}',
    "",
    "Rules: key_facts must be short standalone statements; code_patterns",
    "must be language/library identifiers or short snippets (max 8 entries",
    "each). Reply with only the JSON object on a single line.",
    "",
    "---begin shard---",
    shardText,
    "---end shard---",
  ].join("\n");
}

interface ShardExtraction {
  readonly summary: string;
  readonly keyFacts: string[];
  readonly codePatterns: string[];
}

/**
 * Best-effort parse of the LLM verdict for a shard. Tolerates code fences
 * and trailing prose; returns an empty extraction when nothing is
 * recoverable (the shard's contribution to the aggregate is then empty).
 */
export function parseShardExtraction(raw: string): ShardExtraction {
  if (!raw) return { summary: "", keyFacts: [], codePatterns: [] };
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { summary: stripped.slice(0, 400), keyFacts: [], codePatterns: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return { summary: stripped.slice(0, 400), keyFacts: [], codePatterns: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { summary: "", keyFacts: [], codePatterns: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj["summary"] === "string" ? (obj["summary"] as string) : "";
  const keyFacts = Array.isArray(obj["key_facts"])
    ? (obj["key_facts"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const codePatterns = Array.isArray(obj["code_patterns"])
    ? (obj["code_patterns"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  return { summary, keyFacts, codePatterns };
}

/**
 * Render the aggregated semantic-tier observation as a single Markdown-ish
 * blob suitable for storage in the `content` column. Keeps the JSON-shaped
 * fields in the same text so downstream BM25 / dense indexers see the
 * facts, not just the summary.
 */
export function renderObservationContent(obs: CompressedObservation): string {
  const lines: string[] = [];
  lines.push(`# Compressed observation: ${obs.sourcePath}`);
  lines.push("");
  lines.push(`Model: ${obs.model}`);
  lines.push(`Chunks: ${obs.chunkCount}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(obs.summary || "(no summary)");
  if (obs.keyFacts.length > 0) {
    lines.push("");
    lines.push("## Key facts");
    for (const f of obs.keyFacts) lines.push(`- ${f}`);
  }
  if (obs.codePatterns.length > 0) {
    lines.push("");
    lines.push("## Code patterns");
    for (const p of obs.codePatterns) lines.push(`- ${p}`);
  }
  return lines.join("\n");
}

/**
 * Compose the semantic-tier id for a compression. Stable across reruns on
 * the same path so re-compressing the same file overwrites the previous
 * observation instead of duplicating it.
 */
export function compressionEntryId(sourcePath: string): string {
  return `memory.compress::${sourcePath}`;
}

export class FileCompressor {
  private readonly _embedder: Embedder;
  private readonly _writer: SemanticWriter;
  private readonly _graph: GraphLinker | null;
  private readonly _ollama: OllamaChatLike;
  private readonly _enabled: boolean;
  private readonly _chunkTokens: number;
  private readonly _maxChunks: number;
  private readonly _maxFileBytes: number;
  private readonly _readFile: (path: string) => Promise<string>;

  constructor(args: {
    readonly embedder: Embedder;
    readonly writer: SemanticWriter;
    readonly ollama: OllamaChatLike;
    readonly graph?: GraphLinker | null;
    readonly options?: FileCompressorOptions;
  }) {
    const opts = args.options ?? {};
    this._embedder = args.embedder;
    this._writer = args.writer;
    this._graph = args.graph ?? null;
    this._ollama = args.ollama;
    this._enabled = opts.enabled ?? false;
    this._chunkTokens = opts.chunkTokens ?? DEFAULT_CHUNK_TOKENS;
    this._maxChunks = opts.maxChunks ?? 32;
    this._maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this._readFile =
      opts.readFile ?? (async (p) => fs.readFile(p, "utf8"));
  }

  /** Whether the compression toggle is on. */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Compress `sourcePath` into a single semantic-tier observation. The
   * `provenance` argument is recorded on the entry so the audit log /
   * provenance chips render correctly. Returns the entry id when a row
   * was written; otherwise carries the reason in `result.kind`.
   */
  async compressFile(
    sourcePath: string,
    provenance: LifecycleProvenance,
  ): Promise<CompressResult> {
    if (!this._enabled) {
      return { kind: "disabled", message: "nexus.memory.compression.enabled is false" };
    }
    let text: string;
    try {
      text = await this._readFile(sourcePath);
    } catch (err) {
      return {
        kind: "empty",
        message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!text) return { kind: "empty", message: "File is empty." };
    if (text.length > this._maxFileBytes) {
      return {
        kind: "too-large",
        message: `File ${sourcePath} exceeds the ${this._maxFileBytes}-byte compression ceiling.`,
      };
    }
    const allChunks = chunkText(text, this._chunkTokens);
    const chunks = allChunks.slice(0, this._maxChunks);
    if (chunks.length === 0) return { kind: "empty", message: "No chunks produced." };

    const shards: CompressedShard[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const prompt = buildCompressionPrompt(chunks[i]!, i, chunks.length);
      let reply: string;
      try {
        reply = await this._ollama.chat(prompt);
      } catch (err) {
        return {
          kind: "llm-failed",
          message: `Ollama call failed on shard ${i}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const extracted = parseShardExtraction(reply);
      shards.push({
        index: i,
        summary: extracted.summary,
        keyFacts: extracted.keyFacts,
        codePatterns: extracted.codePatterns,
      });
    }

    const aggregatedSummary = shards
      .map((s) => s.summary)
      .filter((s) => s.length > 0)
      .join("\n\n");
    const aggregatedFacts = dedupeStrings(shards.flatMap((s) => s.keyFacts));
    const aggregatedPatterns = dedupeStrings(shards.flatMap((s) => s.codePatterns));

    const observation: CompressedObservation = {
      summary: aggregatedSummary,
      keyFacts: aggregatedFacts,
      codePatterns: aggregatedPatterns,
      shards,
      sourcePath,
      chunkCount: chunks.length,
      model: this._ollama.model,
    };
    const content = renderObservationContent(observation);
    const entryId = compressionEntryId(sourcePath);

    let embedding: Float32Array | null = null;
    try {
      embedding = await this._embedder.embed(content);
    } catch {
      embedding = null;
    }

    await this._writer.upsert({
      id: entryId,
      content,
      provenance: { ...provenance, toolName: "memory.compress" },
      metadata: {
        sourcePath,
        chunkCount: chunks.length,
        model: this._ollama.model,
      },
      embedding,
    });

    if (this._graph) {
      try {
        await this._graph.link({
          from: entryId,
          to: `file://${sourcePath}`,
          kind: "memory.compress.source",
        });
      } catch {
        // Graph linkage is best-effort; failures here do not invalidate the
        // observation write.
      }
    }

    return { kind: "compressed", entryId, observation };
  }
}

/** Order-preserving string dedupe. */
function dedupeStrings(values: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
