/**
 * v1.0.0 Phase 5.5 -- shared DTOs for the Settings models page.
 *
 * Mirrored from `core/registry/NexusModelRegistry.ts`'s `ListedModel`
 * shape so the desktop UI can render without pulling Node-only modules
 * into the renderer bundle. The sidecar marshals real `ListedModel`s
 * over IPC into the structure declared here.
 */

export type ModelType =
  | "llm"
  | "embed"
  | "image"
  | "video"
  | "audio"
  | "controlnet"
  | "vae"
  /** v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing. */
  | "document";

export interface ListedModelDto {
  id: string;
  displayName: string;
  family?: string;
  tag?: string;
  type?: ModelType;
  installed: boolean;
  source: "registry" | "catalog-only" | "external";
  sizeBytes?: number;
  vramGB?: number;
  license?: string;
  /** v1.19.0 Phase 1 -- catalog task (chat | agentic | ...). */
  task?: string;
  licenseUrl?: string;
  licenseNote?: string;
  tags?: readonly string[];
  absPath?: string;
  /** v1.18.0 Phase 3 (OW-A4) -- catalog tool-calling verification flag. */
  toolCallingVerified?: boolean;
  toolCallingBenchmark?: {
    readonly suite: string;
    readonly date: string;
    readonly result: string;
  };
  activeParams?: number;
  totalParams?: number;
  /** v2.0.0 Phase 1 -- catalog input modalities for Chat gating. */
  modalities?: readonly ("text" | "image" | "audio")[];
  /** v2.1.0 Phase 4 -- chat vision. */
  vision?: boolean;
  visualTokenBudget?: {
    readonly maxImages?: number;
    readonly maxPixels?: number;
    readonly maxVideoFrames?: number;
    readonly maxVideoSeconds?: number;
  };
  /** v2.2.4 Phase 5 -- installer card copy, marshaled from the catalog spec. */
  description?: string;
  strengths?: readonly string[];
  whyRecommended?: string;
  differentiators?: string;
  agentic?: boolean;
  /** v2.2.5 Phase 3 -- installer card chips. */
  origin?: string;
  releaseDate?: string;
  uncensored?: boolean;
  /** True when the installer snapshot listed this id (or an alias). */
  selectedAtInstall?: boolean;
  /**
   * v2.2.7 Phase 1 -- catalog-reported token window. null when omitted or
   * junk. Never a default 128000.
   */
  contextWindow?: number | null;
  contextWindowIn?: number | null;
  contextWindowOut?: number | null;
  /** v2.2.8 Phase 4 -- installer hide-below floor; 0/omit means no floor. */
  hideBelowVramGB?: number;
}

export interface InstallProgressDto {
  id: string;
  bytes: number;
  total: number | null;
}

export interface DiskUsageDto {
  usedBytes: number;
  freeBytes: number | null;
}
