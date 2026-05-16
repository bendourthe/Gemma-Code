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

### v0.8.0 Phase 2 amendment (item D1) -- extended agentskills.io schema

v0.8.0 extends the SKILL.md frontmatter with four forward-compatible fields aligned with the agentskills.io schema. Pre-v0.8.0 files load unchanged: missing fields default to `version: 1.0.0`, all three platforms, and empty `metadata.tags` / `metadata.related_skills` lists.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `version` | semver string | `1.0.0` | Bump when the skill body changes meaningfully. |
| `platforms` | flow array of `linux|macos|windows` | all three | Constrain which OSes the skill is offered on. |
| `metadata.tags` | flow array of strings | `[]` | Free-form discovery tags (e.g. `git`, `testing`). |
| `metadata.related_skills` | flow array of slugs | `[]` | Cross-references the catalogue uses for `/help` and the multi-harness packaging. |

The parsers in [src/skills/SkillLoader.ts](../../src/skills/SkillLoader.ts) and [scripts/package-skills.mjs](../../scripts/package-skills.mjs) share the same `parseFlowArray` shape so the four harness adapters round-trip the fields without loss. Test coverage in [tests/unit/skills/SkillLoader.test.ts](../../tests/unit/skills/SkillLoader.test.ts) (full-schema parse, partial-schema parse with defaults) and [tests/unit/scripts/package-skills.test.ts](../../tests/unit/scripts/package-skills.test.ts) (round-trip invariance through `parseSkill`) keeps the two parsers in lockstep.

---

## 2. Memory file architecture (Phase 2)

Phase 2 introduces a user-editable, on-disk memory architecture that lives at `~/.gemma-code/memory/<workspace-id>/`. Three Markdown files plus a dated `Archive/` directory provide the human-readable counterpart to the SQL-backed memory subsystem; the user can `vim`/`code` them directly, the agent reads them on every prompt build, and an opt-in scheduled archive captures snapshots so prior states are recoverable.

### Files and schema

| File | Purpose | Section headings |
|---|---|---|
| `Instructions.md` | The user's persistent identity and ground rules. Read first by the model. | `Who you are`, `What you do`, `Rules`, `What good outputs look like` |
| `Memory.md` | Accumulated preferences, corrections, recurring patterns, locked-in decisions. The `build-second-brain` skill writes here. | `Preferences`, `Corrections`, `Patterns`, `Decisions` |
| `Context.md` | Project background -- what is this workspace, who is its audience, what stack does it run on. | `About this project`, `Audience`, `Tools & stack`, `Important background` |
| `Archive/<YYYY-MM-DD>/` | Dated snapshot of the three files at the time of the archive. Idempotent for the day. | (mirrors the three files) |

### Module shape

[src/storage/MemoryFiles.ts](../../src/storage/MemoryFiles.ts) owns every read/write/scaffold/archive concern. The class is constructed with `(workspaceId, baseDir)`; `deriveWorkspaceId(absolutePath)` produces the stable `<basename>-<10-hex>` identifier so two workspaces with the same name on a single machine never collide. Reads are mtime-cached because PromptBuilder runs on every turn and stat'ing three files per call would amplify into thousands of syscalls per session.

### Integration with PromptBuilder

[src/chat/PromptBuilder.ts](../../src/chat/PromptBuilder.ts) takes an optional `MemoryFiles` argument in its constructor. When provided, the builder injects two new prompt sections:

1. **`file-memory-pre`** (priority 2, always-include) -- joins Instructions.md and Context.md verbatim, placed immediately after the bundled system prompt and tool declarations, before plan / thinking / skill / SQL-memory sections.
2. **`file-memory-post`** (priority 31, conditional) -- Memory.md verbatim, placed last so the model sees the user's most-recent on-disk edits with the highest recency.

The combined token cost of file-memory is capped at 50% of the system-prompt budget. When the user's content exceeds the cap, Memory.md is truncated section-by-section in this order: `Preferences -> Corrections -> Patterns -> Decisions`. The `Decisions` section is dropped last because it represents locked-in calls that the user is least willing to lose. A logger warning fires once per build call when truncation engages.

**Precedence**: when the same fact appears in both file-backed and SQL-backed memory, the file wins. The SQL-injection path runs each candidate line through a case-insensitive substring check against `Memory.md`; matches are dropped before the prompt is rendered. Multi-line shadows are not handled (SQL rows are typically a single sentence so the simpler test keeps the hot path cheap).

### Integration with the slash-command surface

Three new verbs join the existing `/memory` builtin (handled in [src/panels/ChatCommandHandlers.ts](../../src/panels/ChatCommandHandlers.ts)):

- `/memory init [--force]` -- scaffold the three files. Without `--force` an existing file is left untouched so the user's edits remain authoritative.
- `/memory archive` -- snapshot the three files into `Archive/<YYYY-MM-DD>/`. Idempotent for the day.
- `/memory edit [instructions|memory|context]` -- open the requested file in VS Code. Defaults to `memory`.

A new setting `gemma-code.memoryAutoArchive` (`"off" | "weekly" | "monthly"`, default `"off"`) enables the silent auto-archive trigger on session start. The bootstrap helper `buildMemoryFiles` in [src/panels/ChatPanelInit.ts](../../src/panels/ChatPanelInit.ts) checks the most-recent archive's age; when older than 7 days (`weekly`) or 30 days (`monthly`), an archive is taken before the panel finishes loading.

### Security posture

- The secret-path denylist (mirrored from [src/utils/secretPaths.ts](../../src/utils/secretPaths.ts)) gates `appendToMemory`, `export`, and `import`. A line that mentions a path matching `**/.env*`, `**/id_rsa*`, `**/.aws/**`, etc. is rejected before reaching the file.
- `removeFromMemory` rejects catastrophic patterns (raw `.*`, `.+`, `.`) so a typo cannot blow Memory.md away.
- The architecture lives under `~/.gemma-code/memory/`; the workspace itself is never written to. Other gemma-code state (skills, mcp.json, operation-log.md) follows the same per-workspace-then-home convention.

### Test contract

- [tests/unit/storage/MemoryFiles.test.ts](../../tests/unit/storage/MemoryFiles.test.ts) -- init / read / archive / append / remove / export / import round-trips, secret-path rejections, mtime-cache invalidation.

### Phase 5 surface: slash-command verbs and the manual MemoryPanel

v0.7.0 Phase 5 layers two user-facing surfaces on top of the [MemoryFiles](../../src/storage/MemoryFiles.ts) primitives:

1. **Slash-command verbs** -- [src/panels/ChatCommandHandlers.ts](../../src/panels/ChatCommandHandlers.ts) gains three new `/memory` verbs:
   - `/memory forget <pattern> [--include-sql]` -- removes matching lines from `Memory.md`. With `--include-sql`, also deletes matching rows from the SQL-backed [MemoryStore](../../src/storage/MemoryStore.ts) via `MemoryStore.deleteById`. Catastrophic patterns (raw `.*`) are rejected by `MemoryFiles.removeFromMemory`.
   - `/memory export <path>` -- writes a JSON dump of the three files plus a snapshot of SQL-backed memories (provenance-marked) to `<path>`. Path-guard rejects secret-path destinations.
   - `/memory import <path> [--mode=merge|replace]` -- merges (default) or overwrites the three files from a JSON export. SQL-backed memories from a foreign export are NEVER silently re-imported -- the user must re-issue them via `/memory save`.
2. **Manual MemoryPanel webview** -- [src/panels/MemoryPanel.ts](../../src/panels/MemoryPanel.ts) registers a sidebar webview at `gemma-code.memoryPanel`. Five tabs:
   - Instructions / Memory / Context -- raw file contents with an "Open in editor" button that pipes through `vscode.workspace.openTextDocument`.
   - SQL-backed -- rows grouped by type with a "Promote to Memory.md" action (calls `appendToMemory` then `deleteById`) and a "Delete" action.
   - Archive -- a list of `Archive/<YYYY-MM-DD>/` snapshots with a "Restore" action that copies the dated snapshot back over the live three files. An "Archive now" button triggers an immediate snapshot.

Per the [Module Authorship Contract](../../AGENTS.md), the MemoryPanel webview iframe never imports `fs` / `better-sqlite3` directly; every interactive button posts a typed message (`promoteSqlMemory`, `deleteSqlMemory`, `archiveMemoryNow`, `restoreArchive`, `openMemoryFile`) to the panel host, which dispatches to MemoryFiles / MemoryStore on the extension side.

The data-build helpers `buildMemorySnapshot`, `listArchiveSnapshots`, `promoteSqlMemoryToFile`, and `restoreArchiveSnapshot` are exported as pure functions so the panel logic can be unit-tested without a live `vscode.WebviewView`. See [tests/unit/panels/MemoryPanel.test.ts](../../tests/unit/panels/MemoryPanel.test.ts).

See [ADR-0014](../adr/0014-memory-file-architecture.md) for the precedence and lifecycle rationale (file > SQL on conflict; Archive on schedule).
- [tests/integration/memory-files-prompt-merge.test.ts](../../tests/integration/memory-files-prompt-merge.test.ts) -- end-to-end PromptBuilder ordering plus the SQL-shadow-drop precedence rule.
- [tests/integration/memory-auto-archive.test.ts](../../tests/integration/memory-auto-archive.test.ts) -- bootstrap scaffold + auto-archive scheduler.
- [tests/unit/panels/ChatCommandHandlers.test.ts](../../tests/unit/panels/ChatCommandHandlers.test.ts) -- `/memory init|archive|edit` verbs.

---

## 3. Compaction stack (Phase 3)

Phase 3 ships the model-callable `compress` tool (range mode + experimental message mode), two new deterministic strategies (`deduplication`, `purgeErrors`), per-session [CompressionState](../../src/chat/state/CompressionState.ts) for stable IDs and run history, six `/compact` verbs for user-facing lifecycle control, and a `gemma-code.contextLimitsPerModel` per-model context-window override. Permission tier 0 (auto-approve) is registered for both compress tool variants; the registry builder accepts `compress: { deps, experimentalMessageMode }` to wire them.

### 3.1 Pipeline order

`ContextCompactor` runs strategies in this order:

1. `DeduplicationStrategy` -- collapse same-tool-same-args repeats (zero LLM cost).
2. `PurgeErrorsStrategy` -- drop args of errored tool calls older than `compactionErrorPurgeTurns`.
3. `ToolResultClearing` -- v0.6.0 behaviour, preserves last N tool results.
4. `SlidingWindow` -- v0.6.0 behaviour.
5. `CodeBlockTruncation` -- v0.6.0 behaviour.
6. `RegenerateFromSource` (when workspacePath is set) -- v0.6.0 behaviour.
7. `LlmSummary` -- v0.6.0 behaviour, last-resort summarisation.
8. `EmergencyTrim` -- v0.6.0 behaviour, hard cap.

The two new strategies run BEFORE the v0.6.0 chain so the cheaper deterministic wins land first. Both are no-ops when there is nothing to do.

### 3.2 Compress tool schema

`compress_range` arguments:

```
{
  topic: string,                       // 3-5 word label
  ranges: Array<{
    startId: string,                   // mNNNN or bN, inclusive
    endId: string,                     // mNNNN or bN, inclusive
    summary: string,                   // technical summary
  }>
}
```

`compress_message` arguments (gated behind `gemma-code.compactExperimentalMessageMode`):

```
{
  topic?: string,                      // defaults to "message-mode"
  compressions: Array<{
    messageId: string,                 // mNNNN
    summary: string,
  }>
}
```

### 3.3 Lifecycle (`/compact <verb>`)

- `/compact` -- legacy sliding-window compaction (preserved).
- `/compact context` -- per-role token breakdown + headroom percentage.
- `/compact stats` -- cumulative pruning stats from `CompressionState`.
- `/compact sweep [n]` -- plan a span over the last N tool-result messages (auto-issue deferred to Phase 4).
- `/compact decompress <blockId>` -- splice the snapshot back into the conversation.
- `/compact recompress <blockId>` -- re-apply a prior decompression.
- `/compact manual on|off` -- toggle session-scoped manual-only mode (refuses autonomous compress calls).

### 3.4 Settings introduced in Phase 3

- `gemma-code.contextLimitsPerModel` -- per-model context overrides.
- `gemma-code.compactionProtectedTools` -- tool names every compaction strategy and the compress tool must skip.
- `gemma-code.compactionErrorPurgeTurns` -- threshold (in user-message turns) for purgeErrors.
- `gemma-code.compactionProtectedFilePatterns` -- substring patterns; tool calls whose args contain a matching path are exempt from deduplication.
- `gemma-code.compactExperimentalMessageMode` -- gates `compress_message`.

See [ADR-0012](../adr/0012-model-callable-compress-tool.md) for the full design rationale.

---

## 4. Webview render protocol (Phase 4 -- TBD)

Lands in Phase 4. See [docs/v0.7.0/plans/v0.7.0-cycle.md](./plans/v0.7.0-cycle.md) "Phase 4".

---

## 5. Multi-harness skill packaging (Phase 6)

Phase 6 adds `scripts/package-skills.mjs`, an LLM-free Node script that exports the gemma-code skill catalog into four sibling agentic harnesses:

| Harness | Output path (relative to `dist/<harness>/`) | Transform |
|---|---|---|
| Claude Code | `.claude/skills/<slug>/SKILL.md` | byte-identical copy |
| OpenCode | `.opencode/skills/<slug>/SKILL.md` | byte-identical copy |
| Gemini CLI | `.gemini/skills/<slug>/SKILL.md` | byte-identical copy |
| Cursor | `.cursor/rules/<slug>.md` | rewrites frontmatter to `rule: SKILL` and preserves the original `name` / `description` / `argument-hint` fields as inline comments |

Each harness output also gets a `README.md` explaining the source, the schema mapping, and the no-edit-in-place rule. The Cursor adapter logs a warning at run-time because Cursor's native rule format (`.cursor/rules/<slug>.mdc` with `description` / `globs` / `alwaysApply`) differs enough from the Anthropic SKILL.md schema that a 1:1 conversion is non-trivial; a fully-native conversion is tracked as a follow-up.

`dist/` is gitignored. The CI job `package-skills` (in [.github/workflows/ci.yml](../../.github/workflows/ci.yml)) runs the script on every push and uploads the four trees as separate artifacts (`skills-claude-code`, `skills-cursor`, `skills-opencode`, `skills-gemini-cli`) so the v0.7.0 release pipeline can attach them to the GitHub release without an extra manual step.

Local entry point: `npm run package:skills` (or `npm run package:skills -- --quiet --no-clean`).

---

## 6. gemma-check standalone CLI (Phase 6)

Phase 6 also ships `bin/gemma-check.mjs`, a LLM-free deterministic checks CLI. It walks a directory or file and runs a small, hand-curated rule set. The CLI is registered as a published `bin` (`gemma-check`) and can be invoked locally with `npm run check` or via `node bin/gemma-check.mjs`.

Shipped rules (severity in parentheses):

| Rule id | Severity | What it flags |
|---|---|---|
| `no-secret-patterns` | error | AWS access keys, GitHub PATs, JWT triplets, PEM / SSH private-key block headers (mirrors `scripts/hooks/check-prompt-policy.mjs`) |
| `no-math-random-for-tokens` | error | `Math.random()` in files whose path contains `auth` / `token` / `crypto` / `secret` / `password` / `jwt` / `session` |
| `no-committed-console-log` | warning | `console.log(` in production code (skips test files) |
| `no-env-file-leakage` | warning | string-literal `.env` references in production code (skips test / example / docs files, allows `.env.example`) |

Rule modules live under `lib/checks/`. Each exports `{ id, severity, scan(filePath, contents): Finding[] }`; the central registry is [lib/checks/index.mjs](../../lib/checks/index.mjs).

Allowlist mechanism: any rule can be suppressed inline with a `gemma-check-allow` comment (same line) or `gemma-check-allow-next-line` (immediately preceding line), optionally with a `: <rule-id>` suffix to scope the suppression to one rule. The helper that interprets the markers lives in [lib/checks/helpers.mjs](../../lib/checks/helpers.mjs).

CI gate: the `gemma-check` job runs `node bin/gemma-check.mjs src/` on every push; the gate is "no findings". The CLI is the first piece of the optional Phase 7 audit-worker pipeline.

---

_Sections 2-5 are placeholders that the corresponding phase fills in. The document is finalised in Phase 8 with cross-references to ADR-0006/0007/0008._
