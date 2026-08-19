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
