---
name: review-pr
description: Structured Gemma-Code PR review (walkthrough then per-file analysis then severity-x-confidence findings); edits only after the user confirms.
argument-hint: "[PR number or URL]"
version: 2.0.0
platforms: [linux, macos, windows]
metadata.tags: [code-review, git, workflow, pr]
metadata.related_skills: [critique, commit]
---

Review a PR against `bendourthe/Gemma-Code:main`. Read-only analysis first; apply only after the user picks findings.

## Input

`$ARGUMENTS` = PR number or URL. If empty, ask once and stop.

## Phase A: Fetch

`gh pr view <PR> --json number,title,author,body,headRefName,labels,changedFiles,mergeStateStatus,url`; `gh pr diff <PR>` for hunks. If body cites `Fixes #N`: `gh issue view <N>`.

## Phase B: Checkout

`git status --porcelain` -- refuse if dirty. Then `gh pr checkout <PR>`; `git fetch origin main`.

## Phase C: Read changed files in full

For each file in `gh pr view <PR> --json files`: read in full (hunks are insufficient); flag > 500 lines, `console.*` in `src/` (use [logger.ts](../../../../src/utils/logger.ts)), direct Ollama imports outside `src/llm/`.

## Phase D: Axes

1. **Correctness** -- logic, off-by-one, edge cases, unhandled rejections, broken types.
2. **Standards** (cite [AGENTS.md](../../../../AGENTS.md)): strict TS no `any`; no `console.*` in `src/`; Zod at boundaries; files < 500 lines; ADR refs in `docs/adr/`; ASCII-only.
3. **Testing** -- vitest covers new behaviour; AAA; no sleeps; coverage holds (lines >= 80, branches >= 75).
4. **Security** -- path traversal -> [pathGuard.ts](../../../../src/tools/handlers/pathGuard.ts); secrets -> [secretPaths.ts](../../../../src/utils/secretPaths.ts); command injection on new spawn/exec; no new outbound calls in production paths.
5. **Design** -- no dead code, no commented-out blocks, no premature abstraction.
6. **Docs** -- README / ARCHITECTURE / `docs/v<version>/` / DEVLOG updated when behaviour or boundaries change.

## Phase E: Classify

Severity (`blocker` / `major` / `minor` / `nitpick` / `question`) x confidence (`high` / `medium` / `low`). Drop `minor` x `low`. Keep `question` at any confidence. Group by file.

## Phase F: Emit review body (read-only)

Markdown with sections: `## Walkthrough` (one short paragraph), `## Per-file analysis` (per file: `- [<severity>/<confidence>] <finding>. Fix: <one or two sentences>.`), `## Summary` (counts per severity), `## Recommendation` (Approve / Request changes / Comment). Stop and ask: "Which findings should I apply? List by file and severity, or 'none' / 'all blockers and majors'."

## Phase G: Apply (after confirmation)

1. Edit minimally per accepted finding; no adjacent refactors.
2. Local gate: `npm run lint && npm run check && npm test && npm run deps:check && npm run catalog:check && npm run perm-tier:check`.
3. Stage only changed files (no `git add -A`).
4. Commit with conventional prefix; HEREDOC; ASCII-only; no `Co-Authored-By` / AI attribution.
5. `git push origin HEAD`.

## Constraints

Never push to `main`; never force-push without explicit confirmation; never bypass hooks on others' PRs; no external review-as-service call; no fork-flow.

$ARGUMENTS
