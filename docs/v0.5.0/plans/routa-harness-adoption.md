# Plan — Routa Harness Adoption

**Project**: Gemma Code
**Version**: v0.5.0
**Slug**: routa-harness-adoption
**Plan Type**: Feature / Enhancement
**Created**: 2026-04-24
**Source Comparison**: [docs/v0.5.0/comparison-routa.md](../comparison-routa.md)
**Scope Filter**: `all` (P0 + P1 + P2 + P3)
**Hard Constraint**: 100% offline-first single-GPU. No runtime network egress, no cloud APIs, no Tauri/Axum/Drizzle/Postgres infrastructure, no `api-contract.yaml` dual-backend pattern, no Storybook + governance workflow, no Entrix Rust crate, no `prepare-commit-msg` co-author template (forbidden by `CLAUDE.md`).

**Goal**: Adopt all 13 in-scope items from the routa comparison report so that Gemma Code's Claude Code harness gates tool calls / sessions / prompts before they enter the agent loop, sub-agent specialist prompts are externalized for user customization, repository hygiene is enforced through husky and dependency-cruiser, and architectural decisions plus refactor discipline are documented as ADRs and a published playbook — all without breaking offline-first.

## Overview

This plan adopts the 13 in-scope items from [docs/v0.5.0/comparison-routa.md](../comparison-routa.md), grouped into 5 dependency-ordered phases. Phase 1 stands up the Claude Code harness layer (`.claude/settings.local.json` with PreToolUse / SessionStart / UserPromptSubmit hooks) — this is the load-bearing scaffolding for everything else and must come first. Phase 2 externalizes the four sub-agent specialist prompts (`research`, `verification`, `planning`, plus the orchestration role) so users can override them without recompiling, with characterization tests guaranteeing identical pre-/post-refactor behavior. Phase 3 lands local-development hygiene (husky pre-commit + commit-msg, dependency-cruiser baseline, project-local `.claude/commands/`). Phase 4 is documentation discipline — four ADRs, a mermaid module-dependency diagram, a refactor playbook, and the docs/issues template. Phase 5 closes the loop with `.github/CODEOWNERS` and a branch-cleanup workflow.

The user-visible delta is small but high-leverage: hooks fire before tool execution to add a defense-in-depth layer over `pathGuard.ts` and `secretPaths.ts`; sub-agent prompts can be tuned by editing Markdown files; commits are blocked at git time if they fail lint or contain non-ASCII characters; and the architectural intent of memory, compaction, sub-agent isolation, and tool tiers is captured for posterity. Every hook target is < 50 ms p99 (asserted in benchmarks), so the harness layer is invisible at runtime.

Success is measured against three artifacts: characterization tests that lock the current `SubAgentManager` / `ConfirmationGate` / `GitSafetyNet` / `ContextCompactor` behavior before the externalization refactor; integration tests for each hook with synthetic Claude Code event payloads; and CI verification that husky, dependency-cruiser, ADR presence, and the new diagrams all hold. The plan is complete when all 13 items have shipped, every characterization test passes, every hook fires within budget, and every documentation artifact is present.

## Phases at a Glance

| Phase | Title | Outcome | Items adopted |
|-------|-------|---------|---------------|
| 1 | Claude Code harness scaffolding | `.claude/settings.local.json` exists; PreToolUse / SessionStart / UserPromptSubmit hooks fire under 50 ms p99 with synthetic event tests | P1-2, P1-3, P2-4 |
| 2 | Specialist externalization | Sub-agent prompts loaded from `assets/specialists/*.md` via priority-chain `SpecialistLoader.ts`; characterization tests prove behavior-equivalence with the prior hardcoded path | P1-1 |
| 3 | Local development hygiene | husky pre-commit (lint) + commit-msg (ASCII-only); dependency-cruiser baseline; project-local `.claude/commands/` for `/dev-setup`, `/run-golden`, `/bench-context` | P2-1, P2-2, P3-3 |
| 4 | Documentation discipline | ADR-0002...0005 backfill; mermaid module-dependency diagram in `ARCHITECTURE.md`; refactor / characterization playbook; docs/issues template | P2-3, P2-5, P3-4, P3-5 |
| 5 | Repository governance | `.github/CODEOWNERS`; `.github/workflows/branch-cleanup.yml` for stale dependabot/copilot/feature branches | P3-1, P3-2 |

**Explicitly out of scope** (already filtered by the hard constraint, recorded for traceability):

- `prepare-commit-msg` co-author template — direct conflict with `CLAUDE.md` rule "Never add `Co-Authored-By` lines"
- Tauri / Axum / Drizzle / Postgres infrastructure — out of process-topology scope
- `api-contract.yaml` dual-backend parity — single-process VS Code extension
- Storybook + governance workflow — no UI component library
- Entrix Rust crate (fast/normal/complete fitness tiers) — Gemma's existing CI tier (fast unit, nightly integration, weekly installer) already mirrors this; the Rust crate's complexity is not warranted
- Page-snapshot visual regression — webview surface area too small to justify
- Issue-enricher / issue-garbage-collector workflows — defer; useful only once issue volume grows

---

## Phase 1: Claude Code Harness Scaffolding

**Goal**: Stand up `.claude/settings.local.json` with three hooks (PreToolUse, SessionStart, UserPromptSubmit) backed by Node-based scripts in `scripts/hooks/`, each completing under a 50 ms p99 budget.

**Prerequisites**: None.

**Stability Gate**: All three hooks fire on synthetic Claude Code event payloads (tested via `tests/integration/hooks/`); each hook completes under 50 ms p99 (`tests/benchmarks/hooks.bench.ts`); existing `pathGuard.ts` / `secretPaths.ts` / `GitSafetyNet.ts` test suites remain green; `npm run lint` and `npm run build` clean.

### Sub-tasks

#### 1.1 — Bootstrap `.claude/settings.local.json` and PreToolUse tool-permission hook

**Objective**: Create `.claude/settings.local.json` with a PreToolUse hook on Bash / Write / Edit that re-validates the operation against the existing path guard and secret-path denylist as a defense-in-depth check.

**Prompt**:
> You are working on Gemma Code v0.5.0 (TypeScript VS Code extension; offline-first; uses Ollama + Gemma 4). Bootstrap the Claude Code harness layer.
>
> Create `.claude/settings.local.json` with the following structure:
>
> ```json
> {
>   "permissions": { "allow": [], "deny": [] },
>   "hooks": {
>     "PreToolUse": [
>       { "matcher": "Bash|Write|Edit", "hooks": [{ "type": "command", "command": "node scripts/hooks/check-tool-permission.mjs" }] }
>     ]
>   }
> }
> ```
>
> Create `scripts/hooks/check-tool-permission.mjs` (Node ESM, no external dependencies — use only Node built-ins) that:
>
> - Reads the Claude Code hook event from stdin (JSON: `{ tool_name, tool_input }`).
> - For Bash: parses the command and rejects any path argument matching the secret-path denylist patterns from `src/tools/handlers/secretPaths.ts` (re-export the patterns into `scripts/hooks/lib/secret-paths.mjs` so the hook does not import TypeScript).
> - For Write / Edit: extracts the target file path from `tool_input.file_path`. Rejects if the path is outside the workspace root OR matches the secret-path denylist.
> - Exits 0 to allow; exits 2 with a stderr message `BLOCKED: <reason>` to deny (Claude Code treats exit code 2 as a hook denial per the harness contract).
> - Total budget: < 50 ms wall-clock.
>
> Mirror the rules — do not duplicate them. Create `scripts/hooks/lib/secret-paths.mjs` that exports `SECRET_PATH_PATTERNS` as the canonical list, then update `src/tools/handlers/secretPaths.ts` to re-import from it (so TypeScript and the hook share one source). Keep the existing `gemma-code.secretPathDenyExtra` user-extension support.
>
> Tests:
> - `tests/unit/hooks/check-tool-permission.test.ts`: feed synthetic payloads (path-traversal, secret-path, allowed file inside workspace) via `child_process.spawn` and assert exit codes.
> - `tests/integration/hooks/preToolUse.test.ts`: full round-trip through a fake Claude Code event.
> - `tests/benchmarks/hooks.bench.ts`: assert p99 < 50 ms for each event shape.
>
> Constraints:
> - Offline-first: no network calls. Pure Node built-ins.
> - The hook must short-circuit fast — no SQLite open, no large file reads. The point is defense in depth without latency cost.
> - Do not weaken existing `pathGuard.ts` / `secretPaths.ts` runtime checks — the hook is additive.
>
> Acceptance: full Vitest suite green; benchmark p99 within budget; manually verifiable by triggering a Claude Code Bash on `.env` and observing the hook denial.

---

#### 1.2 — SessionStart git-state hook

**Objective**: Add a SessionStart hook that asserts the current git branch is not `main` and the working tree has no uncommitted destructive changes before the agent is permitted to start.

**Prompt**:
> Continuing the Gemma Code routa-harness adoption. Add a SessionStart hook to `.claude/settings.local.json`:
>
> ```json
> "SessionStart": [
>   { "hooks": [{ "type": "command", "command": "node scripts/hooks/check-git-control-plane.mjs" }] }
> ]
> ```
>
> Create `scripts/hooks/check-git-control-plane.mjs` that:
>
> - Reads the SessionStart hook event from stdin.
> - Runs `git rev-parse --abbrev-ref HEAD` via `child_process.execSync`. If the result is `main` or `master`, exit 2 with `BLOCKED: agent session may not start on a protected branch (current: main); checkout a feature branch first`.
> - Runs `git status --porcelain`. Counts modified files. If > 50 files are dirty, exit 2 with a warning explaining the blast-radius concern. (50 is conservative; tunable via env var `GEMMA_HOOK_DIRTY_LIMIT`.)
> - Exits 0 otherwise.
> - Budget: < 50 ms p99 (git is fast on a sane repo).
>
> Mirror the policy that `src/guardrails/GitSafetyNet.ts` already encodes — do not duplicate logic. Reuse via a shared utility module `scripts/hooks/lib/git-control.mjs`.
>
> Tests:
> - `tests/unit/hooks/check-git-control-plane.test.ts`: synthetic payloads against a temp git repo (`fs.mkdtempSync` + `git init`); assert blocked-on-main, blocked-on-too-dirty, and allowed-on-feature-branch.
> - `tests/benchmarks/hooks.bench.ts`: extend with the SessionStart shape.
>
> Constraints:
> - Offline-first: rely only on local `git` binary (already a hard requirement).
> - Hook must be a no-op if the workspace is not a git repo (exit 0 with a single stderr warning).
> - The dirty-limit env-var override must be documented in `CONTRIBUTING.md`.
>
> Acceptance: full Vitest suite green; benchmark p99 within budget.

---

#### 1.3 — UserPromptSubmit prompt-policy hook

**Objective**: Add a UserPromptSubmit hook that scans the outgoing user prompt for accidentally-pasted secrets (API keys, JWTs, common token patterns) and blocks submission if found.

**Prompt**:
> Continuing the Gemma Code routa-harness adoption. Add a UserPromptSubmit hook to `.claude/settings.local.json`:
>
> ```json
> "UserPromptSubmit": [
>   { "hooks": [{ "type": "command", "command": "node scripts/hooks/check-prompt-policy.mjs" }] }
> ]
> ```
>
> Create `scripts/hooks/check-prompt-policy.mjs` that:
>
> - Reads the prompt event from stdin.
> - Runs a small set of well-known secret-pattern regexes against the prompt body. Use the gitleaks public ruleset as a reference but ship only a curated subset (~10 patterns) to keep runtime cost bounded:
>   - AWS access key (`AKIA[0-9A-Z]{16}`)
>   - GitHub PAT (`ghp_[A-Za-z0-9]{36}`)
>   - JWT (`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*`)
>   - Slack token (`xox[baprs]-[A-Za-z0-9-]{10,}`)
>   - Anthropic API key (`sk-ant-[A-Za-z0-9_-]{20,}`)
>   - OpenAI API key (`sk-[A-Za-z0-9]{48}`)
>   - Generic high-entropy 40+ char hex / base64 strings (with bounded false-positive rate)
>   - SSH private key header (`-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----`)
>   - PEM private key (`-----BEGIN PRIVATE KEY-----`)
>   - Slack webhook URL (`https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+`)
> - Apply each pattern with a 5 ms timeout per regex (cumulative budget ≤ 50 ms p99).
> - On a match, exit 2 with `BLOCKED: prompt contains a likely <pattern-name>; remove or obfuscate before submitting`.
> - Otherwise exit 0.
>
> Make the pattern list overrideable via a workspace-local file `.gemma-code/prompt-policy.json` (additive only — users can extend, not weaken). Document in `CONTRIBUTING.md`.
>
> Tests:
> - `tests/unit/hooks/check-prompt-policy.test.ts`: positive matches for each shipped pattern; negative for normal prose; ReDoS-resistant by construction (use `RegExp` with bounded quantifiers; reject patterns containing nested quantifiers in the workspace-local override).
> - `tests/benchmarks/hooks.bench.ts`: extend with a 64 KB prompt fixture; assert p99 < 50 ms.
>
> Constraints:
> - Offline-first: pure regex; no network egress.
> - False positives are allowed-but-discouraged. Provide a per-pattern allowlist mechanism in the workspace override.
> - Workspace-local override is additive: builtin patterns cannot be disabled.
>
> Acceptance: full Vitest suite green; benchmark p99 within budget; documented in `CONTRIBUTING.md`.

---

#### 1.4 — Phase 1 testing and stabilization

**Objective**: Generate and run all Phase 1 tests; verify hook latency budget; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 1 of the routa-harness adoption (`docs/v0.5.0/plans/routa-harness-adoption.md`). Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure or warning.
> 2. Run `npm run bench -- tests/benchmarks/hooks.bench.ts` and confirm p99 < 50 ms for each of the three hooks.
> 3. Manual smoke: in a fresh Claude Code session against this workspace, attempt:
>    - `Bash: cat .env` — must be denied with the secret-path message.
>    - `Write: out.txt outside workspace` — must be denied with the path-guard message.
>    - SessionStart on `main` branch — must be denied with the protected-branch message.
>    - Submit a prompt containing a fake AWS access key (`AKIA1234567890123456`) — must be denied.
> 4. Confirm no regressions in existing `pathGuard.ts`, `secretPaths.ts`, `GitSafetyNet.ts` test suites.
> 5. After all tests pass, run `/generate-session-history` to document Phase 1.
>
> Do not advance to Phase 2 until every step above is fully verified.

---

### Phase 1 Exit Checklist

- [ ] `.claude/settings.local.json` exists with three hooks registered
- [ ] `scripts/hooks/check-tool-permission.mjs`, `check-git-control-plane.mjs`, `check-prompt-policy.mjs` present
- [ ] `scripts/hooks/lib/secret-paths.mjs` is the single source of truth; `src/tools/handlers/secretPaths.ts` re-imports
- [ ] All hook unit + integration tests green
- [ ] `tests/benchmarks/hooks.bench.ts` p99 < 50 ms per hook
- [ ] Manual smoke pass for all four denial scenarios
- [ ] No regressions in path-guard / secret-path / git-safety-net suites
- [ ] `CONTRIBUTING.md` updated with hook docs
- [ ] Session history generated

---

## Phase 2: Specialist Externalization

**Goal**: Move sub-agent system prompts out of compiled TypeScript into `assets/specialists/*.md` Markdown+YAML-frontmatter files, loaded via a priority-chain `SpecialistLoader.ts` (workspace override → bundled → hardcoded fallback). Behavior must be byte-equivalent to the current hardcoded path under the bundled-default profile.

**Prerequisites**: Phase 1 (the harness should already be in place; specialist customization that violates policy should fail at the hook layer, not at the loader layer).

**Stability Gate**: Characterization tests written *before* the refactor capture the current `SubAgentManager` system-prompt output for each role (research, verification, planning); the refactored loader produces byte-identical strings on the bundled-default profile; a workspace override at `.gemma-code/specialists/research.md` correctly takes priority; falling back to the hardcoded prompt when the bundled file is missing also produces byte-identical strings.

### Sub-tasks

#### 2.1 — Characterization tests for current SubAgentManager prompt output

**Objective**: Lock the current behavior of `src/agents/SubAgentManager.ts` and `src/agents/SubAgentPrompts.ts` with characterization tests *before* any refactor — so the externalization is provably behavior-preserving.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 2 step 1.
>
> Create characterization tests at `tests/unit/agents/SubAgentManager.characterization.test.ts` that assert:
>
> - `SubAgentManager.spawn('research', { ... })` produces a system prompt containing exactly the expected sub-strings (use a few golden snippets — full byte-equality is too brittle if the prompt is built from templates).
> - Same for `verification` and `planning`.
> - Tool-scope is exactly the current set per role (research = no write tools; verification = no delete tools; planning = no terminal tools).
> - The hardcoded fallback path (currently the only path) produces the same prompts as the to-be-added bundled-Markdown path will.
>
> Approach:
> - Capture the current full system prompt as a snapshot file in `tests/snapshots/specialists/<role>.txt` (one snapshot per role). Use Vitest's snapshot API with `toMatchFileSnapshot`.
> - Lock the tool-scope as a JSON snapshot.
>
> Constraints:
> - Do NOT change `SubAgentManager.ts` or `SubAgentPrompts.ts` in this sub-task. The point is to create a behavior anchor before any refactor.
> - Exclude any non-deterministic content (timestamps, session IDs) from the snapshot capture.
>
> Acceptance: 4 snapshots present (research, verification, planning, plus the orchestration role from `src/orchestration/PlannerAgent.ts` if applicable); `npm run test -- tests/unit/agents/SubAgentManager.characterization.test.ts` green; the same test re-run produces no diff.

---

#### 2.2 — `SpecialistLoader` priority chain + bundled Markdown specialists

**Objective**: Add `src/agents/SpecialistLoader.ts` that loads role definitions from a priority chain (workspace override → bundled `assets/specialists/*.md` → hardcoded fallback), and convert `SubAgentManager` to use it.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 2 step 2.
>
> Externalize sub-agent specialist prompts:
>
> 1. Create `assets/specialists/` with one Markdown file per role:
>    - `assets/specialists/research.md`
>    - `assets/specialists/verification.md`
>    - `assets/specialists/planning.md`
>    - `assets/specialists/orchestration.md` (if used by `PlannerAgent`)
>
>    Each file uses YAML frontmatter:
>    ```markdown
>    ---
>    role: research
>    modelTier: balanced
>    toolScope: ["read_file", "list_directory", "grep_codebase", "tail_output", "get_tool_schema"]
>    ---
>    # Research Agent
>    
>    [body — system prompt content]
>    ```
>
>    The body must reproduce the current hardcoded prompt string verbatim (use the snapshots from sub-task 2.1 as the source of truth).
>
> 2. Create `src/agents/SpecialistLoader.ts` exposing:
>    - `class SpecialistLoader { load(role: SubAgentRole): Promise<Specialist> }`
>    - `type Specialist = { role: string; modelTier: HardwareTier; toolScope: string[]; systemPrompt: string; provenance: 'workspace' | 'bundled' | 'hardcoded' }`
>    - Priority chain (in order):
>      1. **Workspace override**: `<workspace>/.gemma-code/specialists/<role>.md` if it exists and parses successfully.
>      2. **Bundled**: `<extension-install-dir>/assets/specialists/<role>.md`.
>      3. **Hardcoded fallback**: the existing `SubAgentPrompts.ts` strings (do not delete; keep as last-resort).
>    - On parse failure for the workspace override, fall through to bundled and emit a one-time warning log.
>    - Validate frontmatter via Zod (already a dependency): role must be a known string; modelTier must be `constrained | balanced | full`; toolScope must be an array of known tool names.
>
> 3. Refactor `src/agents/SubAgentManager.ts` to call `SpecialistLoader.load(role)` instead of importing `SubAgentPrompts` directly. Keep `SubAgentPrompts.ts` as the hardcoded-fallback source.
>
> 4. Re-run the characterization tests from sub-task 2.1 — they MUST still pass (byte-equivalence on the bundled path proves the refactor is non-behavior-changing).
>
> 5. Add new tests at `tests/unit/agents/SpecialistLoader.test.ts`:
>    - Workspace override is loaded when present.
>    - Bundled file is loaded when no workspace override.
>    - Hardcoded fallback is loaded when both bundled and workspace files are missing (simulate by stubbing `fs.access`).
>    - Invalid YAML in workspace override falls through to bundled with a warning.
>    - Zod validation rejects unknown `modelTier` values.
>
> Constraints:
> - Offline-first: pure file-system I/O; no network.
> - Workspace override is additive customization; the harness layer (Phase 1) already protects against malicious overrides at tool-execution time.
> - `provenance` field must be observable in trace events (`MetricsCollector.emit('specialist.loaded', { role, provenance })`) for debugging.
> - Document the override mechanism in `CONTRIBUTING.md` and `docs/v0.5.0/architecture.md`.
>
> Acceptance: characterization tests still pass byte-equivalent; new loader tests green; full Vitest suite green; `npm run lint` clean.

---

#### 2.3 — Phase 2 testing and stabilization

**Objective**: Run all Phase 2 tests; verify behavior-equivalence; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 2 of the routa-harness adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Re-run the characterization tests from sub-task 2.1 — they MUST be byte-equivalent. If any diff, the refactor introduced a behavior change; investigate and fix.
> 3. Manual end-to-end smoke: in a Claude Code session, run `/research <query>` and confirm the spawned sub-agent receives the expected system prompt.
> 4. Manual override smoke: create `.gemma-code/specialists/research.md` with a slightly modified body; re-run `/research`; confirm the new prompt is used (verifiable in trace events).
> 5. Run the nightly Ollama integration with the workspace override in place; confirm no behavior degradation against the golden-task baseline.
> 6. After all tests pass, run `/generate-session-history` to document Phase 2.
>
> Do not advance to Phase 3 until every step above is fully verified.

---

### Phase 2 Exit Checklist

- [ ] Characterization snapshots captured before refactor and still passing after
- [ ] `assets/specialists/{research,verification,planning,orchestration}.md` present and byte-equivalent to hardcoded prompts
- [ ] `src/agents/SpecialistLoader.ts` priority chain implemented
- [ ] `src/agents/SubAgentManager.ts` consumes `SpecialistLoader`; `SubAgentPrompts.ts` remains as fallback
- [ ] Provenance metric emitted on every load
- [ ] Workspace override smoke-tested end-to-end
- [ ] `CONTRIBUTING.md` and `docs/v0.5.0/architecture.md` document the override
- [ ] Session history generated

---

## Phase 3: Local Development Hygiene

**Goal**: Add husky pre-commit (lint) + commit-msg (ASCII-only) hooks, dependency-cruiser baseline, and project-local `.claude/commands/` for routine workflows. Each addition must respect the offline-first constraint and the existing `CLAUDE.md` ASCII-only rule.

**Prerequisites**: Phase 1 (the harness scaffolding); Phase 2 (specialist externalization is independent but lands first to keep the refactor surface small in this phase).

**Stability Gate**: husky pre-commit blocks a commit with lint errors; husky commit-msg blocks a non-ASCII commit message; dependency-cruiser shows zero violations on the established baseline; `/dev-setup`, `/run-golden`, and `/bench-context` slash commands are listed by `/help` and execute their underlying scripts.

### Sub-tasks

#### 3.1 — husky pre-commit and commit-msg hooks

**Objective**: Install husky; configure pre-commit (`npm run lint` on staged files) and commit-msg (ASCII-only enforcement) hooks; document the `--no-verify` escape hatch.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 3 step 1.
>
> Add husky-based git hooks:
>
> - `npm install --save-dev husky lint-staged`
> - `npx husky init`
> - Replace `.husky/pre-commit` with: `npx lint-staged` (do NOT run the full `npm run lint` — too slow on large repos; restrict to staged TS files).
> - Add `lint-staged` config to `package.json`:
>   ```json
>   "lint-staged": {
>     "src/**/*.ts": ["eslint --max-warnings=0"],
>     "tests/**/*.ts": ["eslint --max-warnings=0"]
>   }
>   ```
> - Create `.husky/commit-msg` that reads the message from `$1` and rejects if it contains any byte > 0x7F (i.e. non-ASCII). Reject reason: "commit message must be ASCII-only per CLAUDE.md". Use a small portable shell-or-node check; **do not** require an additional commitlint dependency in this version (commitlint is parked for Phase 5 of the token-optimizer-adoption plan, which has its own scope).
>
> Document in `CONTRIBUTING.md`:
> - The pre-commit and commit-msg hooks; what they enforce.
> - The `git commit --no-verify` escape hatch for hot-fix scenarios; when it is appropriate.
> - The expected ASCII-only convention (which already exists in `CLAUDE.md`; this just operationalizes it).
>
> Tests:
> - `tests/unit/hooks/commit-msg.test.ts`: invoke the hook against an ASCII fixture (allowed), an em-dash fixture (rejected), a CJK fixture (rejected), and an empty fixture (allowed).
> - Manual: a commit with `git commit -m "feat: test em — dash"` is rejected; with `git commit -m "feat: ascii only"` is allowed.
>
> Constraints:
> - Hooks must run in < 1 s on a small staged-files set; lint-staged scopes the work.
> - Do not require Node ≥ 20 for husky; verify it works on the Node 18 we still support.
> - The hook must NOT inject any `Co-Authored-By` template — `CLAUDE.md` forbids it.
>
> Acceptance: pre-commit blocks a lint-error; commit-msg blocks an em-dash; `--no-verify` lets both through (documented).

---

#### 3.2 — dependency-cruiser baseline

**Objective**: Add `dependency-cruiser` codifying current module-boundary rules (e.g. `src/llm/` is the only Ollama caller; `src/tools/` cannot import from `src/panels/`); capture the present graph as the baseline.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 3 step 2.
>
> Add dependency-cruiser to enforce module-boundary rules:
>
> - `npm install --save-dev dependency-cruiser`
> - Create `configs/dependency-cruiser.cjs` with rules:
>   - `no-llm-outside-llm-folder`: only files under `src/llm/` may import from `src/llm/OllamaClient.ts` or `src/llm/OllamaHttp.ts` (everything else routes through the `src/llm/types.ts` port).
>   - `no-panels-from-tools`: `src/tools/**` cannot import from `src/panels/**`.
>   - `no-tools-from-storage`: `src/storage/**` cannot import from `src/tools/**`.
>   - `no-storage-from-panels`: `src/panels/**` cannot import directly from `src/storage/**` (must go through the messaging layer in `src/panels/messages.ts`).
>   - `no-circular`: standard circular dependency rule (already a built-in dependency-cruiser preset).
>
> - Add npm scripts:
>   - `"deps:check": "depcruise --config configs/dependency-cruiser.cjs src tests"`
>   - `"deps:graph": "depcruise --config configs/dependency-cruiser.cjs --output-type dot src | dot -Tsvg > docs/v0.5.0/dep-graph.svg"`
>
> - Run `npm run deps:check` against the current codebase. **Expect violations** initially. Capture each violation; either:
>   - Fix it (preferred — the rule is correct and the import is a regression).
>   - Add a temporary `comment: "baseline-2026-04-24; ratchet by v0.5.0"` to the rule's `from.pathNot` so the violation is grandfathered with an expiration. Document each grandfathered case in `docs/adr/` (forward reference; ADRs land in Phase 4).
>
> - Add a CI job to `.github/workflows/ci.yml` that runs `npm run deps:check` and fails on any non-grandfathered violation.
>
> Tests:
> - The CI job is the test. Validate locally with `npm run deps:check`.
>
> Constraints:
> - The baseline is allowed to be imperfect; the ratchet is the contract. Document the expiration date for each grandfathered exception.
> - The dot graph generation is optional in CI (requires graphviz); make it a local-only convenience.
>
> Acceptance: `npm run deps:check` exits 0 against the established baseline; CI job present and green.

---

#### 3.3 — Project-local `.claude/commands/` for routine workflows

**Objective**: Add three project-local Claude Code commands that codify common Gemma Code dev workflows.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 3 step 3.
>
> Create three project-local Claude Code commands in `.claude/commands/`:
>
> - `.claude/commands/dev-setup.md`: prompt encapsulating the `scripts/dev-setup.sh` / `dev-setup.ps1` flow with platform detection. The command body should read like an executable prompt that walks through Node check, deps install, golden-task generation, build, and a smoke test of `npm test`.
>
> - `.claude/commands/run-golden.md`: prompt for running the full golden-task suite (`python tests/golden/framework/run_all.py`), interpreting the regression report, and updating baselines if intentional.
>
> - `.claude/commands/bench-context.md`: prompt for running `tests/benchmarks/context-compaction.bench.ts` and `tests/benchmarks/tool-execution.bench.ts`, capturing p50/p99, and comparing against `tests/benchmarks/baselines/` if present.
>
> Each command file follows the standard Claude Code command format:
> ```markdown
> # <Title>
>
> <description>
>
> ## Steps
> 1. ...
> 2. ...
>
> ## Acceptance
> - ...
>
> ARGUMENTS: $ARGUMENTS
> ```
>
> Update `README.md` "Slash commands" section to note that these are project-local additions discovered automatically by Claude Code (not built into the extension's `CommandRouter.ts`).
>
> Tests:
> - Manual: invoke each command in a Claude Code session and confirm the steps execute.
>
> Constraints:
> - Project-local commands are Claude Code conventions, distinct from the in-extension `CommandRouter.ts` slash commands. Do not collide names — these are `/dev-setup`, `/run-golden`, `/bench-context`; the extension's commands like `/research`, `/plan` etc. are unaffected.
> - Each command body must be self-contained (no references to "the rest of this document").
>
> Acceptance: three command files exist; manually invokable; README documents them.

---

#### 3.4 — Phase 3 testing and stabilization

**Objective**: Run all Phase 3 tests; verify hooks, dependency-cruiser, and project-local commands; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 3 of the routa-harness adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`, `npm run deps:check`. Fix every failure.
> 2. Manual: stage a file with a lint error; attempt `git commit -m "feat: test"`; confirm pre-commit blocks. Use `--no-verify` to bypass; confirm it works as documented.
> 3. Manual: attempt `git commit -m "feat: test em — dash"`; confirm commit-msg blocks. `git commit -m "feat: test ascii"`; confirm allowed.
> 4. Manual: invoke `/dev-setup`, `/run-golden`, `/bench-context` in a Claude Code session against this workspace; confirm each runs to completion.
> 5. Run `npm run deps:graph` (if graphviz is installed) and visually inspect `docs/v0.5.0/dep-graph.svg`.
> 6. After all tests pass, run `/generate-session-history` to document Phase 3.
>
> Do not advance to Phase 4 until every step above is fully verified.

---

### Phase 3 Exit Checklist

- [ ] husky installed; pre-commit + commit-msg hooks active
- [ ] lint-staged config in `package.json`
- [ ] `configs/dependency-cruiser.cjs` present with 4+ rules; CI job `deps:check` green
- [ ] All grandfathered exceptions documented with expiration dates
- [ ] `.claude/commands/dev-setup.md`, `run-golden.md`, `bench-context.md` present and manually verified
- [ ] `CONTRIBUTING.md` and `README.md` updated
- [ ] Session history generated

---

## Phase 4: Documentation Discipline

**Goal**: Backfill four ADRs that capture the architectural intent of memory, compaction, sub-agent isolation, and tool permission tiers; add a mermaid module-dependency diagram to `ARCHITECTURE.md`; publish a refactor / characterization-test playbook; ship a docs/issues/ template.

**Prerequisites**: Phase 1 (harness scaffolding for the dependency rules referenced in ADR-0005); Phase 2 (specialist externalization context for ADR-0004); Phase 3 (dependency-cruiser baseline that the mermaid diagram visualizes).

**Stability Gate**: 4 new ADRs present in `docs/adr/`; mermaid diagram renders correctly in `ARCHITECTURE.md`; refactor playbook published; docs/issues/ template usable on a real issue; `docs/adr/README.md` index updated.

### Sub-tasks

#### 4.1 — ADR-0002: Memory Subsystem Layering

**Objective**: Capture the four-layer memory design (Working / Episodic / Semantic / Graph) as ADR-0002 — the rationale, the alternatives considered, and the consequences.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 1.
>
> Create `docs/adr/0002-memory-subsystem-layering.md` following the template in `docs/adr/template.md`:
>
> Sections:
> - **Status**: Accepted (codifies existing design)
> - **Context**: What problem the memory subsystem solves; why a single store was insufficient.
> - **Decision**: Four layers (Working in `src/storage/WorkingMemory.ts`, Episodic in `EpisodicMemory.ts`, Semantic in `MemoryStore.ts` with FTS5 + nomic-embed-text embeddings, Graph in `GraphMemory.ts` with `GraphQueryEngine.ts`); unified retrieval via `UnifiedMemoryRetriever.ts` with budget distribution (3% of context).
> - **Alternatives considered**: Single FTS5 store; vector-only store; graph-only store. Why each was insufficient.
> - **Consequences**: Pros (selective recall, graceful degradation when Ollama is down) and cons (4 SQLite files; schema migrations × 4; consolidation logic complexity).
> - **References**: `src/storage/MemoryStore.ts`, `src/storage/UnifiedMemoryRetriever.ts`, the existing comparison reports.
>
> Update `docs/adr/README.md` index to include the new ADR.
>
> Constraints:
> - The ADR records what *is*, not what *should be*. Resist any urge to refactor while writing.
> - Cite concrete file paths; use the markdown link format `[filename.ts](src/storage/filename.ts)`.
> - Keep under 800 words.
>
> Acceptance: ADR file present; index updated; renders correctly when previewed.

---

#### 4.2 — ADR-0003: Compaction Strategy Ordering

**Objective**: Document the 6-stage compaction pipeline (`ToolResultClearing` → `SlidingWindow` → `CodeBlockTruncation` → `RegenerateFromSource` → `LlmSummary` → `EmergencyTrim`) — why this order, what each stage costs, what triggers each.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 2.
>
> Create `docs/adr/0003-compaction-strategy-ordering.md` following the template:
>
> Sections:
> - **Status**: Accepted
> - **Context**: Why context compaction is needed (Gemma 4 has 128K context; multi-turn agentic sessions exceed it); why a single strategy is insufficient.
> - **Decision**: 6 stages in the order documented in `src/chat/CompactionStrategy.ts`. For each stage:
>   - Trigger (token-count threshold, presence of large tool results, etc.)
>   - Cost (cheap vs. LLM-call expensive)
>   - Loss profile (lossless vs. summarization)
> - **Alternatives considered**: Single sliding-window; LLM summary as the only stage; truncation only.
> - **Consequences**: Multi-stage pipeline preserves more salient context but is harder to reason about; ordering matters because earlier cheap stages prevent expensive LLM calls.
> - **References**: `src/chat/CompactionStrategy.ts`, `src/chat/ContextCompactor.ts`, `src/chat/RegenerateFromSource.ts`.
>
> Update `docs/adr/README.md`.
>
> Constraints:
> - Keep under 800 words. Diagrams welcome (ASCII or mermaid sequence diagram).
> - Document the *current* policy; future tuning lives in subsequent ADRs.
>
> Acceptance: ADR present; index updated.

---

#### 4.3 — ADR-0004: Sub-Agent Isolation Contract

**Objective**: Capture the sub-agent isolation contract (research = no write tools; verification = no delete tools; planning = no terminal tools) — including the new specialist-externalization mechanism from Phase 2.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 3.
>
> Create `docs/adr/0004-sub-agent-isolation-contract.md`:
>
> - **Status**: Accepted
> - **Context**: Why sub-agents need scoped tool access; what "isolation" means in Gemma's single-process model.
> - **Decision**:
>   - Three sub-agent roles: research, verification, planning.
>   - Tool scopes per role (cite `src/agents/SubAgentManager.ts`).
>   - Specialist prompts externalized via `assets/specialists/*.md` with priority chain (workspace override → bundled → hardcoded fallback) per Phase 2 of this plan.
>   - Each sub-agent gets an isolated, ephemeral conversation; results bubble up to the parent only via structured `ToolResult`.
> - **Alternatives considered**: One mega-agent with permission-tier gating; one sub-process per role.
> - **Consequences**: Smaller blast radius; user-customizable behavior; some duplication of system-prompt content; ABC-style role contract relies on convention rather than language enforcement.
> - **References**: `src/agents/SubAgentManager.ts`, `src/agents/SpecialistLoader.ts` (added in Phase 2), `assets/specialists/`.
>
> Update `docs/adr/README.md`.
>
> Constraints: under 800 words; cite the Phase 2 sub-tasks of this plan.
>
> Acceptance: ADR present; index updated.

---

#### 4.4 — ADR-0005: Tool Permission Tiers

**Objective**: Document the three permission tiers (AUTO_APPROVE / CONFIRM / DANGEROUS) — what each contains, how they interact with `editMode` and the Phase 1 PreToolUse hook.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 4.
>
> Create `docs/adr/0005-tool-permission-tiers.md`:
>
> - **Status**: Accepted
> - **Context**: Why tools need tiered confirmation; the trade-off between agent fluency and user safety.
> - **Decision**:
>   - Tier 0 AUTO_APPROVE: read-only tools (`read_file`, `list_directory`, `grep_codebase`, `tail_output`, `get_tool_schema`).
>   - Tier 1 CONFIRM: file-mutation tools (`write_file`, `edit_file`, `create_file`, `delete_file`).
>   - Tier 2 DANGEROUS: side-effecting tools (`run_terminal`, `web_search`, `fetch_page`, all MCP tools by default).
>   - Interaction with `gemma-code.editMode`: `auto` skips Tier 1 confirmation; `ask` always confirms Tier 1; `plan` produces a plan and confirms before any Tier 1+ action.
>   - Interaction with the Phase 1 PreToolUse hook: the hook is a *belt* (defense in depth); the in-process tier check is the *suspenders*. Both fire; either can deny.
> - **Alternatives considered**: Single confirmation gate; per-tool confirmation; allowlist-only.
> - **Consequences**: Users get fine-grained control; some workflows feel slow without `editMode: auto`; the harness hook adds redundancy that costs < 50 ms but eliminates a class of single-point failure.
> - **References**: `src/guardrails/PermissionTiers.ts`, `src/guardrails/ActionClassifier.ts`, `src/tools/ConfirmationGate.ts`, the PreToolUse hook from this plan's Phase 1.
>
> Update `docs/adr/README.md`.
>
> Constraints: under 800 words.
>
> Acceptance: ADR present; index updated.

---

#### 4.5 — Mermaid module-dependency diagram in ARCHITECTURE.md

**Objective**: Add a mermaid graph to `ARCHITECTURE.md` visualizing the module-dependency relationships codified in `configs/dependency-cruiser.cjs` (Phase 3.2).

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 5.
>
> Add a mermaid module-dependency diagram to `ARCHITECTURE.md`:
>
> - Insert under a new heading `## Module Dependency Graph`, after the existing high-level diagram.
> - Use mermaid `flowchart LR` or `flowchart TD` (whichever reads better at typical viewport widths).
> - Include the major top-level modules: `extension.ts`, `panels/` (webview), `runtime/GemmaRuntime`, `chat/` (PromptBuilder, StreamingPipeline, CompactionStrategy, ContextCompactor), `agents/` (SubAgentManager, SpecialistLoader), `orchestration/` (Orchestrator, PlannerAgent, DAGExecutor, ReflexionEngine), `tools/` (AgentLoop, ToolRegistry, OutputRedirector, handlers/), `commands/CommandRouter`, `mcp/`, `storage/` (MemoryStore, UnifiedMemoryRetriever, ToolOutputCache (forward ref to token-optimizer plan), ChatHistoryStore, GraphMemory), `llm/` (OllamaClient, OllamaHttp), `guardrails/` (ActionClassifier, ConfirmationGate, GitSafetyNet, LoopDetector, BudgetEnforcer, PermissionTiers), `observability/` (Tracer, TraceStore, MetricsCollector, OtlpExporter), `config/`, `utils/`, `evaluation/GoldenTaskSuite`, `skills/SkillLoader`.
> - Show the **forbidden** edges as dashed red arrows annotated with the rule name (e.g. `panels --x storage [no-storage-from-panels]`). This makes the rules visible in the diagram.
> - Keep the diagram readable at one screen height; group related modules into subgraphs (e.g. `subgraph Storage`).
>
> Update the existing `ARCHITECTURE.md` ToC if present.
>
> Constraints:
> - Mermaid renders in GitHub by default; do not rely on external tooling.
> - Cite the dependency-cruiser config from Phase 3.2 explicitly so the diagram and the lint rules stay in sync.
>
> Acceptance: `ARCHITECTURE.md` renders the mermaid block correctly on GitHub preview; module list is comprehensive; forbidden edges are annotated.

---

#### 4.6 — Refactor / characterization-test playbook

**Objective**: Publish a `docs/refactor-playbook.md` capturing the discipline used in Phase 2 (characterization tests *before* refactor; behavior-equivalence as the contract).

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 6.
>
> Create `docs/refactor-playbook.md` covering:
>
> 1. **When to write characterization tests**: any refactor of a complex file (> 200 LOC) or any externalization of compiled state to runtime data.
> 2. **How to capture behavior**: snapshot APIs (`toMatchFileSnapshot`), JSON snapshots for structured outputs, sub-string assertions for content-stable strings.
> 3. **What to exclude from snapshots**: timestamps, session IDs, monotonic counters — anything that breaks determinism.
> 4. **Re-running snapshots**: the `--update-snapshots` flag, when to use it, when to refuse.
> 5. **Worked example**: the Phase 2 specialist externalization is the canonical example. Reference `tests/snapshots/specialists/*.txt` and `tests/unit/agents/SubAgentManager.characterization.test.ts`.
> 6. **Anti-patterns**: snapshot-the-world (too fragile); zero snapshots (no anchor); inline-snapshots that drift undetected.
>
> Cross-reference from `CONTRIBUTING.md` "Testing" section and from `docs/v0.5.0/test-pyramid.md`.
>
> Constraints: under 1500 words; concrete code snippets from the actual Phase 2 work.
>
> Acceptance: `docs/refactor-playbook.md` present; cross-referenced from `CONTRIBUTING.md`.

---

#### 4.7 — docs/issues/ template

**Objective**: Add a docs/issues/ directory with a YAML-frontmatter Markdown template, mirroring the routa pattern but adapted to Gemma's needs.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 4 step 7.
>
> Create `docs/issues/` and `docs/issues/_template.md`:
>
> ```markdown
> ---
> id: ISSUE-0001
> title: Short descriptive title
> state: open | in_progress | closed
> github_issue: <optional URL>
> opened: YYYY-MM-DD
> closed: YYYY-MM-DD or null
> severity: blocker | friction | optimization
> ---
>
> ## What
> One paragraph describing the observed behavior or problem.
>
> ## Why
> One paragraph explaining the root cause or motivation.
>
> ## Resolution
> Bullet list of changes that resolved (or will resolve) the issue.
>
> ## References
> - Relevant file paths
> - Related ADRs
> - Related GitHub PRs
> ```
>
> Document the pattern in `CONTRIBUTING.md` under a new "Issue records" section. Note that this is an *opt-in* convention — small issues do not need a `docs/issues/` entry; multi-week investigations or recurring patterns should.
>
> Use the severity rubric from the 7-principles article (`Blocker / Friction / Optimization`) — referenced in the parallel `docs/v0.5.0/comparison-7-principles-for-agent-friendly-clis.md` adoption.
>
> Constraints:
> - The template is a reference; populating it is voluntary. Do not retroactively backfill issues.
> - Filenames: `<id>-<short-slug>.md` (e.g. `0001-ollama-warm-up-latency.md`).
>
> Acceptance: `docs/issues/_template.md` present; documented in `CONTRIBUTING.md`.

---

#### 4.8 — Phase 4 testing and stabilization

**Objective**: Verify all 4 ADRs and ancillary docs land cleanly; iterate until stable.

**Prompt**:
> Generate and run comprehensive verification for Phase 4 of the routa-harness adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`. Fix any failures (Phase 4 is mostly documentation; expect green).
> 2. Verify all 4 new ADRs (`0002`, `0003`, `0004`, `0005`) render correctly on GitHub preview; `docs/adr/README.md` index lists them in numeric order.
> 3. Verify `ARCHITECTURE.md` mermaid block renders correctly.
> 4. Verify `docs/refactor-playbook.md` is cross-referenced from `CONTRIBUTING.md` and `docs/v0.5.0/test-pyramid.md`.
> 5. Verify `docs/issues/_template.md` is parseable as YAML frontmatter + Markdown.
> 6. Update `CHANGELOG.md` with the documentation-discipline entry.
> 7. After all checks pass, run `/generate-session-history` to document Phase 4.
>
> Do not advance to Phase 5 until every step above is fully verified.

---

### Phase 4 Exit Checklist

- [ ] ADR-0002 (memory subsystem layering) present
- [ ] ADR-0003 (compaction strategy ordering) present
- [ ] ADR-0004 (sub-agent isolation contract) present
- [ ] ADR-0005 (tool permission tiers) present
- [ ] `docs/adr/README.md` index updated
- [ ] `ARCHITECTURE.md` mermaid module-dependency diagram present
- [ ] `docs/refactor-playbook.md` published
- [ ] `docs/issues/_template.md` present
- [ ] `CONTRIBUTING.md` and `docs/v0.5.0/test-pyramid.md` cross-reference the new docs
- [ ] `CHANGELOG.md` updated
- [ ] Session history generated

---

## Phase 5: Repository Governance

**Goal**: Add `.github/CODEOWNERS` (single-author today; sets the convention for future contributors) and a branch-cleanup workflow that removes stale `dependabot/`, `copilot/`, and `feature/` branches after a configurable age.

**Prerequisites**: Phases 1–4. (Repository governance comes last because it depends on the dependabot adoption decision being settled by then; in Gemma's case Dependabot is added separately by the free-claude-code adoption plan.)

**Stability Gate**: CODEOWNERS file is recognized by GitHub UI; the branch-cleanup workflow runs successfully on a manual dispatch and reports zero accidental deletions (dry-run mode first).

### Sub-tasks

#### 5.1 — `.github/CODEOWNERS`

**Objective**: Add a `.github/CODEOWNERS` file declaring ownership of every top-level directory.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 5 step 1.
>
> Create `.github/CODEOWNERS`:
>
> ```
> # Default owner for everything in the repo
> *               @bendourthe
>
> # Critical security paths require owner review even on routine edits
> /SECURITY.md           @bendourthe
> /src/utils/ssrf.ts     @bendourthe
> /src/tools/handlers/   @bendourthe
> /src/guardrails/       @bendourthe
> /scripts/installer/    @bendourthe
> /.github/              @bendourthe
> /.claude/              @bendourthe
> ```
>
> Document the convention in `CONTRIBUTING.md`: when CODEOWNERS auto-requests a review, who has authority to merge.
>
> Constraints:
> - Single-author repo today; CODEOWNERS sets the contract for future contributors. Do not over-engineer with team aliases.
> - Use the GitHub username, not email.
>
> Acceptance: `.github/CODEOWNERS` present; GitHub UI shows the owner column on each file.

---

#### 5.2 — Branch-cleanup workflow

**Objective**: Add `.github/workflows/branch-cleanup.yml` that deletes merged or stale branches matching `dependabot/*`, `copilot/*`, and `feature/*` after a configurable age (default 30 days), in dry-run mode by default.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 5 step 2.
>
> Create `.github/workflows/branch-cleanup.yml`:
>
> - Triggers: `workflow_dispatch` (manual; default) and `schedule: cron '0 6 * * 0'` (Sunday 06:00 UTC weekly).
> - Inputs: `dry_run` (bool, default `true`); `max_age_days` (int, default `30`).
> - Steps:
>   1. Checkout (`actions/checkout@v4`).
>   2. List branches matching the pattern `^(dependabot|copilot|feature)/.+$` whose `committerdate` is older than `max_age_days`.
>   3. Cross-check against `git for-each-ref refs/heads/<branch> --merged main` — only delete branches that are *both* old AND already merged into main.
>   4. If `dry_run`: print the list to the workflow log and stop.
>   5. If not `dry_run`: delete each branch via `git push origin --delete <branch>`.
> - Output: a summary comment posted via `actions/github-script` to a tracking issue (or as a workflow summary if no tracking issue is present).
>
> Run the first scheduled execution in dry-run mode for two weeks to validate the merged-into-main check. Document this rollout plan in the workflow file's top comment.
>
> Tests:
> - Manually dispatch with `dry_run=true` against the current branch state; confirm output is sensible.
> - Manually dispatch with `dry_run=false` against a sandbox branch (`test-cleanup-fixture`) created earlier; confirm deletion.
>
> Constraints:
> - The merged-into-main check is the safety net; do not skip it. A stale-but-unmerged branch may still contain salvageable work.
> - Never delete `main`, `master`, `develop`, `release/*`, or any branch matching the protected-branches pattern.
> - Document the `--no-verify`-style escape: any branch with a `WIP:` commit on top is grandfathered.
>
> Acceptance: workflow file present; dry-run dispatch produces correct list; manual `dry_run=false` against fixture branch deletes only the fixture.

---

#### 5.3 — Phase 5 testing and stabilization (final adoption gate)

**Objective**: Run the full test, lint, dependency-cruiser, and benchmark suite; verify all 13 adoption items have shipped; document the final state.

**Prompt**:
> Gemma Code v0.5.0 routa-harness adoption — Phase 5 (FINAL stabilization).
>
> Generate and run comprehensive verification for the entire adoption:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`, `npm run deps:check`. Fix every failure.
> 2. Run `npm run bench`. **Hooks p99 must remain < 50 ms.** Confirm no regression on `tool-execution`, `context-compaction`, or `cache-hit` benchmarks.
> 3. Re-run all characterization tests from Phase 2; confirm byte-equivalence still holds.
> 4. Manually verify the harness layer: trigger a denial scenario for each of the three hooks (PreToolUse path-traversal; SessionStart on main; UserPromptSubmit with a fake AWS key); confirm each is blocked.
> 5. Manually verify all 4 ADRs render; mermaid diagram in `ARCHITECTURE.md` renders; refactor-playbook is cross-referenced; docs/issues template is parseable.
> 6. Confirm husky pre-commit + commit-msg block as expected.
> 7. Confirm `npm run deps:check` is green and CI runs it.
> 8. Confirm CODEOWNERS file is registered (visible in GitHub UI on any file).
> 9. Run the branch-cleanup workflow in `dry_run=true`; sanity-check the output.
> 10. Update `docs/v0.5.0/architecture.md` "Cache architecture" section (if added by the parallel token-optimizer plan) to also reference the harness layer.
> 11. Update `CHANGELOG.md` with the routa-harness adoption entry.
> 12. Run `/generate-session-history` to document Phase 5.
> 13. Run `/update-devlog` to capture the final summary.
>
> Do not declare the adoption complete until all 13 items in the original adoption table have shipped, every characterization test passes, every hook fires within budget, every documentation artifact is present, and the CHANGELOG is updated.

---

### Phase 5 Exit Checklist

- [ ] `.github/CODEOWNERS` present and recognized
- [ ] `.github/workflows/branch-cleanup.yml` present; first scheduled run is dry-run only
- [ ] `CONTRIBUTING.md` documents the CODEOWNERS convention and branch-cleanup rollout
- [ ] All 13 adoption items shipped (cross-reference the original Phase / Sub-task numbering)
- [ ] All characterization tests still byte-equivalent
- [ ] All hook benchmarks p99 < 50 ms
- [ ] No regressions in path-guard / secret-path / git-safety-net / sub-agent / compaction suites
- [ ] CHANGELOG entry present
- [ ] Session history + devlog updated

---

## Definition of Done (Plan-Level)

The adoption is complete when **all** of the following hold:

1. (a) **Harness fires**: PreToolUse / SessionStart / UserPromptSubmit hooks fire on every applicable Claude Code action; sub-agent prompts load from `assets/specialists/` (verified by behavior-equivalence characterization tests); husky blocks malformed/non-ASCII commits in CI; dependency-cruiser reports zero violations against the established baseline.
2. (b) **Documentation**: 4 new ADRs (0002–0005) landed; mermaid module-dependency diagram in `ARCHITECTURE.md`; characterization-test / refactor playbook published; docs/issues template usable.
3. **Latency budget**: each hook completes under 50 ms p99 (asserted via `tests/benchmarks/hooks.bench.ts`).
4. The 13 in-scope adoption items are all landed.
5. No runtime network egress added by any change; all hooks are pure Node + local git.
6. `CHANGELOG.md` reflects the harness adoption.

---

## Out of Scope (Recorded for Future Versions)

- LSTM / heavy-ML role classification for sub-agents
- `prepare-commit-msg` co-author template — direct conflict with `CLAUDE.md`
- Tauri / Axum / Drizzle / Postgres dual-backend infrastructure
- `api-contract.yaml` cross-runtime parity
- Storybook + governance workflow
- Entrix Rust crate (fast/normal/complete fitness tiers)
- Page-snapshot visual regression
- Issue-enricher / issue-garbage-collector workflows
- Full `commitlint` + `@commitlint/config-conventional` integration (parked for the token-optimizer adoption plan, Phase 5 step 2, where it is more relevant)
- Multi-author CODEOWNERS aliases (single author today)
