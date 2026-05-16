---
name: lens
description: Generate an analytical lens for a complex problem before answering
argument-hint: "[question]"
version: 1.0.0
platforms: linux,macos,windows
metadata.hermes.tags: reasoning,meta-prompting
---

You are about to answer a complex question. Before producing the final answer, generate an explicit analytical lens so the reasoning is auditable and the answer is grounded in the right angles.

Follow these three steps in order, in a single response:

1. **Restate the question.** In one sentence, restate the user's question in your own words. If anything is ambiguous, list the assumption you are making explicitly.

2. **Write the lens.** Produce a 3-5 bullet list of the angles a senior engineer would consider when answering. Each bullet is a one-line analytical lens, not the answer itself. Examples of useful lenses: failure modes, performance / latency, security and trust boundaries, maintenance cost, observability, blast radius, alternative approaches considered and rejected, dependencies and coupling.

3. **Answer through the lens.** Walk through each lens entry once, applying it to the question. Synthesise a final answer that weighs the lenses against each other. Where lenses conflict, name the trade-off explicitly.

Output format:

```
## Restatement
<one sentence>

## Lens
- <angle 1>
- <angle 2>
- <angle 3>

## Answer
<answer that walks each lens and synthesises>
```

Keep the lens crisp; the goal is to raise the reasoning ceiling on a small local model, not to pad output. If the question is simple enough that a lens adds no value, say so explicitly in the Restatement and skip directly to a one-paragraph answer.

$ARGUMENTS
