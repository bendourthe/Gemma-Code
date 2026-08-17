# Low-cost-model optimization (H2)

*v1.12.0 Phase 1 (adoption-ecosystem-2026-07 H2). In-repo guidance the [`HarnessSelector`](../../modules/coding/orchestration/HarnessSelector.ts) references. This is the "skill-native" half of H1: the technique knowledge the scaffold profiles operationalize. Authoring the portable Nexus-Hub `low-cost-model-optimization` skill (or folding it into `model-routing`) is recorded as a demand-gated Hub touchpoint in [../v1/v1.12/known-gaps.md](../v1/v1.12/known-gaps.md) (SO009 precedent: build the runtime in Nexus-AI, keep the reusable method in the Hub).*

## Why this exists

Nexus runs local open-source models under a **single-GPU ceiling**, so in practice the resident model is small and quantized. A weak model driven with a scaffold tuned for a frontier model underperforms not because it lacks capability but because the scaffold assumes instruction-following it does not have. The per-model [`HarnessSelector`](../../modules/coding/orchestration/HarnessSelector.ts) picks a scaffold profile per capability tier; this doc is the rationale behind those profiles and the technique catalog for extending them.

## The techniques (what a weak-model scaffold does differently)

1. **Be explicit, not terse.** Weak models follow step-by-step instructions far better than terse "just do it" prompts. The `weak` profile uses `promptStyle: "detailed"`; the `strong` profile uses `concise` to save context.
2. **Leave the scratchpad on.** Small models benefit disproportionately from thinking/reasoning space before acting. The `weak` and `mid` profiles keep `thinkingMode` on; `strong` defaults it off to save tokens.
3. **Spend more of the budget on guidance.** A weak model needs more of the system-prompt budget on how-to guidance and tool contracts. The `weak` profile raises `systemPromptBudgetPercent`; `strong` lowers it to leave room for actual context.
4. **Narrow the tool surface (forward-tier).** Fewer, well-described tools beat a large tool menu for a weak model. Tool-exposure verbosity per tier is a recorded follow-up (not yet wired into `PromptContext`).
5. **Tighter retry / step granularity (forward-tier).** Smaller steps with explicit verification between them recover better from a weak model's mistakes. Retry discipline per tier is a recorded follow-up.

## Capability tiers

Tiers are derived by [`modelCapabilityTier`](../../modules/coding/orchestration/HarnessSelector.ts) from the model catalog's `vramGb` / `tags` (there is no first-class capability field): `advanced` tag or `vramGb >= 20` -> **strong**; `lightweight` tag or `vramGb <= 4` -> **weak**; otherwise **mid**. Unprofiled models fall back to the `mid` (default) profile, so no model is ever worse off than today's one-size scaffold.

## Named family profiles (v1.18.0 Phase 2)

On top of the three tier scaffolds (`constrained-scaffold`, `balanced-scaffold`, `lean-scaffold`), the selector now keys **named profiles** from catalog family (and, for llama, weak-tier) as data, not code branches:

| Profile | Typical key | Overlay shape |
|---|---|---|
| `concise-loop` | family / id / tags signalling kimi | concise, thinking on, budget 10% |
| `plan-first` | `qwen` family | detailed, thinking on, budget 16% |
| `structured-edit` | `deepseek` family | concise, thinking off, budget 8% |
| `minimal` | `llama` family at weak tier | concise, thinking off, budget 6% |

Unknown families use the tier scaffold. A session `/harness <profile>` override can pick any named profile; it reverts on model change or `/clear`, and it never applies while `nexus.coding.harnessSelector.enabled` is off. The live prompt path is [`ToolActivationContext.buildPromptContext`](../../src/panels/ToolActivationContext.ts).

## Trust the measurement, not the defaults

The per-tier profile values are **heuristic defaults**, not yet locally measured. Whether a selected scaffold actually beats the one-size default for a given weak model is decided by the golden-suite A/B ([`HarnessSelectorAb.ts`](../../modules/coding/orchestration/HarnessSelectorAb.ts), `decideHarnessDefault`), which is why the feature ships **opt-in / off** (`nexus.coding.harnessSelector.enabled`) until a live weak-model A/B shows a net win. When extending the profiles, change one knob, re-run the A/B, and keep the change only if it wins on the held-out split. This is the same no-degradation discipline the skill optimizer uses.

## Related

- [`model-routing`](https://github.com/bendourthe/Nexus-Hub) Nexus-Hub skill (picks the tier; this doc shapes the scaffold for it).
- [`HarnessSelector`](../../modules/coding/orchestration/HarnessSelector.ts) / [`HarnessSelectorAb`](../../modules/coding/orchestration/HarnessSelectorAb.ts) (the runtime; `/harness` inspects the live selection).
