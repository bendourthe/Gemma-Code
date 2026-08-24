/**
 * v2.2.5 Phase 1 (T001) -- one alias table for catalog id, Ollama tag,
 * coding LLM id, and weights id.
 *
 * `catalog.json` `id` plus `source.url` is the source of truth. ModelCatalog
 * LLM ids (`gemma4:e4b`, ...) are aliases of those rows, not a second catalog.
 * Chat-only rows (no coding entry) still resolve to an Ollama runtime id.
 *
 * Duplicate aliases that point at *different* runtime ids fail at catalog-load.
 * Dual-tier siblings that share one Ollama tag (Nemotron native + expert-offload)
 * keep both catalog ids and map the shared tag to the first row. Unknown ids
 * never fall back to `gemma4:e4b`.
 */

import catalogJson from "./catalog.json";
import {
  ModelCatalog,
  type LlmCatalogEntry,
  type ModelFamily,
  type PromptFormatName,
  type ToolFormatName,
} from "./ModelCatalog.js";
import type { CatalogFile, ModelSpec, ModelType } from "./catalog.js";

export interface ModelAliasRecord {
  readonly catalogId: string;
  readonly ollamaTag: string | null;
  readonly codingId: string | null;
  readonly weightsId: string | null;
  readonly displayName: string;
  readonly type: ModelType;
  readonly family: string;
  /** Id the runtime loader accepts (Ollama tag, else catalog / weights id). */
  readonly runtimeId: string;
  readonly aliases: readonly string[];
  readonly coding: LlmCatalogEntry | null;
}

export class DuplicateModelAliasError extends Error {
  constructor(alias: string, first: string, second: string) {
    super(
      `Duplicate model alias "${alias}" maps to both "${first}" and "${second}"`,
    );
    this.name = "DuplicateModelAliasError";
  }
}

function ollamaTagFromSpec(spec: Pick<ModelSpec, "source">): string | null {
  if (spec.source?.protocol !== "ollama") return null;
  const url = spec.source.url ?? "";
  if (url.startsWith("ollama://")) return url.slice("ollama://".length);
  return null;
}

function weightsIdFromSpec(spec: ModelSpec): string | null {
  if (spec.source?.protocol === "huggingface") return spec.id;
  if (spec.type === "image" || spec.type === "video" || spec.type === "audio" || spec.type === "document") {
    return spec.id;
  }
  return null;
}

function safeDirName(modelId: string): string {
  return modelId.replace(/[^A-Za-z0-9._-]/g, "-");
}

function pushUnique(into: string[], value: string | null | undefined): void {
  if (!value || value.length === 0) return;
  if (!into.includes(value)) into.push(value);
}

function familyFormats(family: string): {
  family: ModelFamily;
  promptFormat: PromptFormatName;
  toolFormat: ToolFormatName;
} {
  const key = family.toLowerCase();
  if (key.startsWith("gemma")) {
    return { family: "gemma", promptFormat: "gemma4", toolFormat: "gemma4-xml" };
  }
  if (key.startsWith("qwen")) {
    return { family: "qwen", promptFormat: "qwen", toolFormat: "qwen-json" };
  }
  if (key.startsWith("lfm")) {
    return { family: "lfm2.5", promptFormat: "lfm", toolFormat: "lfm-pythonic" };
  }
  if (key.startsWith("llama")) {
    return { family: "llama", promptFormat: "llama3", toolFormat: "llama3-json" };
  }
  if (key.startsWith("hermes")) {
    return { family: "hermes", promptFormat: "llama3", toolFormat: "llama3-json" };
  }
  if (key.startsWith("muse")) {
    return { family: "muse-glimmer", promptFormat: "llama3", toolFormat: "llama3-json" };
  }
  if (key.startsWith("nemotron")) {
    return { family: "nemotron-lightning", promptFormat: "qwen", toolFormat: "qwen-json" };
  }
  if (key.includes("gpt-oss") || key === "gpt-oss") {
    return { family: "gpt-oss", promptFormat: "llama3", toolFormat: "llama3-json" };
  }
  if (key.startsWith("deepseek")) {
    return { family: "deepseek", promptFormat: "deepseek", toolFormat: "deepseek-json" };
  }
  return { family: "llama", promptFormat: "llama3", toolFormat: "llama3-json" };
}

export function buildAliasTable(
  catalog: CatalogFile,
  llmEntries: readonly LlmCatalogEntry[],
): { records: readonly ModelAliasRecord[]; byAlias: ReadonlyMap<string, ModelAliasRecord> } {
  const byCanonical = new Map<string, ModelAliasRecord>();
  const byAlias = new Map<string, ModelAliasRecord>();

  const register = (record: ModelAliasRecord): void => {
    byCanonical.set(record.catalogId, record);
    for (const alias of record.aliases) {
      const existing = byAlias.get(alias);
      if (existing && existing.catalogId !== record.catalogId) {
        if (existing.runtimeId !== record.runtimeId) {
          throw new DuplicateModelAliasError(alias, existing.catalogId, record.catalogId);
        }
        // Same runtime (dual-tier siblings sharing an Ollama tag). Keep the
        // first lookup winner; the later row still lists the alias for probes.
        continue;
      }
      byAlias.set(alias, record);
    }
  };

  const llmById = new Map(llmEntries.map((e) => [e.id, e]));
  const claimedCoding = new Set<string>();

  for (const spec of catalog.models) {
    const ollamaTag = ollamaTagFromSpec(spec);
    const weightsId = weightsIdFromSpec(spec);
    const aliases: string[] = [];
    pushUnique(aliases, spec.id);
    pushUnique(aliases, ollamaTag);
    pushUnique(aliases, weightsId);
    pushUnique(aliases, safeDirName(spec.id));

    let coding = llmById.get(spec.id) ?? (ollamaTag ? llmById.get(ollamaTag) : undefined);
    if (!coding && spec.name && spec.tag) {
      coding = llmById.get(`${spec.name}:${spec.tag}`);
    }
    if (coding) {
      pushUnique(aliases, coding.id);
      claimedCoding.add(coding.id);
    }

    const runtimeId = ollamaTag ?? spec.id;
    register({
      catalogId: spec.id,
      ollamaTag,
      codingId: coding?.id ?? null,
      weightsId,
      displayName: spec.displayName,
      type: spec.type,
      family: spec.family,
      runtimeId,
      aliases,
      coding: coding ?? null,
    });
  }

  for (const llm of llmEntries) {
    if (claimedCoding.has(llm.id)) continue;
    const aliases = [llm.id];
    register({
      catalogId: llm.id,
      ollamaTag: llm.id,
      codingId: llm.id,
      weightsId: null,
      displayName: llm.displayName,
      type: "llm",
      family: llm.family,
      runtimeId: llm.id,
      aliases,
      coding: llm,
    });
  }

  return { records: [...byCanonical.values()], byAlias };
}

const BUNDLED = buildAliasTable(catalogJson as CatalogFile, ModelCatalog.listLlm());

export const MODEL_ALIAS_RECORDS: readonly ModelAliasRecord[] = BUNDLED.records;

const ALIAS_INDEX: ReadonlyMap<string, ModelAliasRecord> = BUNDLED.byAlias;

export function lookupAlias(id: string): ModelAliasRecord | undefined {
  return ALIAS_INDEX.get(id);
}

/** Runtime id if known; otherwise the original id (never a silent gemma4:e4b swap). */
export function foldModelId(id: string): string {
  if (id.length === 0) return id;
  return lookupAlias(id)?.runtimeId ?? id;
}

export function aliasesFor(id: string): readonly string[] {
  const rec = lookupAlias(id);
  if (rec) return rec.aliases;
  return [id];
}

export function listKnownAliases(): readonly string[] {
  return [...ALIAS_INDEX.keys()].sort();
}

export function isLlmAlias(id: string): boolean {
  const rec = lookupAlias(id);
  return rec?.type === "llm";
}

export interface SidecarRuntimeModel {
  readonly id: string;
  readonly displayName: string;
  readonly family: ModelFamily;
  readonly promptFormat: PromptFormatName;
  readonly toolFormat: ToolFormatName;
  readonly codingAvailable: boolean;
}

export function toSidecarRuntime(record: ModelAliasRecord): SidecarRuntimeModel | undefined {
  if (record.type !== "llm") return undefined;
  if (record.coding) {
    return {
      id: record.runtimeId,
      displayName: record.coding.displayName,
      family: record.coding.family,
      promptFormat: record.coding.promptFormat,
      toolFormat: record.coding.toolFormat,
      codingAvailable: true,
    };
  }
  const formats = familyFormats(record.family);
  return {
    id: record.runtimeId,
    displayName: record.displayName,
    family: formats.family,
    promptFormat: formats.promptFormat,
    toolFormat: formats.toolFormat,
    codingAvailable: false,
  };
}

export function unknownModelIdError(id: string): Error {
  const known = listKnownAliases();
  const preview = known.slice(0, 24).join(", ");
  const more = known.length > 24 ? `, ... (${known.length} total)` : "";
  return new Error(`Unknown model id: ${id}. Known aliases: ${preview}${more}`);
}
