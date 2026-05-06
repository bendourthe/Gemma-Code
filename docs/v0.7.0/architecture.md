# Gemma Code v0.7.0 -- Architecture

This document captures the v0.7.0 architecture as it lands phase-by-phase. v0.7.0 is a feature release that adopts the highest-value patterns surfaced by the multi-source comparison ([docs/v0.7.0/comparison-multi-source.md](./comparison-multi-source.md)) while preserving v0.6.0's local-only thesis. It supersedes [docs/v0.6.0/architecture.md](../v0.6.0/architecture.md) for v0.7.0 and complements [ARCHITECTURE.md](../../ARCHITECTURE.md) (which stays version-neutral).

The user-visible delta in v0.7.0 is large: a measurably more presentable webview, a memory architecture the user can directly edit on disk, model-driven context compression, and a richer skill set for design / polish / critique / hardening workflows. The internal-developer-visible delta is moderate: new modules under `src/storage/MemoryFiles.ts`, `src/chat/state/CompressionState.ts`, `src/tools/handlers/compress.ts`, expanded webview render protocol, and a multi-harness skill export script.

Phase coverage of this document: each phase appends to its own section; the document grows during the cycle and is finalised in Phase 8 with ADR-0006/0007/0008 cross-references.

---

## 1. Skill catalogue (Phase 1)

The bundled skill catalogue at [src/skills/catalog/](../../src/skills/catalog/) ships v0.7.0 with thirteen built-in skills (seven existing from v0.5.0/v0.6.0 plus six new in v0.7.0 Phase 1). Skills load through [SkillLoader](../../src/skills/SkillLoader.ts), which walks the catalog directory plus the user-supplied skills directory at `~/.gemma-code/skills/`; a user-authored skill with the same name overrides the built-in. The `/help` builtin lists every loaded skill.

### v0.7.0 Phase 1 -- new skills

| Skill | One-line description |
|---|---|
| `polish` | Final-pass quality cleanup -- tighten naming, remove dead branches, improve docstrings, format, and verify tests pass. Behaviour-preserving. |
| `critique` | Structured code review against an explicit five-axis rubric (correctness, readability, performance, security, test coverage). Findings only, no edits. |
| `distill` | Strip code to its essence -- remove indirection, simplify conditionals, collapse single-consumer abstractions. Behaviour-preserving. |
| `harden` | Add error handling, input validation, and edge-case coverage where a specific risk justifies it. Each addition must trace to a real failure mode. |
| `animate` | Introduce purposeful motion or interactivity to webview / extension UI elements. Restricted to extension UI surfaces (not generic). Respects `prefers-reduced-motion`. |
| `build-second-brain` | Help the user populate Instructions.md / Memory.md / Context.md from existing notes or interview prompts. Non-functional until Phase 2 lands the memory file architecture. |

These are MD-only skills with YAML frontmatter and a prompt body, parsed by SkillLoader's frontmatter-then-body convention. None of them changed any TypeScript code in Phase 1; the catalog change is the entire deliverable. Phase 1 is intentionally zero-code-first so the catalog delta is the first thing visible on a v0.7.0 install.

### v0.7.0 Phase 1 -- existing skills (unchanged)

`commit`, `review-pr`, `generate-readme`, `generate-changelog`, `generate-tests`, `analyze-codebase`, `setup-project`. See [docs/v0.6.0/architecture.md](../v0.6.0/architecture.md) for the v0.6.0 baseline.

### Test contract

Two tests cover the catalog:
- [tests/unit/skills/SkillLoader.test.ts](../../tests/unit/skills/SkillLoader.test.ts) -- per-skill load assertion against the real on-disk catalog for each of the six new skills, plus argument-hint presence check.
- [tests/integration/commands/skill-execution.test.ts](../../tests/integration/commands/skill-execution.test.ts) -- counts thirteen built-in skills total and exercises `$ARGUMENTS` substitution.

---

## 2. Memory file architecture (Phase 2 -- TBD)

Lands in Phase 2. See [docs/v0.7.0/plans/v0.7.0-cycle.md](./plans/v0.7.0-cycle.md) "Phase 2" for the planned shape; this section will be filled in once Phase 2 ships.

The schema referenced by the `build-second-brain` skill (Phase 1) will be defined here:
- `Instructions.md` -- who you are / what you do / rules / what good outputs look like.
- `Memory.md` -- preferences / corrections / patterns / decisions.
- `Context.md` -- about this project / audience / tools and stack / important background.
- `Archive/<YYYY-MM-DD>/` -- weekly snapshots, opt-in via `gemma-code.memoryAutoArchive`.

Until Phase 2 lands, the `build-second-brain` skill detects the absence of these files and refers the user to `/memory init`.

---

## 3. Compaction stack (Phase 3 -- TBD)

Lands in Phase 3. See [docs/v0.7.0/plans/v0.7.0-cycle.md](./plans/v0.7.0-cycle.md) "Phase 3".

---

## 4. Webview render protocol (Phase 4 -- TBD)

Lands in Phase 4. See [docs/v0.7.0/plans/v0.7.0-cycle.md](./plans/v0.7.0-cycle.md) "Phase 4".

---

## 5. Multi-harness skill packaging (Phase 6 -- TBD)

Lands in Phase 6. See [docs/v0.7.0/plans/v0.7.0-cycle.md](./plans/v0.7.0-cycle.md) "Phase 6".

---

_Sections 2-5 are placeholders that the corresponding phase fills in. The document is finalised in Phase 8 with cross-references to ADR-0006/0007/0008._
