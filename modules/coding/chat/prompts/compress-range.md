When the conversation grows long enough that older tool results, file dumps, or
exploration steps are no longer load-bearing for the current task, you may
issue a `compress_range` call to replace a contiguous span of messages with a
single technical summary block. This is a model-driven action: only you decide
when a span is safe to compress, since you are the only participant who knows
which earlier facts the next step actually depends on.

Use this tool proactively after a sub-task completes -- BEFORE the conversation
hits the context limit and a deterministic strategy has to fall back to a
sliding window. A surgical compress call done early is much less destructive
than a forced summarisation done under pressure.

Schema (JSON, emitted as standard tool args):

```
{
  "topic": "3-5 word label",
  "ranges": [
    {
      "startId": "m0023",
      "endId": "m0041",
      "summary": "Technical summary that names every file path touched, every key decision and its rationale, and every error state and its resolution. Plain prose, no chit-chat."
    }
  ]
}
```

Hard rules:

- `startId` and `endId` are stable IDs (`m0001`, `m0002`, ... or `b1`, `b2`, ...
  issued by prior compress calls). They must reference messages that currently
  exist in the conversation; do not invent IDs.
- The range is inclusive on both ends. The index of `startId` must be <= the
  index of `endId`.
- Multiple ranges in a single call are allowed; they must NOT overlap each
  other within the same call. Overlapping ranges in one call are rejected.
- A range MAY overlap an earlier-recorded block; the prior block's summary is
  automatically embedded inside the new summary (the model does not need to
  manually recopy it).
- The summary itself must preserve, verbatim or near-verbatim:
  - every file path mentioned or modified in the range,
  - every API or tool name involved,
  - every error message and its resolution,
  - every decision and its rationale.
- Do NOT compress chit-chat that sets up a user request you have not yet
  answered. Wait until the answer is delivered.

Avoid:

- compressing a span that contains an unresolved user question,
- compressing a span that contains the most recent reference to a still-active
  todo item, file path, or sub-agent output,
- compressing the system prompt, tool declarations, or memory injection
  sections (those are not in the conversation history),
- writing a vague summary that loses the technical detail (the goal is fewer
  tokens, NOT less information).

The compress tool is permission-tier 0 (auto-approved) because it never
touches files, terminal, or network -- it only rewrites in-memory state. The
operation is reversible via `/compact decompress <blockId>`.
