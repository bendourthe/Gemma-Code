// ---------------------------------------------------------------------------
// v1.12.0 Phase 1 (adoption-ecosystem-2026-07 H1) -- the per-model harness
// selector. v1.18.0 Phase 2 (OI-A5 / OI-A2) wires the overlay into the live
// prompt path and adds named per-family profiles as data.
//
// Reverse-engineered from the Open Interpreter / Codex-fork thesis ("get the
// best agentic performance out of low-cost models") into a lean, local-only
// module: map each installed local model to a capability tier and pick the
// prompt/tool "scaffold profile" tuned for that tier (and, from v1.18, for
// catalog family). No external harness code is imported (reverse-engineer-first,
// per the AGENTS.md MCP Registry Policy). Selection is DATA (named profiles
// keyed by family/tier), not a forked agent code path, so it is auditable and
// reversible. Profile ids and rationales use generic Nexus names only.
//
// The profile surfaces only knobs the existing PromptBuilder / PromptContext
// already consume (promptStyle, thinkingMode, systemPromptBudgetPercent),
// emitted as a decoupled overlay (`toPromptOverlay`) the composition root
// spreads into a PromptContext without this module importing the chat subtree.
// Deeper scaffold knobs (tool-exposure verbosity, retry / step granularity)
// remain a forward-tier follow-up (EM.P1.C remainder).
//
// The profile values below are heuristic defaults (not yet locally measured);
// they parameterize existing knobs conservatively and are the baseline the A/B
// validates. Pairs with the Nexus-Hub `model-routing` skill and the
// docs/reference/low-cost-model-optimization.md guidance (H2): it consumes a
// capability tier, it does not duplicate routing.
//
// Boundary: vscode-free; pure (catalog + tier + named profiles).
// ---------------------------------------------------------------------------

import { ModelCatalog, type LlmCatalogEntry, type ToolFormatName } from "../../../core/registry/ModelCatalog.js";
import { isMoeResident } from "../../../core/registry/moeFootprint.js";

/** Model capability tier, derived from catalog size / tag signals. */
export type CapabilityTier = "weak" | "mid" | "strong";

/** Stable ids for named scaffold profiles (session switch + inspect). */
export type HarnessProfileId =
  | "constrained-scaffold"
  | "balanced-scaffold"
  | "lean-scaffold"
  | "concise-loop"
  | "plan-first"
  | "structured-edit"
  | "minimal"
  | "lfm-agentic"
  | "hermes-agentic"
  | "muse-glimmer"
  | "lightning-worker";

/** The scaffold-profile prompt-style vocabulary (mirrors PromptContext.promptStyle). */
export type HarnessPromptStyle = "concise" | "detailed" | "beginner";

export type ReasoningStrength = "low" | "medium" | "high";

/** A named scaffold profile: the prompt/tool shaping tuned for a capability tier. */
export interface HarnessProfile {
  readonly id: HarnessProfileId;
  readonly tier: CapabilityTier;
  readonly label: string;
  readonly promptStyle: HarnessPromptStyle;
  readonly thinkingMode: boolean;
  readonly systemPromptBudgetPercent: number;
  /**
   * v1.19.0 Phase 2 -- optional native tool-call grammar for this profile.
   * Omitted on tier defaults so the overlay stays the three PromptContext knobs.
   */
  readonly toolCallFormat?: ToolFormatName;
  /**
   * v1.19.1 Phase 2.4 -- optional per-model compaction knobs. Omitted on
   * existing profiles so they keep HardwareTier defaults via
   * {@link toCompressionOverlay}.
   */
  readonly compactionThreshold?: number;
  readonly userMessageTail?: number;
  /**
   * v2.1.0 Phase 1 -- optional reasoning-strength session option (Muse Glimmer).
   * Dropped at runtime when the served model rejects it; see
   * {@link applyReasoningStrength}.
   */
  readonly reasoningStrength?: ReasoningStrength;
  readonly rationale: string;
}

/**
 * The subset of `PromptContext` keys a profile drives. The composition root
 * spreads this over a base `PromptContext` (`{ ...base, ...overlay }`); the keys
 * and value types are chosen to match `PromptContext` exactly so that spread
 * typechecks without this module importing the chat subtree (avoids a cycle).
 */
export interface HarnessPromptOverlay {
  readonly promptStyle: HarnessPromptStyle;
  readonly thinkingMode: boolean;
  readonly systemPromptBudgetPercent: number;
  /** Present only on profiles that pin a native tool-call grammar (LFM). */
  readonly toolCallFormat?: ToolFormatName;
}

/** Why a profile was chosen for the current model (shown by `/harness` inspect). */
export type HarnessSelectionReason = "override" | "family" | "tier" | "default";

/** Inspectable selection result: profile plus the catalog signals that keyed it. */
export interface HarnessSelection {
  readonly profile: HarnessProfile;
  readonly overlay: HarnessPromptOverlay;
  readonly modelName: string;
  readonly modelTier: CapabilityTier;
  readonly family: string | undefined;
  readonly tags: readonly string[];
  readonly reason: HarnessSelectionReason;
  readonly overrideId: HarnessProfileId | undefined;
  /**
   * v1.18.0 Phase 3 (LG-A3) -- `moe` when totalParams exceeds activeParams so
   * callers can flag resident footprint separately from compute tier.
   */
  readonly residentFootprint: "standard" | "moe";
}

// A model at or above this VRAM footprint (or tagged "advanced") is treated as
// strong; at or below the weak threshold (or tagged "lightweight") as weak.
const STRONG_VRAM_GB = 20;
const WEAK_VRAM_GB = 4;
/** v1.18.0 Phase 3 (LG-A3) -- active-parameter thresholds in billions, aligned with the VRAM cutovers. */
const STRONG_ACTIVE_PARAMS = 20;
const WEAK_ACTIVE_PARAMS = 4;

/**
 * Derive a capability tier from a catalog entry's size / tag signals. There is
 * no first-class capability field on `LlmCatalogEntry`, so this reads `tags`
 * ("advanced" / "lightweight") first, then MoE `activeParams` when present,
 * then a `vramGb` threshold. An entry with no size signal at all resolves to
 * `mid` (the safe middle). Dense entries (no MoE fields) keep the pre-v1.18
 * tag-then-vram path exactly.
 */
export function modelCapabilityTier(
  entry: Pick<LlmCatalogEntry, "vramGb" | "tags" | "activeParams" | "totalParams">,
): CapabilityTier {
  const tags = entry.tags ?? [];
  if (typeof entry.activeParams === "number") {
    if (tags.includes("advanced")) return "strong";
    if (tags.includes("lightweight")) return "weak";
    if (entry.activeParams >= STRONG_ACTIVE_PARAMS) return "strong";
    if (entry.activeParams <= WEAK_ACTIVE_PARAMS) return "weak";
    return "mid";
  }
  const vram = entry.vramGb;
  if (tags.includes("advanced") || (typeof vram === "number" && vram >= STRONG_VRAM_GB)) {
    return "strong";
  }
  if (tags.includes("lightweight") || (typeof vram === "number" && vram <= WEAK_VRAM_GB)) {
    return "weak";
  }
  return "mid";
}

const TIER_PROFILES: Readonly<Record<CapabilityTier, HarnessProfile>> = Object.freeze({
  weak: Object.freeze({
    id: "constrained-scaffold",
    tier: "weak",
    label: "constrained-scaffold",
    promptStyle: "detailed",
    thinkingMode: true,
    systemPromptBudgetPercent: 18,
    rationale:
      "small / quantized model: explicit step-by-step guidance, scratchpad thinking on, " +
      "and a larger system-prompt budget to compensate for weaker instruction-following",
  }),
  mid: Object.freeze({
    id: "balanced-scaffold",
    tier: "mid",
    label: "balanced-scaffold",
    promptStyle: "concise",
    thinkingMode: true,
    systemPromptBudgetPercent: 12,
    rationale:
      "mid-capability model: concise scaffold with thinking on and a moderate guidance budget",
  }),
  strong: Object.freeze({
    id: "lean-scaffold",
    tier: "strong",
    label: "lean-scaffold",
    promptStyle: "concise",
    thinkingMode: false,
    systemPromptBudgetPercent: 8,
    rationale:
      "capable model: terse scaffold, minimal hand-holding, thinking off by default, " +
      "smaller guidance budget to leave room for context",
  }),
});

/**
 * Named family profiles (v1.18.0 Phase 2 OI-A2). Data only: keyed by catalog
 * family / tier, never by vendor harness names. Knobs stay the three
 * PromptContext fields the composition root already spreads.
 */
const NAMED_PROFILES: Readonly<Record<HarnessProfileId, HarnessProfile>> = Object.freeze({
  "constrained-scaffold": TIER_PROFILES.weak,
  "balanced-scaffold": TIER_PROFILES.mid,
  "lean-scaffold": TIER_PROFILES.strong,
  "concise-loop": Object.freeze({
    id: "concise-loop",
    tier: "mid",
    label: "concise-loop",
    promptStyle: "concise",
    thinkingMode: true,
    systemPromptBudgetPercent: 10,
    rationale:
      "tight tool-calling loop: short prompts, thinking on for tool choice, modest guidance budget",
  }),
  "plan-first": Object.freeze({
    id: "plan-first",
    tier: "mid",
    label: "plan-first",
    promptStyle: "detailed",
    thinkingMode: true,
    systemPromptBudgetPercent: 16,
    rationale:
      "plan then act: extra guidance so the model writes a short plan before edits",
  }),
  "structured-edit": Object.freeze({
    id: "structured-edit",
    tier: "mid",
    label: "structured-edit",
    promptStyle: "concise",
    thinkingMode: false,
    systemPromptBudgetPercent: 8,
    rationale:
      "structured edit loop: terse diffs, thinking off, small guidance budget",
  }),
  minimal: Object.freeze({
    id: "minimal",
    tier: "weak",
    label: "minimal",
    promptStyle: "concise",
    thinkingMode: false,
    systemPromptBudgetPercent: 6,
    rationale:
      "smallest overlay: concise prompts, thinking off, tiny guidance budget for the weakest models",
  }),
  "lfm-agentic": Object.freeze({
    id: "lfm-agentic",
    tier: "weak",
    label: "lfm-agentic",
    promptStyle: "concise",
    thinkingMode: true,
    systemPromptBudgetPercent: 12,
    toolCallFormat: "lfm-pythonic" as ToolFormatName,
    rationale:
      "LFM2.5 agentic loop: concise ChatML scaffold, thinking on, parse pythonic " +
      "tool calls between tool_call_start / tool_call_end tokens",
  }),
  "hermes-agentic": Object.freeze({
    id: "hermes-agentic",
    tier: "mid",
    label: "hermes-agentic",
    promptStyle: "concise",
    thinkingMode: true,
    systemPromptBudgetPercent: 10,
    toolCallFormat: "llama3-json" as ToolFormatName,
    compactionThreshold: 0.8,
    userMessageTail: 3,
    rationale:
      "Hermes 3 agentic loop: concise Llama-3 tool JSON, thinking on for tool choice, " +
      "mid-tier compaction (0.8 threshold, keep last 3 user messages)",
  }),
  "muse-glimmer": Object.freeze({
    id: "muse-glimmer",
    tier: "strong",
    label: "muse-glimmer",
    promptStyle: "detailed",
    thinkingMode: true,
    systemPromptBudgetPercent: 14,
    toolCallFormat: "llama3-json" as ToolFormatName,
    compactionThreshold: 0.85,
    userMessageTail: 5,
    reasoningStrength: "medium" as ReasoningStrength,
    rationale:
      "Muse Glimmer long-horizon loop: detailed plan-then-act scaffold, thinking on, " +
      "medium reasoning-strength (session-overridable), Llama-3 tool JSON",
  }),
  "lightning-worker": Object.freeze({
    id: "lightning-worker",
    tier: "weak",
    label: "lightning-worker",
    promptStyle: "concise",
    thinkingMode: false,
    systemPromptBudgetPercent: 8,
    toolCallFormat: "qwen-json" as ToolFormatName,
    compactionThreshold: 0.8,
    userMessageTail: 3,
    rationale:
      "Nemotron Lightning routine-step worker: terse Qwen3-Coder tool calls, thinking off, " +
      "small guidance budget so the strong model keeps the planner/critic roles",
  }),
});

/**
 * Catalog family -> named profile (applies at every tier). Keys are
 * `LlmCatalogEntry.family` values plus a `kimi` alias resolved from id/tags
 * when a catalog row is not yet present.
 */
const FAMILY_PROFILE_IDS: Readonly<Record<string, HarnessProfileId>> = Object.freeze({
  qwen: "plan-first",
  "gpt-oss": "plan-first",
  deepseek: "structured-edit",
  kimi: "concise-loop",
  "lfm2.5": "lfm-agentic",
  hermes: "hermes-agentic",
  "muse-glimmer": "muse-glimmer",
  "nemotron-lightning": "lightning-worker",
});

/** Family + tier -> named profile, taking precedence over FAMILY_PROFILE_IDS. */
const FAMILY_TIER_PROFILE_IDS: Readonly<
  Record<string, Partial<Record<CapabilityTier, HarnessProfileId>>>
> = Object.freeze({
  llama: Object.freeze({ weak: "minimal" }),
});

const PROFILE_ID_SET = new Set<string>(Object.keys(NAMED_PROFILES));

/**
 * The profile used for any model that cannot be resolved to a catalog entry --
 * the conservative middle, preserving current behavior for unprofiled models.
 */
export const DEFAULT_HARNESS_PROFILE: HarnessProfile = TIER_PROFILES.mid;

/** The scaffold profile for a capability tier. */
export function harnessProfileForTier(tier: CapabilityTier): HarnessProfile {
  return TIER_PROFILES[tier];
}

/** Every named profile (tier + family), for `/harness list`. */
export function listHarnessProfiles(): readonly HarnessProfile[] {
  return Object.freeze(Object.values(NAMED_PROFILES));
}

/** Look up a named profile by id; undefined when the id is unknown. */
export function harnessProfileById(id: string): HarnessProfile | undefined {
  const parsed = parseHarnessProfileId(id);
  return parsed ? NAMED_PROFILES[parsed] : undefined;
}

/** Parse a `/harness` profile token (case-insensitive exact id). */
export function parseHarnessProfileId(raw: string): HarnessProfileId | undefined {
  const id = raw.trim().toLowerCase();
  if (PROFILE_ID_SET.has(id)) return id as HarnessProfileId;
  return undefined;
}

/** Project a profile down to the `PromptContext` overlay the composition root spreads. */
export interface HarnessCompressionOverlay {
  readonly compactionThreshold: number;
  readonly userMessageTail: number;
}

const COMPRESSION_BY_TIER: Readonly<Record<CapabilityTier, HarnessCompressionOverlay>> = {
  weak: { compactionThreshold: 0.7, userMessageTail: 3 },
  mid: { compactionThreshold: 0.8, userMessageTail: 3 },
  strong: { compactionThreshold: 0.85, userMessageTail: 5 },
};

/** Resolve per-model compression knobs from a harness profile. */
export function toCompressionOverlay(profile: HarnessProfile): HarnessCompressionOverlay {
  const fallback = COMPRESSION_BY_TIER[profile.tier];
  return {
    compactionThreshold: profile.compactionThreshold ?? fallback.compactionThreshold,
    userMessageTail: profile.userMessageTail ?? fallback.userMessageTail,
  };
}

export function toPromptOverlay(profile: HarnessProfile): HarnessPromptOverlay {
  return {
    promptStyle: profile.promptStyle,
    thinkingMode: profile.thinkingMode,
    systemPromptBudgetPercent: profile.systemPromptBudgetPercent,
    ...(profile.toolCallFormat ? { toolCallFormat: profile.toolCallFormat } : {}),
  };
}

/** Runtime options the LLM client may send (not PromptContext knobs). */
export interface HarnessRuntimeOptions {
  readonly reasoningStrength?: ReasoningStrength;
}

/** Project a profile to runtime options. Empty when the profile has none. */
export function toRuntimeOptions(profile: HarnessProfile): HarnessRuntimeOptions {
  return profile.reasoningStrength ? { reasoningStrength: profile.reasoningStrength } : {};
}

export interface ReasoningStrengthDowngrade {
  readonly modelName: string;
  readonly requested: ReasoningStrength;
  readonly applied: ReasoningStrength | null;
  readonly reason: string;
  readonly at: number;
}

const _downgrades: ReasoningStrengthDowngrade[] = [];

/** Record a reasoning-strength drop when the served model rejects the parameter. */
export function applyReasoningStrength(input: {
  readonly modelName: string;
  readonly requested: ReasoningStrength;
  readonly accepted: boolean;
  readonly now?: () => number;
}): HarnessRuntimeOptions {
  if (input.accepted) {
    return { reasoningStrength: input.requested };
  }
  const record: ReasoningStrengthDowngrade = {
    modelName: input.modelName,
    requested: input.requested,
    applied: null,
    reason: "served model rejected reasoning-strength; parameter dropped",
    at: (input.now ?? Date.now)(),
  };
  _downgrades.push(record);
  return {};
}

/** Newest-first reasoning-strength downgrades (tests + InferenceMetrics consumers). */
export function reasoningStrengthDowngrades(): readonly ReasoningStrengthDowngrade[] {
  return [..._downgrades].reverse();
}

/** Test helper: wipe the in-memory downgrade log. */
export function clearReasoningStrengthDowngrades(): void {
  _downgrades.length = 0;
}

/**
 * Apply a harness overlay to prompt knobs. When `enabled` is false the `base`
 * object is returned by reference (byte-identical to today's path). When true,
 * overlay keys overwrite the matching fields.
 *
 * `base` is a Partial overlay so a live `PromptContext` (optional
 * `systemPromptBudgetPercent`) typechecks without a cast.
 */
export function applyHarnessOverlay<T extends Partial<HarnessPromptOverlay>>(
  enabled: boolean,
  base: T,
  overlay: HarnessPromptOverlay,
): T {
  if (!enabled) return base;
  return { ...base, ...overlay };
}

/** Resolves a model name/id to a catalog entry (injected so tests stay pure). */
export type CatalogLookup = (
  modelName: string,
) =>
  | (Pick<LlmCatalogEntry, "id" | "vramGb" | "tags" | "activeParams" | "totalParams"> & {
      readonly family?: string;
    })
  | undefined;

const defaultCatalogLookup: CatalogLookup = (modelName) => ModelCatalog.byId(modelName);

function resolveFamilyKey(
  entry: Pick<LlmCatalogEntry, "id" | "tags"> & { readonly family?: string },
): string | undefined {
  if (entry.family && entry.family.length > 0) return entry.family;
  const id = entry.id.toLowerCase();
  if (id.includes("kimi")) return "kimi";
  if (id.includes("lfm2.5") || id.startsWith("lfm2")) return "lfm2.5";
  if (id.includes("hermes")) return "hermes";
  if (id.includes("muse") || id.includes("glimmer")) return "muse-glimmer";
  if (id.includes("nemotron") || id.includes("lightning")) return "nemotron-lightning";
  if (id.includes("gpt-oss")) return "gpt-oss";
  const tags = entry.tags ?? [];
  if (tags.some((t) => t.toLowerCase().includes("kimi"))) return "kimi";
  if (tags.some((t) => t.toLowerCase().includes("lfm"))) return "lfm2.5";
  if (tags.some((t) => t.toLowerCase().includes("hermes"))) return "hermes";
  if (tags.some((t) => t.toLowerCase().includes("muse") || t.toLowerCase().includes("glimmer"))) {
    return "muse-glimmer";
  }
  if (tags.some((t) => t.toLowerCase().includes("lightning") || t.toLowerCase().includes("nemotron"))) {
    return "nemotron-lightning";
  }
  return undefined;
}

function namedIdFor(
  family: string | undefined,
  tier: CapabilityTier,
): HarnessProfileId | undefined {
  if (!family) return undefined;
  const byTier = FAMILY_TIER_PROFILE_IDS[family]?.[tier];
  if (byTier) return byTier;
  return FAMILY_PROFILE_IDS[family];
}

function withModelTier(profile: HarnessProfile, tier: CapabilityTier): HarnessProfile {
  if (profile.tier === tier) return profile;
  return { ...profile, tier };
}

export type HarnessCommand =
  | { readonly kind: "inspect" }
  | { readonly kind: "list" }
  | { readonly kind: "clear" }
  | { readonly kind: "switch"; readonly profileId: HarnessProfileId }
  | { readonly kind: "unknown"; readonly raw: string };

/**
 * Parse `/harness` arguments. Empty / status / inspect -> inspect; list ->
 * list; clear / reset / auto / default -> clear; switch <id> / use <id> / <id>
 * -> switch when the id is a known profile.
 */
export function parseHarnessCommand(args: string): HarnessCommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) return { kind: "inspect" };
  const tokens = trimmed.split(/\s+/);
  const head = (tokens[0] ?? "").toLowerCase();
  if (head === "status" || head === "inspect" || head === "why") {
    return { kind: "inspect" };
  }
  if (head === "list") return { kind: "list" };
  if (head === "clear" || head === "reset" || head === "auto" || head === "default") {
    return { kind: "clear" };
  }
  const idToken =
    head === "switch" || head === "use" ? (tokens[1] ?? "") : trimmed;
  const profileId = parseHarnessProfileId(idToken);
  if (profileId) return { kind: "switch", profileId };
  return { kind: "unknown", raw: trimmed };
}

/**
 * Session-scoped manual profile override. Bound to the model that was active
 * when it was set; a model change or `clear()` drops it. The composition root
 * still refuses to apply any overlay when `harnessSelectorEnabled` is off.
 */
export class HarnessSessionOverride {
  private _profileId: HarnessProfileId | null = null;
  private _boundModel: string | null = null;

  set(profileId: HarnessProfileId, modelName: string): void {
    this._profileId = profileId;
    this._boundModel = modelName;
  }

  clear(): void {
    this._profileId = null;
    this._boundModel = null;
  }

  /**
   * Active override for `currentModel`, or null. A bound-model mismatch
   * clears the override (revert on model change).
   */
  peek(currentModel: string): HarnessProfileId | null {
    if (this._profileId === null) return null;
    if (this._boundModel !== currentModel) {
      this.clear();
      return null;
    }
    return this._profileId;
  }
}

/**
 * Picks the scaffold profile for a model. Thin, stateful wrapper over the pure
 * `modelCapabilityTier` + named-profile tables (the PanelRouter shape): a
 * catalog lookup is injected so tests need no real catalog, and any model that
 * does not resolve falls back to {@link DEFAULT_HARNESS_PROFILE} (fail-safe --
 * an unprofiled model is never worse off than today's one-size scaffold).
 */
export class HarnessSelector {
  private readonly _lookup: CatalogLookup;

  constructor(lookup: CatalogLookup = defaultCatalogLookup) {
    this._lookup = lookup;
  }

  /**
   * Full selection for inspect/switch: override (when provided and known) then
   * family/tier named profile then tier profile then default. Never throws.
   */
  select(modelName: string, overrideId?: HarnessProfileId | null): HarnessSelection {
    const entry = this._lookup(modelName);
    if (!entry) {
      const override = overrideId ? NAMED_PROFILES[overrideId] : undefined;
      const profile = override ?? DEFAULT_HARNESS_PROFILE;
      return {
        profile,
        overlay: toPromptOverlay(profile),
        modelName,
        modelTier: profile.tier,
        family: undefined,
        tags: [],
        reason: override ? "override" : "default",
        overrideId: override ? overrideId ?? undefined : undefined,
        residentFootprint: "standard",
      };
    }

    const modelTier = modelCapabilityTier(entry);
    const family = resolveFamilyKey(entry);
    const tags = entry.tags ?? [];
    const residentFootprint: "standard" | "moe" = isMoeResident(entry) ? "moe" : "standard";

    if (overrideId && NAMED_PROFILES[overrideId]) {
      const profile = withModelTier(NAMED_PROFILES[overrideId], modelTier);
      return {
        profile,
        overlay: toPromptOverlay(profile),
        modelName,
        modelTier,
        family,
        tags,
        reason: "override",
        overrideId,
        residentFootprint,
      };
    }

    const namedId = namedIdFor(family, modelTier);
    if (namedId) {
      const profile = withModelTier(NAMED_PROFILES[namedId], modelTier);
      return {
        profile,
        overlay: toPromptOverlay(profile),
        modelName,
        modelTier,
        family,
        tags,
        reason: "family",
        overrideId: undefined,
        residentFootprint,
      };
    }

    const profile = TIER_PROFILES[modelTier];
    return {
      profile,
      overlay: toPromptOverlay(profile),
      modelName,
      modelTier,
      family,
      tags,
      reason: "tier",
      overrideId: undefined,
      residentFootprint,
    };
  }

  /** The scaffold profile for a model by name/id; default profile for any unprofiled model. */
  profileForModel(modelName: string): HarnessProfile {
    return this.select(modelName).profile;
  }

  /** The `PromptContext` overlay for a model (the profile, projected). */
  overlayForModel(modelName: string): HarnessPromptOverlay {
    return this.select(modelName).overlay;
  }
}

/** Shared selector backed by the real `ModelCatalog`. */
export const defaultHarnessSelector = new HarnessSelector();
