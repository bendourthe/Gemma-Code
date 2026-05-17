# build-second-brain -- examples

Sibling file for the `build-second-brain` SKILL. Carries the verbose interview script and extraction examples that were inlined in v0.8.0; trimmed out in v0.9.0 Phase 6.8 to fit the 800-token prompt budget. The SKILL.md remains authoritative; this file is referenced when the agent needs concrete fixtures.

## Interview-mode question script

When `$ARGUMENTS` is empty, ask one consolidated batch:

1. **Role** -- "What do you do day-to-day?" (engineer, scientist, designer, founder, etc.)
2. **Project** -- "What is the current workspace about? Who is its audience?"
3. **Stack** -- "Language, framework, deployment target?"
4. **Preferences** -- "Any strong style or workflow preferences? (conventional commits, no Co-Authored-By lines, dark theme, terse responses, etc.)"
5. **Patterns** -- "Recurring patterns I should follow without re-explanation?"
6. **Anti-patterns** -- "Anything I should NEVER do?"

Wait for one consolidated answer; do NOT ping-pong.

## Extraction examples

Input note: "I prefer conventional commits, no Co-Authored-By lines ever."
-> `Memory.md` `## Preferences`: `- Conventional commits; no Co-Authored-By lines (2026-05-16).`

Input note: "Don't add error handling for scenarios that can't happen -- I burn on it."
-> `Memory.md` `## Anti-patterns`: `- No defensive error handling for impossible scenarios.`

Input note: "We migrated from Postgres to SQLite in Q2 2026 because the latency budget shrank."
-> `Context.md` `## History`: `- Postgres -> SQLite migration (Q2 2026); reason: latency budget.`

Input note: "I'm a staff engineer with 12 years in compilers."
-> `Instructions.md`: `Role: staff engineer, 12 years compiler experience -- frame explanations accordingly.`

Input note: "Use Zod for validation; we already depend on it."
-> `Memory.md` `## Patterns`: `- Validate boundary inputs with Zod (project already depends on it).`

## Ambiguous-note handling

If a note cannot be cleanly bucketed -- e.g. "Sometimes we use X, sometimes Y" -- DROP it and report:

> Dropped: "Sometimes we use X, sometimes Y" -- ambiguous; need a clear preference or context to bucket.

Never invent a bucket for an unclear note.
