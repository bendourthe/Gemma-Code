---
name: council
description: Run three adversarial perspectives on a major decision before committing
argument-hint: "[decision or change]"
version: 1.0.0
platforms: linux,macos,windows
metadata.hermes.tags: decision-making,reasoning,multi-perspective
---

You are about to evaluate a major decision (architectural change, dependency choice, API contract, refactor scope, technology selection). Before producing a verdict, run a three-pass adversarial council. Each pass speaks in its own voice and reaches its own conclusion; the synthesis at the end reconciles them.

**Latency note:** this skill is intentionally heavy. It performs the equivalent of three inference passes within a single response. Use it only for decisions whose blast radius justifies the cost (anything that touches a public API, a storage schema, an external dependency, or a deployment topology). For a quick code-review question, use `/critique` or `/review-pr` instead.

## Pass 1: Advocate

Argue **for** the proposed change. State the strongest version of the case. Include:

- The concrete user-facing or developer-facing benefit
- The simplest path to ship it
- One precedent from elsewhere in the codebase, ecosystem, or industry that supports the approach

End the pass with a one-sentence summary: "I would ship this because..."

## Pass 2: Senior Architect (adversarial)

Argue **against** the proposed change as a senior architect with skin in the game. Include:

- Hidden coupling or invariants this change might break
- Maintenance cost over a 12-month horizon, not the first sprint
- One alternative approach that achieves the same user outcome with less change
- Failure modes that are silent (no exception, no test failure, but wrong behaviour)

End the pass with a one-sentence summary: "I would block this because..."

## Pass 3: User-impact perspective

Speak from the perspective of the end user (the developer using Gemma-Code, or the downstream consumer of the API). Include:

- What the user has to learn or unlearn
- The error message or failure mode the user will see if this is wrong
- Whether the change is reversible from the user's side (can they roll back, or are they stuck once they upgrade)

End the pass with a one-sentence summary: "From the user's seat, this would feel..."

## Synthesis

After all three passes, write a final synthesis section:

- **Verdict:** SHIP / SHIP-WITH-CHANGES / DEFER / DROP
- **Acceptance criteria (1-3):** specific, testable conditions that must hold before ship
- **Explicit risks (1-3):** the risks you are accepting if you ship this. Each risk has an owner ("we will mitigate by X" or "we are accepting this risk because Y")

The synthesis must reconcile, not just average, the three passes. If the architect raised a structural concern that the advocate did not address, the verdict must reflect that.

$ARGUMENTS
