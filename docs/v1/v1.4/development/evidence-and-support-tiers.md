# Evidence Philosophy and Support Tiers

**Adoption item**: A7 (skill-native) from [../../v1.3.0/comparison-claude-code-harness.md](../../v1.3/comparison-claude-code-harness.md).
**Source pattern**: claude-code-harness `docs/distribution-scope.md`, `docs/tool-capability-matrix.md`.
**Status**: active convention (v1.4.0).
**Applies to**: anyone writing claims about what Nexus does, supports, or integrates - in docs, READMEs, release notes, known-gaps files, comparison reports, and agent output.

## Part A - "not_observed != absent"

The claude-code-harness ties every capability claim to local proof: a behaviour that was not observed in a given environment is recorded as "not proven here", not as "impossible" or "unsupported". Nexus adopts the same rule.

**The rule**: the absence of local evidence is evidence of absence of *proof*, not evidence of absence of the *capability*. Missing proof in one environment narrows the claim to that environment; it does not license a universal negative.

Concretely, when you cannot demonstrate something locally:

- **Wrong**: "Nexus does not support X." (a universal claim from a local non-observation)
- **Wrong**: "X works." (a universal claim with no proof attached)
- **Right**: "X is not proven on this host (reason: <missing dependency / no upstream release / offline>). It is expected to work because <mechanism>; verification is tracked as <gap id / follow-up>."

Worked examples already in the repo that this convention codifies:

- The v1.3.0 skills-audit benchmark is a builtin-catalog baseline (16 skills) because the full ~213-skill Nexus-Hub catalog "awaits the upstream-release sync" (carryforward `1.1.P3.B`). The benchmark does not claim the full catalog is unsupported; it records that it was not measured here and why.
- `skills sync --dry-run` is described in v1.3.0 as "network path blocked by carryforward `1.1.P3.B` (no upstream release on this host) -- not a regression". The non-observation is scoped to the host, with the cause and the tracking gap cited.

This rule is the wording layer beneath the [self-review checklist](self-review-checklist.md) gate G3 ("DoD verified with evidence"): a checked box must cite the command that proved it, and anything unproven is written as "not proven here" with a tracked follow-up, never as a silent pass.

## Part B - support-tier vocabulary

Every feature, tool, language, and integration claim in Nexus uses one of four explicit tiers, adapted from the harness `tool-capability-matrix.md`. The tier states how strong the evidence is, so a reader never has to guess whether "supports" means "shipped and tested" or "should work in principle".

| Tier | Meaning | Evidence bar | Example |
|---|---|---|---|
| **supported** | Shipped, wired into a caller, and covered by a passing test or benchmark on a supported host. | Cited passing test / benchmark / golden task. | The `nexus skills audit` command (v1.3.0): five report sections, integration tests, published benchmark. |
| **internal-compatible** | The mechanism exists and is exercised locally, but full end-to-end proof depends on an external surface not present here. | Local unit/integration proof + a named external dependency and its tracking gap. | The full-catalog skills render path: the render-budget ladder is tested, but the 213-skill catalog awaits the Nexus-Hub upstream release (`1.1.P3.B`). |
| **candidate** | Designed and partially built, not yet wired into a production caller, or behind an off-by-default flag. | Implementation + test for the unit, plus an explicit "no caller yet" / "flag off" note. | `core/storage/PermissionsDeny.ts` before v1.4.0 Phase 8: implemented and tested, no caller (gap `5.3.P2.R`). |
| **future** | Planned or deferred; no implementation, or an explicit won't-do-yet. | A plan reference or a known-gaps `DF` entry with a reason. | The full Breezing-style Planner/Critic/Worker orchestration deferred in v1.4.0 Phase 6 (A10 ships worktree isolation only). |

**Usage rules**:

1. State the tier explicitly when the reader could otherwise assume "supported". A bare verb ("Nexus integrates with Y") defaults to `supported` and must therefore meet the `supported` evidence bar; if it does not, name the lower tier.
2. A tier may only be raised when its evidence bar is met with a cited proof. Raising a claim from `candidate` to `supported` requires the wiring and the passing test, not just intent.
3. When a claim drops a tier (a regression, a removed caller, a broken dependency), record the drop and the cause; do not silently leave a stale `supported` claim in place.

## Tie-in to the known-gaps wording convention

The Nexus known-gaps files already carry a severity vocabulary (`P0`-`P3`) and a category vocabulary (`NI`, `DF`, `BG`, `MT`, `WN`, `QG`). This convention adds the *claim-strength* axis that governs how an open gap's surrounding prose is written:

- A `DF` (deferred) item describes the unbuilt capability at tier `future` or `candidate`, never `supported`.
- A `MT` (missing tests) item means the capability cannot yet be claimed `supported` (the evidence bar is unmet); it sits at `candidate` or `internal-compatible` until the test lands.
- The "Suggested next step" field of a gap states what evidence would raise the tier (for example, "wire `evaluateDeny` into `run_terminal` -> raises `PermissionsDeny` from `candidate` to `supported`").

When a known-gaps entry resolves, the prose claim about that capability is updated to its new tier with the cited closing evidence, so the gap log and the capability claims never disagree.

## Where this is referenced

This convention is anchored from [AGENTS.md](../../../AGENTS.md) (the agent directive) so every agent session inherits the "not_observed != absent" rule and the four-tier vocabulary, and it is the wording authority for the v1.4.0 [known-gaps.md](../known-gaps.md) file and any comparison or release-notes prose written this cycle.
