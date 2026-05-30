# Self-Review Checklist (pre-commit / pre-PR gate)

**Adoption item**: A3 (skill-native) from [../../v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md).
**Source pattern**: claude-code-harness `harness.toml [worker.self_review] default_rules`.
**Status**: active convention (v1.4.0).
**Applies to**: every author (human or agent) before they push a branch or open a PR.

## Purpose

The claude-code-harness ships a worker self-review gate that runs a fixed set of evidence-backed rules before a unit of work is allowed to leave the worker. Nexus adopts the same discipline as a reusable checklist rather than as Go code: the author walks these gates by hand (or an agent walks them programmatically) before `git push`, and the answers are recorded in the PR description. The checklist is the upstream gate for the [evidence-pack discipline](evidence-pack.md) (A12): only work that clears every gate below is allowed to be packaged into a PR or release.

This checklist does not replace the automated gates. The husky [pre-push hook](../../../../.husky/pre-push) already runs `eslint --fix`, `npm run lint`, `npm run build`, and `npm run check`; the [PR template](../../../../.github/PULL_REQUEST_TEMPLATE.md) Submission Checklist and [pr-quality workflow](../../../../.github/workflows/pr-quality.yml) gate the merge. This checklist covers the judgement-level checks that no linter enforces: that declared symbols are actually wired in, that the definition of done was verified with evidence rather than asserted, and that no existing behaviour silently regressed.

## The gates

Each gate maps to a harness `[worker.self_review]` rule, re-expressed for Nexus's TypeScript / Node stack. A gate is either satisfied (`[x]`) or explicitly waived with a one-line reason (`[ ] N/A: <reason>`), mirroring the PR template convention. Never leave a box blank.

### G1 - dry-violation-none

- [ ] No duplicated logic was introduced. New behaviour reuses an existing helper where one exists, rather than re-implementing it inline.
- [ ] If duplication was unavoidable (for example, a boundary re-export), it is intentional and noted.

*Why*: the harness `dry-violation-none` rule. Duplication is the most common source of drift between two copies of the same rule (for example, the SSRF egress list and its generated table, or the codegraph ignore parser - see the v1.4.0 SSOT and ignore-parity work in Phases 4 and 8).

### G2 - all-declared-symbols-called

- [ ] Every exported function, class, or constant added in this change has at least one caller, test, or documented external consumer. No new orphan was created.
- [ ] `npm run check-architecture` (dependency-cruiser) reports no new `no-orphans` warning attributable to this change.

*Why*: the harness `all-declared-symbols-called` rule. A declared-but-unwired symbol is a latent bug: the v1.2.0 `PermissionsDeny.ts` orphan (gap `5.3.P2.R`, scheduled for wiring in v1.4.0 Phase 8) is the canonical example of code that was implemented and tested but never routed into a caller.

### G3 - dod-items-verified-with-evidence

- [ ] Every acceptance criterion in the plan sub-task (the "Acceptance:" line in the phase prompt) was verified by running a command, not by inspection alone.
- [ ] The evidence (command + outcome, for example "`npm test` -> 3704 passed / 0 failed") is captured in the PR description or session history, not merely claimed.

*Why*: the harness `dod-items-verified-with-evidence` rule, and Nexus's own Critical Rule "Verify work before marking complete". "PR ready is not release ready" begins here: a checked box with no evidence behind it is a tampering risk (see the A2 test-tampering rules landing in v1.4.0 Phase 3).

### G4 - no-existing-test-regression

- [ ] The full suite (`npm test`) was run after the change and the pass count did not drop relative to the pre-change baseline.
- [ ] No previously-passing test was skipped, disabled, weakened, or deleted to make the suite green. If a test was legitimately removed or changed, the reason is documented in the commit body.

*Why*: the harness `no-existing-test-regression` rule. This gate is the human-judgement complement to the automated A2 test-tampering nexus-check rules (v1.4.0 Phase 3): the rules catch the mechanical patterns (added `.skip`, hardcoded results, weakened assertions); this gate catches the intent.

### G5 - tdd-red-evidence-attached (only when TDD applies)

- [ ] If this change was developed test-first, the failing-test ("red") evidence was captured before the implementation, and the green evidence after.
- [ ] N/A is acceptable when the change is not test-driven (for example, a docs-only or convention change such as this Phase 1 deliverable).

*Why*: the harness `tdd-red-evidence-attached` rule. Red-then-green evidence proves the test actually exercises the new behaviour rather than passing vacuously.

## How to use it

1. Before `git push`, walk G1-G5 for the staged change.
2. Record the result in the PR description under the Submission Checklist (the PR template links back to this file).
3. If any gate is `N/A`, give a one-line reason. An agent author records the same answers in the session history.
4. The husky pre-push hook and the pr-quality workflow enforce the mechanical gates; this checklist is the judgement layer that gates whether the work is honest and complete.

## Relationship to other v1.4.0 conventions

- [evidence-pack.md](evidence-pack.md) (A12) consumes this checklist: only work that clears G1-G5 with attached evidence is packaged for a PR or release.
- [evidence-and-support-tiers.md](evidence-and-support-tiers.md) (A7) governs the wording of the evidence recorded here: "verified" means "proven locally with a cited command", and absence of proof is recorded as "not proven here", never as "done".
