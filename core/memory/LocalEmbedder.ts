/**
 * v1.1.0 Phase 5.1 -- local embedder.
 *
 * Wraps `@xenova/transformers` + the `all-MiniLM-L6-v2` ONNX weights (384-dim)
 * so memory writes can be embedded entirely on-device. Production hosts get
 * the weights from the Phase 14 installer payload (unpacked at
 * `~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/`). Dev hosts fall back to
 * downloading them from the Hugging Face Hub on first use.
 *
 * The class deliberately keeps `@xenova/transformers` as an optional
 * dependency (`require()` at construction time, gated behind a try/catch)
 * so the rest of the codebase -- including unit tests -- still builds and
 * runs when the binary-heavy transformer package is not installed. When the
 * package is unavailable, `LocalEmbedder` falls back to a deterministic
 * hash-based 384-dim sketch. The sketch is NOT useful for production
 * retrieval, but it preserves the embedder's invariants (fixed length,
 * deterministic, batch-callable) so consumers like `DenseIndex` and
 * `HybridRetriever` can be exercised end-to-end in CI without the runtime
 * payload.
 *
 * Adopts agentmemory A2 (see docs/v1.1.0/comparison-agentmemory.md
 * Section 11.2 P1).
 */

import * as os from "node:os";
import * as path from "node:path";

/** Output dimensionality of `all-MiniLM-L6-v2`. */
export const EMBEDDING_DIM = 384;

/** Canonical model identifier on the Hugging Face Hub. */
export const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export interface LocalEmbedderOptions {
  /**
   * Absolute path to a directory containing the unpacked ONNX weights. When
   * omitted, defaults to `~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/`. If
   * the path does not exist, the embedder falls back to the Hub fetch
   * (development path).
   */
  readonly weightsPath?: string;
  /**
   * Hugging Face Hub model id. Defaults to `Xenova/all-MiniLM-L6-v2`.
   * Production should keep the default; tests may override.
   */
  readonly modelId?: string;
  /**
   * When `true`, skip the dynamic `@xenova/transformers` import entirely
   * and always use the deterministic hash fallback. Useful in unit tests
   * that exercise consumers of the embedder without paying the runtime
   * weight-load cost.
   */
  readonly forceFallback?: boolean;
}

/**
 * Resolve the default install path for the bundled weights. Honours the
 * `NEXUS_HOME` env override (used by the cross-OS installer) and falls back
 * to `~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/`.
 */
export function defaultWeightsPath(): string {
  const nexusHome = process.env["NEXUS_HOME"] ?? path.join(os.homedir(), ".nexus");
  return path.join(nexusHome, "runtimes", "embedder", "all-MiniLM-L6-v2");
}

/**
 * Embedding pipeline contract. Implementations return Float32Arrays of
 * length `EMBEDDING_DIM` (384) with L2 norm == 1.
 */
export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly dim: number;
  /**
   * Identifier for the active backend. `"transformers"` when the real
   * `@xenova/transformers` pipeline is loaded; `"hash-fallback"` when the
   * deterministic sketch is active.
   */
  readonly backend: "transformers" | "hash-fallback";
}

interface XenovaPipelineFn {
  (text: string | string[], opts?: Record<string, unknown>): Promise<{
    data: Float32Array | number[];
    dims?: number[];
  }>;
}

interface XenovaPipelineFactory {
  (task: string, model: string, opts?: Record<string, unknown>): Promise<XenovaPipelineFn>;
}

/**
 * Local-host text embedder. Lazily loads the underlying ONNX pipeline on
 * first use so construction is cheap and dependency-free.
 */
export class LocalEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;

  private readonly _weightsPath: string;
  private readonly _modelId: string;
  private readonly _forceFallback: boolean;
  private _pipeline: XenovaPipelineFn | null = null;
  private _loadAttempted = false;
  private _backend: "transformers" | "hash-fallback" = "hash-fallback";

  constructor(opts: LocalEmbedderOptions = {}) {
    this._weightsPath = opts.weightsPath ?? defaultWeightsPath();
    this._modelId = opts.modelId ?? DEFAULT_MODEL_ID;
    this._forceFallback = opts.forceFallback ?? false;
  }

  /**
   * Construct an embedder that reads weights from the installer's bundled
   * payload. Equivalent to `new LocalEmbedder()` but reads more clearly at
   * the call site (the production wiring in `desktop/sidecar/` uses this).
   */
  static fromInstallPath(weightsPath?: string): LocalEmbedder {
    return new LocalEmbedder({ weightsPath });
  }

  get backend(): "transformers" | "hash-fallback" {
    return this._backend;
  }

  /**
   * Embed a single string. The returned Float32Array always has length 384
   * and L2 norm == 1.
   */
  async embed(text: string): Promise<Float32Array> {
    const [vec] = await this.embedBatch([text]);
    return vec!;
  }

  /**
   * Embed a batch of strings. Each row of the returned array has length 384
   * and L2 norm == 1. Empty inputs produce zero vectors (no-op rows).
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this._ensurePipeline();
    if (this._pipeline) {
      const out: Float32Array[] = [];
      for (const text of texts) {
        const result = await this._pipeline(text, { pooling: "mean", normalize: true });
        const raw = result.data;
        const vec =
          raw instanceof Float32Array ? raw : Float32Array.from(raw as number[]);
        out.push(this._normalize(vec));
      }
      return out;
    }
    return texts.map((t) => hashEmbed(t, this.dim));
  }

  private async _ensurePipeline(): Promise<void> {
    if (this._loadAttempted) return;
    this._loadAttempted = true;
    if (this._forceFallback) return;
    try {
      const mod: unknown = await dynamicImport("@xenova/transformers");
      const env = (mod as { env?: Record<string, unknown> }).env;
      if (env) {
        env["allowLocalModels"] = true;
        env["localModelPath"] = path.dirname(this._weightsPath);
      }
      const pipelineFactory = (mod as { pipeline?: XenovaPipelineFactory }).pipeline;
      if (!pipelineFactory) return;
      this._pipeline = await pipelineFactory("feature-extraction", this._modelId, {
        quantized: true,
      });
      this._backend = "transformers";
    } catch {
      this._pipeline = null;
      this._backend = "hash-fallback";
    }
  }

  private _normalize(vec: Float32Array): Float32Array {
    if (vec.length !== this.dim) {
      const padded = new Float32Array(this.dim);
      const n = Math.min(vec.length, this.dim);
      for (let i = 0; i < n; i++) padded[i] = vec[i] ?? 0;
      vec = padded;
    }
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) sumSq += vec[i]! * vec[i]!;
    if (sumSq === 0) return vec;
    const inv = 1 / Math.sqrt(sumSq);
    const out = new Float32Array(this.dim);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i]! * inv;
    return out;
  }
}

/**
 * Deterministic 384-dim hash sketch. Used as a fallback when
 * `@xenova/transformers` is not installed. Tokenizes on whitespace, folds
 * casing, then uses a 32-bit FNV-1a hash to assign each token to a bucket
 * with TF-style accumulation. The result is L2-normalized so cosine
 * similarity is well-defined.
 *
 * The sketch is NOT a substitute for a real embedding model. It exists so
 * the surrounding plumbing (DenseIndex, HybridRetriever, warm-build worker)
 * can be exercised in environments without the binary runtime.
 */
export function hashEmbed(text: string, dim: number = EMBEDDING_DIM): Float32Array {
  const out = new Float32Array(dim);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return out;
  for (const tok of tokens) {
    const h = fnv1a32(tok);
    const bucket = h % dim;
    const sign = ((h >>> 31) & 1) === 1 ? -1 : 1;
    out[bucket]! += sign;
  }
  let sumSq = 0;
  for (let i = 0; i < dim; i++) sumSq += out[i]! * out[i]!;
  if (sumSq === 0) return out;
  const inv = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < dim; i++) out[i]! *= inv;
  return out;
}

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Cosine similarity between two L2-normalized vectors of equal length. For
 * non-normalized inputs the result still computes the inner product over
 * Float32Array, which equals cosine when both are unit vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

async function dynamicImport(moduleName: string): Promise<unknown> {
  return (await import(/* @vite-ignore */ moduleName)) as unknown;
}
