# ADR-0015: Pass-State Gating in AgentLoop

**Status**: accepted
**Date**: 2026-05-15
**Cycle**: v0.8.0 Phase 2 (item C8)
**Source**: comparison-multi-source-v2.md Section 5a item C8; `docs/en/lectures/lecture-08/index.md`

## Context

Through v0.7.0 an agent could end a turn by emitting a no-tool-call "Done." response at any time. Nothing in [src/tools/AgentLoop.ts](../../src/tools/AgentLoop.ts) checked whether that termination was backed by an actual verification step (a successful lint run, a test pass, a golden-task pass). The agent could self-declare success, the conversation would close, and the user would discover the regression only when they next ran the suite by hand.

The plannotator / hermes-agent comparison surfaced "pass-state gating" as a one-line behavioral fix that prevents this whole class of false positives -- the agent has to *prove* it verified the work before the loop will let it terminate.

## Decision

`AgentLoop` enforces a pass-state gate before treating a no-tool-call response as a final answer:

1. At `run()` start, reset `_verifiedSinceUserMessage = false` and `_gateNudgeIssued = false`. A new user message means the gate has to be earned fresh.
2. Every successful tool call against a member of `VERIFICATION_TOOLS` flips `_verifiedSinceUserMessage = true`. The starter set is `{run_terminal}` -- lint, build, test, and any custom check command all go through `run_terminal`.
3. When the model emits a response with no tool calls, the gate fires:
   - If `_verifiedSinceUserMessage === true`, terminate normally.
   - If false **and** `_gateNudgeIssued === false`, inject `[SYSTEM] Task cannot complete without verification. Run a verification tool (lint, build, test, or relevant check) and re-emit the completion signal.` as a user message, commit the would-be-final assistant turn (so reasoning is preserved), flip `_gateNudgeIssued = true`, and let the loop run one more iteration.
   - If both flags are false a second time, allow termination so the operator sees the trace rather than the loop spinning forever.
4. Gate behaviour is gated on the `gemma-code.passStateGating` setting (default `true`). Disabling exists so non-coding workflows and tests that cannot run real commands stay functional.

`OperationLog` (Phase 9 of v0.5.0) keeps the audit trail: every tool call records `outcome=ok|error`, so a post-session forensic check can verify the gate actually fired.

## Consequences

**Positive**:

- Self-declared "Done." responses without a real check are now caught at the loop layer rather than at code-review time.
- The nudge wording is paired with the gate so the agent has a clear recovery path -- it does not have to guess what the loop wants.
- Coverage shortfalls in implementation phases are easier to spot because the operator sees the gate fire in transcripts.

**Negative**:

- The agent now needs at least one verification tool call per turn that ends in success. For trivial "read this file and explain it" prompts, the model may emit one `run_terminal` call (e.g. `echo ok`) just to satisfy the gate. Mitigation: the gate only fires when the agent tries to terminate -- read-only Q&A turns that legitimately have nothing to verify can run any read-only tool to satisfy it, or the user can disable `passStateGating` for that workspace.
- Verification cost increases by one tool-call latency per turn that hit the gate.

**Neutral**:

- The starter `VERIFICATION_TOOLS` set is intentionally narrow. Future phases can broaden it (golden-task tool, dedicated check tool) without re-architecting the gate.

## Alternatives considered

- **Hard refusal after the nudge**: terminate the loop with an error if the agent ignores the nudge. Rejected because a malformed verification (model emits a `run_terminal` but the command itself fails) would leave the user looking at an opaque "loop terminated" error rather than the agent's actual reasoning.
- **Counter-based budget**: allow N consecutive "done" responses before terminating. Rejected because it just delays the false-positive case without adding signal.

## Tests

- [tests/unit/tools/AgentLoop.test.ts](../../tests/unit/tools/AgentLoop.test.ts) `pass-state gating` describe block covers: (a) verified task terminates, (b) unverified task gets one nudge and a second chance, (c) `passStateGating: false` disables the gate.

## See also

- [src/tools/AgentLoop.ts](../../src/tools/AgentLoop.ts) -- `VERIFICATION_TOOLS`, `PASS_STATE_GATING_NUDGE`, `_verifiedSinceUserMessage`, `_gateNudgeIssued`.
- [docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md](../v0.8.0/plans/v0.8.0-cycle.md) Phase 2 sub-task 2.4.
