/**
 * v2.2.9 Phase 5 (T010) -- the shared Models card grammar (React side).
 *
 * One name-row pill set in a locked order: Company, Country, Agentic,
 * Context window, Multimodal, Guardrails, License, Released. The derivation
 * is dual-asserted against the installer's
 * `nexus_installer.pages.typed_catalog.derive_fact_pills` via
 * tests/fixtures/v2.2.9-model-pills.json (WN-7 discipline). A pill whose
 * source value is missing is omitted -- never "Unknown", never an invented
 * "Community".
 */

import type { ListedModelDto } from "../../pages/settings/modelsTypes";

/**
 * Catalog `family` -> publisher. Mirror of installer
 * `nexus_installer.constants.FAMILY_TO_PUBLISHER`; keep the two in sync.
 * Families mapped to "Community" (and unmapped families) render no Company
 * pill -- Community is a color-legend fallback, not a company.
 */
export const FAMILY_TO_PUBLISHER: Readonly<Record<string, string>> = {
  gemma4: "Google",
  llama: "Meta",
  musicgen: "Meta",
  qwen: "Alibaba",
  "qwen3.5": "Alibaba",
  "qwen3-coder": "Alibaba",
  "qwen3-embedding": "Alibaba",
  wan: "Alibaba",
  deepseek: "DeepSeek",
  nomic: "Nomic AI",
  sdxl: "Stability AI",
  sd1: "Stability AI",
  svd: "Stability AI",
  "stable-audio": "Stability AI",
  flux: "Black Forest Labs",
  sana: "NVIDIA",
  ltx: "Lightricks",
  whisper: "OpenAI",
  "gpt-oss": "OpenAI",
  embeddinggemma: "Google",
  kokoro: "Community",
  piper: "Community",
  "lfm2.5": "Liquid AI",
  hermes: "Nous Research",
  inkling: "Thinking Machines",
  "muse-glimmer": "Meta",
  "nemotron-lightning": "NVIDIA",
};

const RELEASE_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type PillSource = Pick<
  ListedModelDto,
  | "family"
  | "origin"
  | "task"
  | "type"
  | "agentic"
  | "contextWindow"
  | "contextWindowIn"
  | "contextWindowOut"
  | "modalities"
  | "vision"
  | "uncensored"
  | "license"
  | "releaseDate"
>;

/** `Released: May 2026` from ISO `YYYY-MM[-DD]` (en-US month names, ASCII). */
export function formatReleasedPill(
  releaseDate: string | undefined,
): string | null {
  const parts = (releaseDate ?? "").trim().split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isInteger(year) || year <= 0) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `Released: ${RELEASE_MONTHS[month - 1]} ${year}`;
}

/** `Context window: 262k tokens` (raw count below 1k); null when absent. */
export function formatContextWindowPill(tokens: number): string | null {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens < 1000) return `Context window: ${Math.floor(tokens)} tokens`;
  return `Context window: ${Math.floor(tokens / 1000)}k tokens`;
}

/** Yes when modalities go beyond text or vision is true; null when unsignaled. */
export function multimodalPillValue(
  modalities: readonly string[] | undefined,
  vision: boolean | undefined,
): boolean | null {
  const list = modalities ?? [];
  if (list.length === 0 && vision === undefined) return null;
  if (vision === true) return true;
  return list.some((m) => m !== "text");
}

function positive(value: number | null | undefined): number {
  return typeof value === "number" && value > 0 ? value : 0;
}

/** The ordered name-row pills for one catalog row (locked v2.2.9 grammar). */
export function buildModelPills(model: PillSource): string[] {
  const pills: string[] = [];
  const publisher = model.family
    ? FAMILY_TO_PUBLISHER[model.family]
    : undefined;
  if (publisher && publisher !== "Community")
    pills.push(`Company: ${publisher}`);
  if (model.origin) pills.push(`Country: ${model.origin}`);
  if (
    model.task === "chat" ||
    model.task === "agentic" ||
    model.type === "llm"
  ) {
    pills.push(`Agentic: ${model.agentic ? "Yes" : "No"}`);
  }
  const tokens =
    positive(model.contextWindowIn) ||
    positive(model.contextWindow) ||
    positive(model.contextWindowOut);
  const contextPill = formatContextWindowPill(tokens);
  if (contextPill) pills.push(contextPill);
  const multimodal = multimodalPillValue(model.modalities, model.vision);
  if (multimodal !== null)
    pills.push(`Multimodal: ${multimodal ? "Yes" : "No"}`);
  if (model.uncensored === true) pills.push("Guardrails: Uncensored");
  else if (model.uncensored === false) pills.push("Guardrails: Censored");
  if (model.license) pills.push(`License: ${model.license}`);
  const released = formatReleasedPill(model.releaseDate);
  if (released) pills.push(released);
  return pills;
}

/**
 * v2.4.4 Phase 6.3 (T025) -- split one pill into its label and value.
 *
 * Details rendered each pill as one flat run of text, so `Company: Google`
 * read as a single grey blob and the facts were hard to scan. Splitting here
 * (rather than in the component) keeps the v2.2.9 pill grammar as the single
 * source of what a pill says; the component only decides how the two halves
 * are styled. A pill with no separator is all value, which keeps standalone
 * pills like a bare released-date rendering correctly.
 */
export interface SplitPill {
  readonly label: string | null;
  readonly value: string;
}

export function compactRequirementFacts(
  model: PillSource & {
    sizeBytes?: number;
    vramGB?: number;
    storageLabel?: string | null;
  },
): string[] {
  const parts: string[] = [];
  if (model.storageLabel) parts.push(`Storage (${model.storageLabel})`);
  if (typeof model.vramGB === "number") parts.push(`VRAM (${model.vramGB} GB)`);
  const publisher = model.family
    ? FAMILY_TO_PUBLISHER[model.family]
    : undefined;
  if (publisher && publisher !== "Community")
    parts.push(`Company: ${publisher}`);
  if (model.origin) parts.push(`Country: ${model.origin}`);
  const released = formatReleasedPill(model.releaseDate);
  if (released) parts.push(released);
  return parts;
}

const CAPABILITY_PREFIXES = [
  "Agentic:",
  "Context window:",
  "Multimodal:",
  "Guardrails:",
  "License:",
] as const;

export function compactCapabilityFacts(model: PillSource): string[] {
  return buildModelPills(model).filter((pill) =>
    CAPABILITY_PREFIXES.some((prefix) => pill.startsWith(prefix)),
  );
}

export function splitModelPill(pill: string): SplitPill {
  const at = pill.indexOf(": ");
  if (at < 0) return { label: null, value: pill };
  return { label: pill.slice(0, at + 1), value: pill.slice(at + 2) };
}
