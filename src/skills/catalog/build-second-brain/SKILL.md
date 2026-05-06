---
name: build-second-brain
description: Help the user populate Instructions.md / Memory.md / Context.md from existing notes, project documentation, or interview prompts.
argument-hint: "[path-to-existing-notes]"
---

You are helping the user bootstrap a personal "second brain" stored in the gemma-code memory file architecture introduced in v0.7.0 Phase 2. The four files live under `~/.gemma-code/memory/<workspace-id>/` and are user-editable on disk.

Per [docs/v0.7.0/architecture.md](../../../docs/v0.7.0/architecture.md) "Memory file architecture" section, the schema is:
- `Instructions.md` -- who you are / what you do / rules / what good outputs look like.
- `Memory.md` -- preferences / corrections / patterns / decisions, accumulated over time.
- `Context.md` -- about this project / audience / tools and stack / important background.
- `Archive/<YYYY-MM-DD>/` -- weekly snapshots of the three files (opt-in via `gemma-code.memoryAutoArchive`).

Process:

1. **Pre-flight: confirm the file architecture exists.**
   - Check that `~/.gemma-code/memory/<workspace-id>/Instructions.md`, `Memory.md`, and `Context.md` exist.
   - If they do not, stop and tell the user: "The memory file architecture is not initialised. Run `/memory init` first (lands in v0.7.0 Phase 2). This skill cannot proceed until those files exist." Do not create the files yourself; that is the responsibility of the `/memory init` command.

2. **Source detection.**
   - If `$ARGUMENTS` provides a path to existing notes (markdown, text, or a directory), read it / them first. This is the input corpus.
   - If no path was provided, switch to interview mode (step 3).

3. **Interview mode (when no input notes are provided).**
   Ask the user a small batched set of questions, ONE round only:
   - Role: what do you do day-to-day? (engineer, scientist, designer, founder, etc.)
   - Project: what is the current workspace about? Who is its audience?
   - Stack: what language, framework, deployment target?
   - Preferences: any strong style or workflow preferences? (e.g. conventional commits, no co-authored-by lines, dark theme, terse responses)
   - Patterns: are there recurring patterns you want me to follow without re-explaining each time?
   - Anti-patterns: anything I should NEVER do?
   Wait for one consolidated answer before writing.

4. **Extraction (input notes mode).**
   When notes are provided, classify each statement into one of four buckets:
   - **Preferences** -- "I prefer X over Y" / "always use X" / "never use Y". Goes to `Memory.md` under `## Preferences`.
   - **Corrections** -- "Do X, not Y" / "the prior answer was wrong because Z". Goes to `Memory.md` under `## Corrections`.
   - **Patterns** -- recurring approaches / templates / shapes. Goes to `Memory.md` under `## Patterns`.
   - **Decisions** -- locked-in technical or product calls. Goes to `Memory.md` under `## Decisions`.
   Anything that describes the user (role, expertise) goes to `Instructions.md`. Anything that describes the project (stack, audience, conventions, history) goes to `Context.md`.

5. **Writing.**
   - For each section, append (do NOT overwrite) under the existing headings. Preserve any existing content the user already authored.
   - Use bullet points, one fact per bullet. Avoid prose.
   - Date-stamp new bullets with `(YYYY-MM-DD)` if the bullet is a corrective fact that may decay.
   - Cross-reference: if a `Memory.md` Decision relates to a `Context.md` background fact, mention the file:section.

6. **Confirmation.**
   - Show the user a diff of what you propose to write to each file.
   - Wait for confirmation before writing. Use the `/memory edit <section>` command to open the files in VS Code if the user wants to refine before saving.

7. **Report.**
   - List the files modified.
   - Bullet count added to each file.
   - Any input note that was ambiguous and dropped (with the reason).
   - Suggest running `/memory archive` if this is a substantial bootstrap (so the pre-bootstrap state is preserved).

Hard rules:
- Never write to the file architecture without explicit user confirmation when bootstrapping.
- Never invent facts. If a note is ambiguous, drop it and report.
- Respect the file architecture's path guard. Do not write to `~/.gemma-code/memory/` outside the workspace's own subdirectory.
- Reference the schema in [docs/v0.7.0/architecture.md](../../../docs/v0.7.0/architecture.md) so this skill stays consistent if the schema evolves -- do not duplicate the schema definition here.

Usage example:
- `/build-second-brain ~/notes/project-brief.md` -- extract from a brief.
- `/build-second-brain ~/notes/standup-archive/` -- extract from a directory of standups.
- `/build-second-brain` -- run the interview.

$ARGUMENTS
