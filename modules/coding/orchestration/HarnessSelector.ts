// ---------------------------------------------------------------------------
// v1.12.0 Phase 1 (adoption-ecosystem-2026-07 H1) -- the per-model harness
// selector.
//
// Reverse-engineered from the Open Interpreter / Codex-fork thesis ("get the
// best agentic performance out of low-cost models") into a lean, local-only
// module: map each installed local model to a capability tier and pick the
// prompt/tool "scaffold profile" tuned for that tier, so the small / quantized
// models the single-GPU ceiling forces are driven as well as they can be. No
// Open Interpreter code is imported (reverse-engineer-first, per the AGENTS.md
// MCP Registry Policy). Selection is DATA (named profiles keyed by tier), not a
// forked agent code path, so it is auditable and reversible.
//
// The profile surfaces only knobs the existing PromptBuilder / PromptContext
// already consume (promptStyle, thinkingMode, systemPromptBudgetPercent),
// emitted as a decoupled overlay (`toPromptOverlay`) the composition root can
// spread into a PromptContext without this module importing the chat subtree.
// Deeper scaffold knobs (tool-exposure verbosity, retry / step granularity) and
// the composition-root wiring (ToolActivationContext.buildPromptContext) are
// recorded as forward-tier follow-ups; this phase ships the selector + its
// golden A/B ([HarnessSelectorAb.ts]) and leaves it opt-in (off) until a live
// weak-model A/B shows a net win -- the SO003.P3.A discipline.
//
// The profile values below are heuristic defaults (not yet locally measured);
// they parameterize existing knobs conservatively and are the baseline the A/B
// validates. Pairs with the Nexus-Hub `model-routing` skill and the
// docs/reference/low-cost-model-optimization.md guidance (H2): it consumes a
// capability tier, it does not duplicate routing.
//
// Boundary: vscode-free; pure (catalog + tier).
// ---------------------------------------------------------------------------

import { ModelCatalog, type LlmCatalogEntry } from "../../../core/registry/ModelCatalog.js";

/** Model capability tier, derived from catalog size / tag signals. */
export type CapabilityTier = "weak" | "mid" | "strong";

/** The scaffold-profile prompt-style vocabulary (mirrors PromptContext.promptStyle). */
export type HarnessPromptStyle = "concise" | "detailed" | "beginner";

/** A named scaffold profile: the prompt/tool shaping tuned for a capability tier. */
export interface HarnessProfile {
  readonly tier: CapabilityTier;
  readonly label: string;
  readonly promptStyle: HarnessPromptStyle;
  readonly thinkingMode: boolean;
  readonly systemPromptBudgetPercent: number;
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
}

// A model at or above this VRAM footprint (or tagged "advanced") is treated as
// strong; at or below the weak threshold (or tagged "lightweight") as weak.
const STRONG_VRAM_GB = 20;
const WEAK_VRAM_GB = 4;

/**
 * Derive a capability tier from a catalog entry's size / tag signals. There is
 * no first-class capability field on `LlmCatalogEntry`, so this reads `tags`
 * ("advanced" / "lightweight") first and falls back to a `vramGb` threshold.
 * An entry with no size signal at all resolves to `mid` (the safe middle).
 */
export function modelCapabilityTier(
  entry: Pick<LlmCatalogEntry, "vramGb" | "tags">,
): CapabilityTier {
  const tags = entry.tags ?? [];
  const vram = entry.vramGb;
  if (tags.includes("advanced") || (typeof vram === "number" && vram >= STRONG_VRAM_GB)) {
    return "strong";
  }
  if (tags.includes("lightweight") || (typeof vram === "number" && vram <= WEAK_VRAM_GB)) {
    return "weak";
  }
  return "mid";
}

const PROFILES: Readonly<Record<CapabilityTier, HarnessProfile>> = Object.freeze({
  weak: Object.freeze({
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
    tier: "mid",
    label: "balanced-scaffold",
    promptStyle: "concise",
    thinkingMode: true,
    systemPromptBudgetPercent: 12,
    rationale:
      "mid-capability model: concise scaffold with thinking on and a moderate guidance budget",
  }),
  strong: Object.freeze({
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
 * The profile used for any model that cannot be resolved to a catalog entry --
 * the conservative middle, preserving current behavior for unprofiled models.
 */
export const DEFAULT_HARNESS_PROFILE: HarnessProfile = PROFILES.mid;

/** The scaffold profile for a capability tier. */
export function harnessProfileForTier(tier: CapabilityTier): HarnessProfile {
  return PROFILES[tier];
}

/** Project a profile down to the `PromptContext` overlay the composition root spreads. */
export function toPromptOverlay(profile: HarnessProfile): HarnessPromptOverlay {
  return {
    promptStyle: profile.promptStyle,
    thinkingMode: profile.thinkingMode,
    systemPromptBudgetPercent: profile.systemPromptBudgetPercent,
  };
}

/** Resolves a model name/id to a catalog entry (injected so tests stay pure). */
export type CatalogLookup = (
  modelName: string,
) => Pick<LlmCatalogEntry, "id" | "vramGb" | "tags"> | undefined;

const defaultCatalogLookup: CatalogLookup = (modelName) => ModelCatalog.byId(modelName);

/**
 * Picks the scaffold profile for a model. Thin, stateful wrapper over the pure
 * `modelCapabilityTier` + `harnessProfileForTier` (the PanelRouter shape): a
 * catalog lookup is injected so tests need no real catalog, and any model that
 * does not resolve falls back to {@link DEFAULT_HARNESS_PROFILE} (fail-safe --
 * an unprofiled model is never worse off than today's one-size scaffold).
 */
export class HarnessSelector {
  private readonly _lookup: CatalogLookup;

  constructor(lookup: CatalogLookup = defaultCatalogLookup) {
    this._lookup = lookup;
  }

  /** The scaffold profile for a model by name/id; default profile for any unprofiled model. */
  profileForModel(modelName: string): HarnessProfile {
    const entry = this._lookup(modelName);
    if (!entry) return DEFAULT_HARNESS_PROFILE;
    return harnessProfileForTier(modelCapabilityTier(entry));
  }

  /** The `PromptContext` overlay for a model (the profile, projected). */
  overlayForModel(modelName: string): HarnessPromptOverlay {
    return toPromptOverlay(this.profileForModel(modelName));
  }
}

/** Shared selector backed by the real `ModelCatalog`. */
export const defaultHarnessSelector = new HarnessSelector();
