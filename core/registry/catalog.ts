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
  | "vae"
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing. A `document`
   * model turns an image or a PDF into text/markdown; it is served by the
   * `runtimes/ocr` Python runtime, not by any LLM or diffusion path.
   */
  | "document";

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
  | "embed"
  /** v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing section. */
  | "document";

const MODEL_TASKS: readonly ModelTask[] = [
  "chat",
  "agentic",
  "image",
  "video",
  "audio",
  "embed",
  "document",
];

export interface ModelSpecSource {
  readonly protocol: "ollama" | "huggingface" | "url";
  readonly url?: string;
  readonly repo?: string;
  readonly sha256?: string;
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- HuggingFace commit hash the weights
   * are pinned to. When present, pullers resolve `resolve/<revision>/` instead
   * of the floating `resolve/main/`, so a repo whose `main` moves (or is
   * force-pushed) cannot silently change what a user installs.
   *
   * This matters most for a model that ships executable code: the OCR VLM runs
   * under `trust_remote_code`, and an unpinned `main` would mean arbitrary new
   * code on every install. A 40-hex commit sha is required when set.
   */
  readonly revision?: string;
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

/**
 * v1.19.2 -- one official precision line (fp16 / int8 / fp8 / GGUF quant).
 * Community re-quantizations are rejected at validateSpec (`official` must be true).
 */
export type WeightPrecision = "fp16" | "bf16" | "fp8" | "int8" | "gguf";

export interface ModelWeightsVariant {
  readonly id: string;
  readonly precision: WeightPrecision;
  /** Must be true: only first-party or established official lines are eligible. */
  readonly official: true;
  readonly files: readonly ModelWeightsFile[];
  readonly sizeGB?: number;
  readonly vramGB?: number;
  readonly quant?: string;
}

export interface ModelWeightsManifest {
  readonly layoutVersion: 1 | 2;
  /** Layout v1 default file list; omitted when `variants` is the sole source. */
  readonly files?: readonly ModelWeightsFile[];
  /** v1.19.2 -- precision-variant file sets. */
  readonly variants?: readonly ModelWeightsVariant[];
  readonly defaultVariant?: string;
}

/** v1.19.2 -- input modalities the chat / Video Lab surfaces can gate on. */
export type ModelModality = "text" | "image" | "audio";

const MODEL_MODALITIES: readonly ModelModality[] = ["text", "image", "audio"];

/** v1.19.2 -- audio-driven video modes consumed by Video Lab. */
export type AudioConditioningMode = "none" | "single" | "merge" | "concat";

export interface AudioConditioning {
  readonly supported: boolean;
  readonly modes?: readonly AudioConditioningMode[];
  readonly encoder?: string;
}

/**
 * v1.19.2 -- RAM-budget expectation presets (Kimi K1). Catalog and settings
 * copy only. Nexus does not bundle the disk-offload runtime.
 */
export type PatientRamPresetId = "laptop" | "workstation" | "max";

export interface PatientRamPreset {
  readonly id: PatientRamPresetId;
  readonly label: string;
  readonly peakRssGB: number;
  readonly expectedSecondsPerToken: number;
  readonly copy: string;
}

const PATIENT_RAM_PRESET_IDS: readonly PatientRamPresetId[] = ["laptop", "workstation", "max"];

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
  /**
   * v1.14.0 -- first-party license page. On gated opt-ins this is the Hugging
   * Face click-through the installer opens; on ungated entries it is still the
   * license text the card should link.
   */
  readonly licenseUrl?: string;
  /**
   * v1.19.0 Phase 1 -- visible use-restriction copy for ungated licenses that
   * still bind the user's commercial use (e.g. LFM Open License v1.0 USD 10M
   * revenue cap). Distinct from `requiresLicense`: a note never trips the
   * guided token/acceptance flow.
   */
  readonly licenseNote?: string;
  /**
   * v1.14.0 -- when true, the installer guided Hugging Face step must run
   * before download. Ungated entries (including LFM) leave this false/omitted.
   */
  readonly requiresLicense?: boolean;
  readonly source: ModelSpecSource;
  readonly weights?: ModelWeightsManifest;
  readonly tags?: readonly string[];
  readonly releaseDate?: string;
  readonly uncensored?: boolean;
  /**
   * The CHAT prompt-assembly may attach images to this model -- it must satisfy
   * `isVisionCapableModel` (asserted by `tests/unit/config/ModelCapabilities.test.ts`).
   *
   * NOT "this model can read images". A `type: "document"` OCR model reads
   * images but is served by `runtimes/ocr`, never through the LLM path, so it
   * leaves this false; its image handling is implied by its type.
   */
  readonly multimodal?: boolean;
  readonly contextWindow?: number | null;
  /**
   * v2.2.7 Phase 1 -- optional split in/out windows. Omitted on nearly every
   * row; when present, Settings and the installer chip as `Nk / Mk` without
   * the word `in`. Do not invent these from a single `contextWindow`.
   */
  readonly contextWindowIn?: number | null;
  readonly contextWindowOut?: number | null;
  readonly linkedVAE?: string;
  readonly linkedFamily?: string;
  readonly runtimeDeps?: readonly string[];
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- the model ships custom Python that the
   * loader executes (HuggingFace `trust_remote_code=True`). Declaring it in the
   * catalog makes the supply-chain surface reviewable rather than buried in a
   * runtime call, and `validateSpec` REQUIRES a pinned `source.revision`
   * whenever it is set. The runtime additionally refuses to execute repo code
   * outside the sandboxed Python process.
   */
  readonly trustRemoteCode?: boolean;
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- which `runtimes/ocr` engine serves
   * this model. Lets one runtime host several document backends (a CUDA VLM and
   * a portable ONNX engine) without the sidecar hard-coding model ids.
   */
  readonly ocrEngine?: "unlimited-ocr" | "rapidocr";
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
  /**
   * v1.18.0 Phase 3 (OW-A4) -- Nexus has validated this model for agentic tool
   * use. Absent or false means unverified (the conservative default). True
   * requires {@link toolCallingBenchmark} provenance.
   */
  readonly toolCallingVerified?: boolean;
  /**
   * v1.18.0 Phase 3 (OW-A4) -- what was run, when, and the result that backs
   * `toolCallingVerified`. Required when the verified flag is true.
   */
  readonly toolCallingBenchmark?: ToolCallingBenchmark;
  /**
   * v1.18.0 Phase 3 (LG-A3) -- MoE active-parameter count in billions. Dense
   * entries omit both MoE fields. When present, compute-tier reasoning prefers
   * this over total size.
   */
  readonly activeParams?: number;
  /**
   * v1.18.0 Phase 3 (LG-A3) -- MoE total / resident parameter count in
   * billions. Dense entries omit both MoE fields. When present, residency /
   * VRAM estimates prefer this (never `activeParams`).
   */
  readonly totalParams?: number;
  /**
   * v1.19.2 -- input modalities. Chat surfaces gate image/audio attachments on
   * this array. Backfilled text-only unless the entry documents otherwise.
   */
  readonly modalities?: readonly ModelModality[];
  /**
   * v1.19.2 -- audio-driven video modes. Video Lab gates audio-input on this
   * object. Omitted on non-video entries.
   */
  readonly audioConditioning?: AudioConditioning;
  /**
   * v1.19.2 -- expected seconds per generated token for a patient-tier entry
   * when independent measurement exists (Kimi K2 calibration).
   */
  readonly expectedSecondsPerToken?: number;
  /**
   * v1.19.2 -- independently measured peak RSS in GB for a patient-tier entry.
   */
  readonly measuredPeakRssGB?: number;
  /**
   * v1.19.2 -- RAM-budget expectation presets (laptop / workstation / max).
   * Copy only: Nexus does not bundle the offload runtime.
   */
  readonly patientRamPresets?: readonly PatientRamPreset[];
  /**
   * v2.1.0 Phase 1 -- true when this entry is a diffusion (image/video)
   * generator. Omitted on older entries; {@link normalizeSpec} defaults to false.
   */
  readonly diffusion?: boolean;
  /**
   * v2.1.0 Phase 1 -- false when the model must never be a coding-harness
   * default (chat-drafting / experimental generators). Omitted on older
   * entries; {@link normalizeSpec} defaults to true.
   */
  readonly codingEligible?: boolean;
  /**
   * v2.1.0 Phase 1 -- hide the entry entirely when host VRAM is below this
   * floor (GB). Distinct from `requiredVramGB`, which only grays over-budget
   * rows. Muse Glimmer / Lightning use 16 so 12 GB hosts never see them.
   */
  readonly hideBelowVramGB?: number;
  /**
   * v2.1.0 Phase 1 -- minimum Ollama version (semver) required to load this
   * entry. Runtime hide + "update Ollama" note when the detected version is
   * older. Installer catalog page (version unknown) keeps the row and shows
   * the note.
   */
  readonly minOllamaVersion?: string;
  /**
   * v2.1.0 Phase 1 -- routing role hint. `worker-candidate` marks a fast
   * routine-step model for Phase 2 adaptive routing.
   */
  readonly role?: "worker-candidate" | "strong-candidate";
  /**
   * v2.1.0 Phase 1 -- vendor-published benchmark, never used for routing
   * until {@link localEval} records a local result.
   */
  readonly vendorReported?: VendorReportedBenchmark;
  /**
   * v2.1.0 Phase 1 -- local golden-task result. Absent or `not_run` /
   * `incomplete` keeps the model off default routes.
   */
  readonly localEval?: LocalEvalBlock;
  /**
   * v2.1.0 Phase 4 -- chat vision. True only for VLMs that can consume
   * image/video attachments. Omitted: LLMs with `image` in modalities
   * default true; every other type defaults false (OCR / diffusion / SAM2).
   */
  readonly vision?: boolean;
  /**
   * v2.1.0 Phase 4 -- per-model visual-token budget. Applied before bytes
   * reach Ollama so a pasted screenshot cannot OOM the GPU.
   */
  readonly visualTokenBudget?: VisualTokenBudget;
}

/** v2.1.0 Phase 4 -- caps on visual tokens forwarded to a VLM. */
export interface VisualTokenBudget {
  readonly maxImages?: number;
  readonly maxPixels?: number;
  readonly maxVideoFrames?: number;
  readonly maxVideoSeconds?: number;
}

/** v2.1.0 Phase 1 -- a vendor-published score that is not a local measurement. */
export interface VendorReportedBenchmark {
  readonly suite: string;
  readonly metric?: string;
  readonly value?: number | string;
  readonly date?: string;
  /** Must be true: this block is never treated as a local eval. */
  readonly vendorReported: true;
}

export type LocalEvalStatus = "pass" | "fail" | "incomplete" | "not_run";

/** v2.1.0 Phase 1 -- local golden-task evaluation persisted on the catalog entry. */
export interface LocalEvalBlock {
  readonly suite: string;
  readonly status: LocalEvalStatus;
  readonly date: string;
  readonly result?: string;
  readonly hardwareTier?: string;
  readonly reason?: string;
}

/**
 * v1.18.0 Phase 3 (OW-A4) -- provenance for a `toolCallingVerified` claim.
 */
export interface ToolCallingBenchmark {
  readonly suite: string;
  readonly date: string;
  readonly result: string;
}

export interface CatalogFile {
  readonly _meta?: Record<string, unknown>;
  readonly models: readonly ModelSpec[];
}

const WEIGHT_PRECISIONS: readonly WeightPrecision[] = ["fp16", "bf16", "fp8", "int8", "gguf"];

function validateWeightsFile(modelId: string, file: ModelWeightsFile): void {
  if (!file.path || file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) {
    throw new Error(`ModelCatalog: ${modelId} weights file path is unsafe: ${file.path}`);
  }
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error(`ModelCatalog: ${modelId} weights file ${file.path} has malformed sha256`);
  }
}

function validateWeightsManifest(modelId: string, weights: ModelWeightsManifest): void {
  const files = weights.files ?? [];
  const variants = weights.variants ?? [];
  if (files.length === 0 && variants.length === 0) {
    throw new Error(`ModelCatalog: ${modelId} weights manifest has no files or variants`);
  }
  for (const file of files) {
    validateWeightsFile(modelId, file);
  }
  const seenVariantIds = new Set<string>();
  for (const variant of variants) {
    if (!variant.id || variant.id.trim().length === 0) {
      throw new Error(`ModelCatalog: ${modelId} weights variant is missing id`);
    }
    if (seenVariantIds.has(variant.id)) {
      throw new Error(`ModelCatalog: ${modelId} has duplicate weights variant id ${variant.id}`);
    }
    seenVariantIds.add(variant.id);
    if (variant.official !== true) {
      throw new Error(
        `ModelCatalog: ${modelId} variant ${variant.id} is not official; unvetted community quantizations are not eligible`,
      );
    }
    if (!WEIGHT_PRECISIONS.includes(variant.precision)) {
      throw new Error(
        `ModelCatalog: ${modelId} variant ${variant.id} has invalid precision "${String(variant.precision)}"`,
      );
    }
    if (!Array.isArray(variant.files) || variant.files.length === 0) {
      throw new Error(`ModelCatalog: ${modelId} variant ${variant.id} has no files`);
    }
    for (const file of variant.files) {
      validateWeightsFile(modelId, file);
    }
  }
  if (weights.defaultVariant !== undefined) {
    if (variants.length === 0 || !seenVariantIds.has(weights.defaultVariant)) {
      throw new Error(
        `ModelCatalog: ${modelId} defaultVariant "${weights.defaultVariant}" does not match a declared variant`,
      );
    }
  }
}

export function validateSpec(spec: ModelSpec): void {
  if (!spec.id || !spec.family || !spec.name || !spec.tag) {
    throw new Error(`ModelCatalog: entry missing id/family/name/tag: ${JSON.stringify(spec)}`);
  }
  if (
    !spec.type ||
    !["llm", "embed", "image", "video", "audio", "controlnet", "vae", "document"].includes(spec.type)
  ) {
    throw new Error(`ModelCatalog: invalid type for ${spec.id}: ${spec.type}`);
  }
  if (spec.task !== undefined && !MODEL_TASKS.includes(spec.task)) {
    throw new Error(`ModelCatalog: invalid task for ${spec.id}: ${spec.task}`);
  }
  if (spec.task !== undefined) {
    const description = spec.description?.trim() ?? "";
    if (!description || !/[.!?]$/.test(description)) {
      throw new Error(
        `ModelCatalog: selectable entry ${spec.id} requires a complete-sentence description`,
      );
    }
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
  // v1.16.0 Phase 3 (A5): a pinned revision must be a full 40-hex commit sha.
  // A branch or tag name is rejected on purpose -- both are mutable, which is
  // exactly the supply-chain hole pinning exists to close.
  if (spec.source.revision !== undefined && !/^[a-f0-9]{40}$/.test(spec.source.revision)) {
    throw new Error(
      `ModelCatalog: ${spec.id} has a malformed source.revision (expected a 40-hex commit sha, got "${spec.source.revision}")`,
    );
  }
  // A model that executes repo-supplied code must be pinned: an unpinned `main`
  // means every install can fetch different code.
  if (spec.trustRemoteCode === true && !spec.source.revision) {
    throw new Error(
      `ModelCatalog: ${spec.id} sets trustRemoteCode but has no source.revision; a model that runs repo code MUST pin a commit sha`,
    );
  }
  if (spec.weights) {
    validateWeightsManifest(spec.id, spec.weights);
  }
  if (spec.modalities !== undefined) {
    if (!Array.isArray(spec.modalities) || spec.modalities.length === 0) {
      throw new Error(`ModelCatalog: ${spec.id} modalities must be a non-empty array`);
    }
    for (const modality of spec.modalities) {
      if (!MODEL_MODALITIES.includes(modality)) {
        throw new Error(`ModelCatalog: ${spec.id} has invalid modality "${String(modality)}"`);
      }
    }
  }
  if (spec.audioConditioning !== undefined) {
    if (typeof spec.audioConditioning.supported !== "boolean") {
      throw new Error(`ModelCatalog: ${spec.id} audioConditioning.supported must be a boolean`);
    }
    const modes = spec.audioConditioning.modes;
    if (modes !== undefined) {
      if (!Array.isArray(modes)) {
        throw new Error(`ModelCatalog: ${spec.id} audioConditioning.modes must be an array`);
      }
      const allowed: readonly AudioConditioningMode[] = ["none", "single", "merge", "concat"];
      for (const mode of modes) {
        if (!allowed.includes(mode)) {
          throw new Error(`ModelCatalog: ${spec.id} has invalid audioConditioning mode "${String(mode)}"`);
        }
      }
    }
  }
  if (spec.expectedSecondsPerToken !== undefined) {
    if (!Number.isFinite(spec.expectedSecondsPerToken) || spec.expectedSecondsPerToken <= 0) {
      throw new Error(`ModelCatalog: ${spec.id} expectedSecondsPerToken must be a positive number`);
    }
  }
  if (spec.measuredPeakRssGB !== undefined) {
    if (!Number.isFinite(spec.measuredPeakRssGB) || spec.measuredPeakRssGB <= 0) {
      throw new Error(`ModelCatalog: ${spec.id} measuredPeakRssGB must be a positive number`);
    }
  }
  if (spec.patientRamPresets !== undefined) {
    if (!Array.isArray(spec.patientRamPresets) || spec.patientRamPresets.length === 0) {
      throw new Error(`ModelCatalog: ${spec.id} patientRamPresets must be a non-empty array`);
    }
    const seenPresetIds = new Set<string>();
    for (const preset of spec.patientRamPresets) {
      if (!PATIENT_RAM_PRESET_IDS.includes(preset.id)) {
        throw new Error(
          `ModelCatalog: ${spec.id} has invalid patientRamPreset id "${String(preset.id)}"`,
        );
      }
      if (seenPresetIds.has(preset.id)) {
        throw new Error(`ModelCatalog: ${spec.id} has duplicate patientRamPreset id ${preset.id}`);
      }
      seenPresetIds.add(preset.id);
      if (!Number.isFinite(preset.peakRssGB) || preset.peakRssGB <= 0) {
        throw new Error(`ModelCatalog: ${spec.id} patientRamPreset ${preset.id} peakRssGB must be positive`);
      }
      if (!Number.isFinite(preset.expectedSecondsPerToken) || preset.expectedSecondsPerToken <= 0) {
        throw new Error(
          `ModelCatalog: ${spec.id} patientRamPreset ${preset.id} expectedSecondsPerToken must be positive`,
        );
      }
    }
  }
  // v1.18.0 Phase 3 (OW-A4): a verified claim must cite what was run.
  if (spec.toolCallingVerified === true) {
    const bench = spec.toolCallingBenchmark;
    if (!bench || !bench.suite?.trim() || !bench.date?.trim() || !bench.result?.trim()) {
      throw new Error(
        `ModelCatalog: ${spec.id} sets toolCallingVerified but has no toolCallingBenchmark (suite/date/result)`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bench.date.trim())) {
      throw new Error(
        `ModelCatalog: ${spec.id} toolCallingBenchmark.date must be YYYY-MM-DD (got "${bench.date}")`,
      );
    }
  }
  // v1.18.0 Phase 3 (LG-A3): MoE fields are optional together; mixed or inverted values are rejected.
  const hasActive = spec.activeParams !== undefined;
  const hasTotal = spec.totalParams !== undefined;
  if (hasActive !== hasTotal) {
    throw new Error(
      `ModelCatalog: ${spec.id} must set both activeParams and totalParams, or neither`,
    );
  }
  if (hasActive && hasTotal) {
    if (!Number.isFinite(spec.activeParams) || (spec.activeParams as number) <= 0) {
      throw new Error(`ModelCatalog: ${spec.id} activeParams must be a positive number`);
    }
    if (!Number.isFinite(spec.totalParams) || (spec.totalParams as number) <= 0) {
      throw new Error(`ModelCatalog: ${spec.id} totalParams must be a positive number`);
    }
    if ((spec.activeParams as number) > (spec.totalParams as number)) {
      throw new Error(
        `ModelCatalog: ${spec.id} activeParams (${spec.activeParams}) exceeds totalParams (${spec.totalParams})`,
      );
    }
  }
  // v2.1.0 Phase 1 -- capability flags, visibility floors, eval metadata.
  if (spec.diffusion !== undefined && typeof spec.diffusion !== "boolean") {
    throw new Error(`ModelCatalog: ${spec.id} diffusion must be a boolean`);
  }
  if (spec.codingEligible !== undefined && typeof spec.codingEligible !== "boolean") {
    throw new Error(`ModelCatalog: ${spec.id} codingEligible must be a boolean`);
  }
  if (spec.hideBelowVramGB !== undefined) {
    if (!Number.isFinite(spec.hideBelowVramGB) || (spec.hideBelowVramGB as number) < 0) {
      throw new Error(`ModelCatalog: ${spec.id} hideBelowVramGB must be a non-negative number`);
    }
  }
  if (spec.minOllamaVersion !== undefined) {
    const min = spec.minOllamaVersion.trim();
    if (!/^\d+\.\d+\.\d+$/.test(min)) {
      throw new Error(
        `ModelCatalog: ${spec.id} minOllamaVersion must be MAJOR.MINOR.PATCH (got "${spec.minOllamaVersion}")`,
      );
    }
  }
  if (spec.role !== undefined && spec.role !== "worker-candidate" && spec.role !== "strong-candidate") {
    throw new Error(`ModelCatalog: ${spec.id} has invalid role "${String(spec.role)}"`);
  }
  if (spec.vendorReported !== undefined) {
    const vr = spec.vendorReported;
    if (vr.vendorReported !== true || !vr.suite?.trim()) {
      throw new Error(
        `ModelCatalog: ${spec.id} vendorReported must set vendorReported: true and a suite`,
      );
    }
    if (vr.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(vr.date.trim())) {
      throw new Error(
        `ModelCatalog: ${spec.id} vendorReported.date must be YYYY-MM-DD (got "${vr.date}")`,
      );
    }
  }
  if (spec.localEval !== undefined) {
    const ev = spec.localEval;
    const statuses: readonly LocalEvalStatus[] = ["pass", "fail", "incomplete", "not_run"];
    if (!ev.suite?.trim() || !statuses.includes(ev.status)) {
      throw new Error(
        `ModelCatalog: ${spec.id} localEval requires suite and status pass|fail|incomplete|not_run`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date.trim())) {
      throw new Error(
        `ModelCatalog: ${spec.id} localEval.date must be YYYY-MM-DD (got "${ev.date}")`,
      );
    }
  }
  if (spec.vision !== undefined && typeof spec.vision !== "boolean") {
    throw new Error(`ModelCatalog: ${spec.id} vision must be a boolean`);
  }
  if (spec.vision === true && spec.type === "llm" && spec.modalities && !spec.modalities.includes("image")) {
    throw new Error(`ModelCatalog: ${spec.id} vision is true but modalities omit image`);
  }
  if (spec.visualTokenBudget !== undefined) {
    const b = spec.visualTokenBudget;
    for (const key of ["maxImages", "maxPixels", "maxVideoFrames", "maxVideoSeconds"] as const) {
      const n = b[key];
      if (n !== undefined && (!Number.isFinite(n) || n <= 0)) {
        throw new Error(`ModelCatalog: ${spec.id} visualTokenBudget.${key} must be a positive number`);
      }
    }
  }
}

const LOCAL_EVAL_PROMOTABLE: ReadonlySet<LocalEvalStatus> = new Set(["pass"]);

/**
 * v2.1.0 Phase 1 -- fill omitted capability flags so loaders accept both
 * schema versions. `diffusion` defaults false; `codingEligible` defaults true.
 */
export function normalizeSpec(spec: ModelSpec): ModelSpec {
  const vision =
    spec.vision ?? (spec.type === "llm" && Boolean(spec.modalities?.includes("image")));
  return {
    ...spec,
    diffusion: spec.diffusion ?? false,
    codingEligible: spec.codingEligible ?? true,
    vision,
  };
}

/** True when a local eval block is complete enough to consider a default-route change. */
export function localEvalMayPromote(spec: Pick<ModelSpec, "localEval">): boolean {
  return spec.localEval !== undefined && LOCAL_EVAL_PROMOTABLE.has(spec.localEval.status);
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
  return {
    ...parsed,
    models: parsed.models.map(normalizeSpec),
  };
}

export function findSpec(catalog: CatalogFile, id: string): ModelSpec | undefined {
  return catalog.models.find((m) => m.id === id);
}

export function getSpec(catalog: CatalogFile, id: string): ModelSpec {
  const spec = findSpec(catalog, id);
  if (!spec) throw new Error(`ModelCatalog: unknown id ${id}`);
  return spec;
}
