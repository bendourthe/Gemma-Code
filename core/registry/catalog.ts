/**
 * v1.0.0 Phase 5.3 -- catalog loader + spec types.
 *
 * The curated catalog lives at `core/registry/catalog.json` for human
 * review. This module declares the TypeScript shapes for `ModelSpec`
 * entries and exposes a runtime loader (`loadCatalog`) that reads the
 * JSON file and validates each entry. Validation is intentionally
 * lightweight; production callers should additionally schema-check via
 * `manifest.schema.json` when they materialize manifests.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export type ModelType =
  | "llm"
  | "embed"
  | "image"
  | "video"
  | "audio"
  | "controlnet"
  | "vae";

/**
 * v1.8.0 Phase 4 -- user-facing catalog section a model belongs to.
 * `chat` and `agentic` split the former Text tab; `embed` entries render
 * inside the Chat section (memory-layer support models). Support types
 * (vae, controlnet) carry no task.
 */
export type ModelTask =
  | "chat"
  | "agentic"
  | "image"
  | "video"
  | "audio"
  | "embed";

const MODEL_TASKS: readonly ModelTask[] = [
  "chat",
  "agentic",
  "image",
  "video",
  "audio",
  "embed",
];

export interface ModelSpecSource {
  readonly protocol: "ollama" | "huggingface" | "url";
  readonly url?: string;
  readonly repo?: string;
  readonly sha256?: string;
}

/**
 * v1.8.0 Phase 3 -- one file of a per-model weights manifest. `path` is the
 * repo-relative path under `https://huggingface.co/{repo}/resolve/main/` and
 * the destination path under `<models_root>/weights/<model-id>/`. An all-zero
 * `sha256` is a placeholder pin (see `_meta.comment` in catalog.json).
 */
export interface ModelWeightsFile {
  readonly path: string;
  readonly sha256: string;
}

export interface ModelWeightsManifest {
  readonly layoutVersion: 1;
  readonly files: readonly ModelWeightsFile[];
}

export interface ModelSpec {
  readonly id: string;
  readonly family: string;
  readonly name: string;
  readonly tag: string;
  readonly type: ModelType;
  readonly task?: ModelTask;
  readonly displayName: string;
  readonly description?: string;
  /** v1.8.0 Phase 4 -- wizard-card copy: what the model is good at. */
  readonly strengths?: readonly string[];
  /** v1.8.0 Phase 4 -- wizard-card copy: why this entry is a tier default. */
  readonly whyRecommended?: string;
  /** v1.8.0 Phase 4 -- wizard-card copy: what sets it apart in its section. */
  readonly differentiators?: string;
  /** v1.8.0 Phase 4 -- publisher + lineage record; required for uncensored entries. */
  readonly provenance?: string;
  /**
   * v1.9.0 Phase 4 -- country (or "Community") of the model's primary
   * publisher, surfaced as an Origin chip in the installer catalog cards.
   */
  readonly origin?: string;
  /**
   * v1.9.0 Phase 4 -- agentic-coding capability. Agentic-capable chat models
   * (the Gemma 4 family) set this so the installer's Agentic tab lists them
   * alongside the coding specialists (`task: "agentic"`); the coders set it
   * too. Distinct from `task`: a model's `task` is its primary section, while
   * `agentic` is an orthogonal capability flag.
   */
  readonly agentic?: boolean;
  /**
   * v1.9.0 Phase 4 -- optional guardrails nuance. The installer derives a
   * coarse display label ("Uncensored" / "Safety-tuned" / "N/A") from
   * `uncensored`; set this to override the derived label with a specific
   * phrase when a model needs nuance.
   */
  readonly guardrails?: string;
  readonly sizeGB?: number;
  readonly vramGB?: number;
  readonly requiredVramGB?: number;
  readonly license?: string;
  readonly source: ModelSpecSource;
  readonly weights?: ModelWeightsManifest;
  readonly tags?: readonly string[];
  readonly releaseDate?: string;
  readonly uncensored?: boolean;
  readonly multimodal?: boolean;
  readonly contextWindow?: number | null;
  readonly linkedVAE?: string;
  readonly linkedFamily?: string;
  readonly runtimeDeps?: readonly string[];
  /**
   * v1.12.0 Phase 3 (Q1) -- GGUF quant label (e.g. `Q4_K_M`, `TQ1_0`). When the
   * value is a BitNet-class ternary/1-bit type (see `extremeLowBit.ts`), the
   * entry belongs to the extreme-low-bit tier and is HARD-GATED: surfaced only
   * when the runtime supports the format AND `benchmark` is present.
   */
  readonly quant?: string;
  /**
   * v1.12.0 Phase 3 (Q1) -- reference (URL / citation) to an INDEPENDENT
   * third-party benchmark of this model. Required for an extreme-low-bit entry
   * to be surfaced (the gate rejects un-benchmarked sub-4-bit weights, whose
   * quality retention is otherwise a vendor claim).
   */
  readonly benchmark?: string;
}

export interface CatalogFile {
  readonly _meta?: Record<string, unknown>;
  readonly models: readonly ModelSpec[];
}

export function validateSpec(spec: ModelSpec): void {
  if (!spec.id || !spec.family || !spec.name || !spec.tag) {
    throw new Error(`ModelCatalog: entry missing id/family/name/tag: ${JSON.stringify(spec)}`);
  }
  if (!spec.type || !["llm", "embed", "image", "video", "audio", "controlnet", "vae"].includes(spec.type)) {
    throw new Error(`ModelCatalog: invalid type for ${spec.id}: ${spec.type}`);
  }
  if (spec.task !== undefined && !MODEL_TASKS.includes(spec.task)) {
    throw new Error(`ModelCatalog: invalid task for ${spec.id}: ${spec.task}`);
  }
  if (spec.uncensored === true && !spec.provenance) {
    throw new Error(
      `ModelCatalog: ${spec.id} is uncensored but records no provenance (curation policy: license + provenance per uncensored entry)`,
    );
  }
  if (!spec.source || !spec.source.protocol) {
    throw new Error(`ModelCatalog: entry missing source for ${spec.id}`);
  }
  if (spec.source.protocol !== "ollama" && !spec.source.url) {
    throw new Error(`ModelCatalog: ${spec.id} requires source.url for ${spec.source.protocol}`);
  }
  if (spec.source.protocol !== "ollama" && spec.source.sha256 && !/^[a-f0-9]{64}$/.test(spec.source.sha256)) {
    throw new Error(`ModelCatalog: ${spec.id} has malformed source.sha256`);
  }
  if (spec.weights) {
    if (!Array.isArray(spec.weights.files) || spec.weights.files.length === 0) {
      throw new Error(`ModelCatalog: ${spec.id} weights manifest has no files`);
    }
    for (const file of spec.weights.files) {
      if (!file.path || file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) {
        throw new Error(`ModelCatalog: ${spec.id} weights file path is unsafe: ${file.path}`);
      }
      if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw new Error(`ModelCatalog: ${spec.id} weights file ${file.path} has malformed sha256`);
      }
    }
  }
}

export function validateCatalog(file: CatalogFile): void {
  if (!file || !Array.isArray(file.models)) {
    throw new Error("ModelCatalog: catalog is missing `models` array");
  }
  const seen = new Set<string>();
  for (const spec of file.models) {
    validateSpec(spec);
    if (seen.has(spec.id)) {
      throw new Error(`ModelCatalog: duplicate id ${spec.id}`);
    }
    seen.add(spec.id);
  }
}

let DEFAULT_CATALOG_PATH: string | null = null;

/**
 * Locate the bundled `catalog.json`. The module compiles to CommonJS so
 * `__dirname` is the post-build directory of this file; we fall back to a
 * project-root-relative path when `__dirname` is unavailable (ESM bundler
 * contexts).
 */
function defaultCatalogPath(): string {
  if (DEFAULT_CATALOG_PATH) return DEFAULT_CATALOG_PATH;
  const dir =
    typeof __dirname === "string" && __dirname.length > 0
      ? __dirname
      : path.resolve("core/registry");
  DEFAULT_CATALOG_PATH = path.join(dir, "catalog.json");
  return DEFAULT_CATALOG_PATH;
}

export async function loadCatalog(catalogPath: string = defaultCatalogPath()): Promise<CatalogFile> {
  const body = await fs.readFile(catalogPath, "utf8");
  const parsed = JSON.parse(body) as CatalogFile;
  validateCatalog(parsed);
  return parsed;
}

export function findSpec(catalog: CatalogFile, id: string): ModelSpec | undefined {
  return catalog.models.find((m) => m.id === id);
}

export function getSpec(catalog: CatalogFile, id: string): ModelSpec {
  const spec = findSpec(catalog, id);
  if (!spec) throw new Error(`ModelCatalog: unknown id ${id}`);
  return spec;
}
