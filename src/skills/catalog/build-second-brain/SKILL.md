---
name: build-second-brain
description: Help the user populate Instructions.md / Memory.md / Context.md from existing notes, project documentation, or interview prompts.
argument-hint: "[path-to-existing-notes]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [memory, onboarding, documentation]
metadata.related_skills: []
---

Bootstrap a personal "second brain" in the Nexus memory file architecture under `~/.nexus/memory/<workspace-id>/`. Schema in [docs/v0.7.0/architecture.md](../../../docs/v0.7.0/architecture.md) "Memory file architecture". See [build-second-brain/examples.md](./examples.md) for question scripts and extraction examples.

Files:
- `Instructions.md` -- who you are, rules, what good output looks like.
- `Memory.md` -- preferences, corrections, patterns, decisions.
- `Context.md` -- this project, audience, stack, background.
- `Archive/<YYYY-MM-DD>/` -- weekly snapshots (opt-in via `gemma-code.memoryAutoArchive`).

Process:

1. **Pre-flight.** Verify the three files exist for this workspace. If not, stop and tell the user to run `/memory init` first. Do NOT create the files yourself.

2. **Source detection.** If `$ARGUMENTS` is a path, read it as the corpus. Otherwise switch to interview mode.

3. **Interview mode.** Ask ONE batched round: role, project + audience, stack, preferences, patterns, anti-patterns. Wait for a consolidated answer.

4. **Extraction.** Classify each statement:
   - Preferences ("I prefer X" / "always X" / "never Y") -> `Memory.md` `## Preferences`.
   - Corrections ("Do X, not Y") -> `Memory.md` `## Corrections`.
   - Patterns (recurring approaches) -> `Memory.md` `## Patterns`.
   - Decisions (locked-in calls) -> `Memory.md` `## Decisions`.
   - About the user -> `Instructions.md`. About the project -> `Context.md`.

5. **Writing.** APPEND under existing headings; preserve user content. One fact per bullet. Date-stamp decaying facts `(YYYY-MM-DD)`. Cross-reference `file:section` when useful.

6. **Confirmation.** Show diffs. Wait for approval. Offer `/memory edit <section>` to refine.

7. **Report.** Files modified, bullets added, ambiguous notes dropped (with reason). Suggest `/memory archive` for substantial bootstraps.

Hard rules:
- No writes without explicit confirmation.
- Never invent facts -- drop and report ambiguous notes.
- Respect the path guard -- stay inside this workspace's subdir.
- Reference the schema doc; do not duplicate it.

Usage: `/build-second-brain [path]` -- omit path for interview mode.

$ARGUMENTS
