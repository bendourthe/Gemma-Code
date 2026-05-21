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
  | "controlnet"
  | "vae";

export interface ModelSpecSource {
  readonly protocol: "ollama" | "huggingface" | "url";
  readonly url?: string;
  readonly repo?: string;
  readonly sha256?: string;
}

export interface ModelSpec {
  readonly id: string;
  readonly family: string;
  readonly name: string;
  readonly tag: string;
  readonly type: ModelType;
  readonly displayName: string;
  readonly description?: string;
  readonly sizeGB?: number;
  readonly vramGB?: number;
  readonly requiredVramGB?: number;
  readonly license?: string;
  readonly source: ModelSpecSource;
  readonly tags?: readonly string[];
  readonly releaseDate?: string;
  readonly uncensored?: boolean;
  readonly multimodal?: boolean;
  readonly contextWindow?: number | null;
  readonly linkedVAE?: string;
  readonly linkedFamily?: string;
  readonly runtimeDeps?: readonly string[];
}

export interface CatalogFile {
  readonly _meta?: Record<string, unknown>;
  readonly models: readonly ModelSpec[];
}

export function validateSpec(spec: ModelSpec): void {
  if (!spec.id || !spec.family || !spec.name || !spec.tag) {
    throw new Error(`ModelCatalog: entry missing id/family/name/tag: ${JSON.stringify(spec)}`);
  }
  if (!spec.type || !["llm", "embed", "image", "video", "controlnet", "vae"].includes(spec.type)) {
    throw new Error(`ModelCatalog: invalid type for ${spec.id}: ${spec.type}`);
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
