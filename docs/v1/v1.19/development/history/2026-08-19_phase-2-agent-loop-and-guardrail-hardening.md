# Session History - v1.19.1 Phase 2: Agent-Loop and Guardrail Hardening

**Date**: 2026-08-19
**Version**: v1.19.1
**Plan**: [../../plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md](../../plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md)
**Phase**: 2 of 2 - Agent-loop + guardrail hardening
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is true. Version bump, changelog, tag, and GitHub Release are owned by `/update release`.

## Goal

Make long-horizon autonomous runs trustworthy before any new tool surface ships: command-level hard denials in every posture, unified LoopGuards, tool self-recovery, compression reliability, a named security-posture dial, provenance-labelled screening, DNS-pinned egress, watch/hash tools, and action-introspected system prompts.

## Pre-flight

`is_final_phase` = **true** (this is the numerically last phase of this plan; adjacent v1.19.0 / v1.19.2 plans do not change that). Prior phase: Phase 1 skill-native wins (commit `3f68051` on Nexus-AI `develop`; Hub `451e508f`). Model routing: plan recommended strong / high (claude-opus-4-8 high). Cursor cannot script a switch; this session stayed on the current model (Grok 4.6), which is same-or-stronger. Visible degrade: none. No silent downshift. The user pre-authorized Phase 2, then commit, push, then `/update release`.

## 1. Starting State

- **Branch (Nexus-AI)**: `develop` (ahead of origin by the Phase 1 commit `3f68051`)
- **Branch (Nexus-Hub)**: `feat/v1.19.1-skill-native-wins` at `451e508f` (not merged)
- **Environment**: Windows 10, root Vitest suite, desktop Vitest
- **Prior session**: [2026-08-19_phase-1-skill-native-wins.md](2026-08-19_phase-1-skill-native-wins.md)
- **Plan reference**: [v1.19.1-adoption-agent-loop-and-guardrail-hardening.md](../../plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md)
- **Package version**: still 1.19.0 until `/update release`

## 2. Chronological Steps

### 2.1 Command-level hard denials (QM A3)

**Plan specification**: Data-driven deny-list for recursive deletes, destructive SQL, git history rewrites. Evaluated before allowlist and confirmation. Strictly subtractive.

**What happened**: `modules/coding/guardrails/policy.ts` is now `HARD_DENIALS` (id, family, reason, pattern). `BLOCKED_PATTERNS` is derived with specific patterns first so `findBlockedPattern("rm -rf /")` still returns `"rm -rf /"`. Families: recursive delete (`rm -rf `, `rm -fr `, `rm -r `, `rmdir /s`, `rd /s`, `remove-item -recurse`), git history (`git reset --hard`, `git push --force`, `git push -f`, `git filter-branch`, `git filter-repo`, `git rebase -i`), SQL (`drop table`, `drop database`, `truncate table`). `DELETE FROM` stays DESTRUCTIVE. `git reset` without `--hard` stays unblocked.

**Matcher fix**: `isBlocked` / `findBlockedPattern` search `${normalized} ` (trailing space after trim/collapse) so `"rm -rf "` matches `rm -rf ./tmp` and a trimmed `rm -rf`, but not `rm -rf./x`.

**Key files**: `modules/coding/guardrails/policy.ts`, `src/tools/commandBlocklist.ts`, `tests/unit/guardrails/hardDenials.test.ts`

### 2.2 Unified loop guards (Airi + Atomic + Hermes; D1)

**Plan specification**: Identical-call veto (N=5), no-action budget, error-burst, bounded queue (1+4), revisit iteration ceiling. Integrate with LoopDetector.

**What happened**: New `modules/coding/guardrails/LoopGuards.ts`. Ceiling 60 with a comment (2x old strong 30, not Hermes 500). AgentLoop always constructs LoopGuards. Identical-call recorded after execute so five calls run then halt. BLOCKED commands count toward error-burst. Queue admit drops extra tool calls with a SYSTEM message. No-action recorded on pass-state gate continue. ChatController shares one `LoopDetector` instance with `LoopGuards`. HeadlessAgentSession is not wired (DF-3).

**Key files**: `modules/coding/guardrails/LoopGuards.ts`, `src/tools/AgentLoop.ts`, `src/panels/ChatController.ts`, `tests/unit/guardrails/LoopGuards.test.ts`

### 2.3 Tool self-recovery (Hermes A2)

**Plan specification**: Spill + scrub; edit already-applied noop; search near-miss probes.

**What happened**: `editNoop.ts` (`classifyEditApply`). Used by EditFileTool and headless `edit_file`. `nearMiss.ts` plus grep empty-result probes. Grep vscode fallback extracted to `grepViaVscode` so probes work when ripgrep is missing. OutputRedirector.redirect writes `redactSecrets(output)`; `_readRedirectedFile` scrubs on read; CommandCompressor.tee scrubs before write.

**Troubleshooting**:
- **Problem**: `classifyEditApply("hello world", "hello", "hello world")` is `apply`, not noop (old_string still occurs once).
- **Resolution**: Noop case is already-applied replacement, e.g. `("const x = 2;", "const x = 1;", "const x = 2;")`.

**Key files**: `src/tools/handlers/editNoop.ts`, `src/tools/handlers/nearMiss.ts`, `src/tools/OutputRedirector.ts`

### 2.4 Context-compression patterns (Hermes A1; D13)

**Plan specification**: Per-model thresholds, micro-compaction, user-message tail, golden-task green. Do not duplicate compress_range / compress_message.

**What happened**: `isHumanUserMessage` in CompactionStrategy. SlidingWindow also anchors last N human user turns. EmergencyTrim never drops those ids. Setting `nexus.coding.compactionUserMessageTail` (default 3). ContextCompactor.microCompact() runs ToolResultClearing only; AgentLoop calls it after a tool batch. HarnessSelector.toCompressionOverlay (weak 0.7/3, mid 0.8/3, strong 0.85/5). Tests that used `new EmergencyTrim(10)` as a keep-count were updated (`new EmergencyTrim(2)` / `(1)`).

**Key files**: `modules/coding/chat/CompactionStrategy.ts`, `modules/coding/chat/ContextCompactor.ts`, `modules/coding/orchestration/HarnessSelector.ts`

### 2.5 Security-posture dial (QM A2)

**Plan specification**: Strict / Standard / Unattended as compositions. Floor clamp authoritative. No QM Dangerous no-floor mode.

**What happened**: `modules/coding/guardrails/SecurityPosture.ts`. DANGEROUS always confirms. Unattended skips CONFIRM only. Setting `nexus.coding.securityPosture`. Desktop `SecuritySettings.tsx` plus Security tab.

**Floor-bypass fix**: `getPermissionTier("run_terminal", { run_terminal: 0 })` still clamps to CONFIRM (F-003). Unattended used to skip that CONFIRM. `shouldRequireConfirmation` now always returns true when baseline is DANGEROUS. Same rule in `headlessGuards.screenHeadlessCall`. Remainder recorded as DF-5.

**Key files**: `modules/coding/guardrails/SecurityPosture.ts`, `desktop/src/pages/settings/SecuritySettings.tsx`, `tests/unit/guardrails/SecurityPosture.test.ts`, `desktop/tests/SecuritySettings.test.tsx`

### 2.6 Provenance-labelled screening (QM A5; D4)

**Plan specification**: Origin labels; web/browser/MCP never off; browser_snapshot reserved.

**What happened**: `toolResultOrigin.ts`; `ToolResult.origin` stamped in ToolRegistry.execute; formatToolResult includes origin (defaults to `workspace_file`). Taxonomy: user, workspace_file, terminal, web_fetch, mcp_tool, browser_snapshot reserved. AgentLoop `_screenInboundResult` always screens web/mcp/browser. Strict screens all. Uses InboundClassifier when wired AND `inboundClassifierEnabled`; else PromptInjectionScanner + `[UNTRUSTED CONTENT origin=...]` banner. Classifier throw stays fail-open. Do not merge the two PromptInjectionScanner modules.

**Troubleshooting**:
- **Problem**: Web screening never-off broke inbound-classifier tests that expected no banner when the classifier was disabled.
- **Resolution**: Tests now expect the heuristic `[UNTRUSTED CONTENT origin=web_fetch]` banner. `useClassifier` requires `inboundClassifierEnabled`.

**Key files**: `modules/coding/guardrails/toolResultOrigin.ts`, `src/tools/types.ts`, `src/tools/ToolRegistry.ts`, `src/tools/AgentLoop.ts`

### 2.7 DNS-pinned egress (Hermes A6)

**Plan specification**: Resolve once, validate, connect to pinned address. Rebinding test.

**What happened**: `fetchWithSsrfGuard` uses `pinValidatedUrl` (one lookup per hop, connect to first public IP, Host header). `fetchImpl` option for tests. Rebinding test: first public, second private, assert fetch URL is the pinned IP and lookup once.

**Key files**: `modules/coding/utils/ssrf.ts`

### 2.8 watch_path / hash_file (Atomic C2)

**Plan specification**: Read-only, AUTO_APPROVE, reject out-of-workspace.

**What happened**: Builtin names, AUTO_APPROVE, SAFE_TOOLS, ToolCatalog, OPTIONAL_SPECIALTY_TOOLS (do not blow 15-tool cap), eager register. Handlers in `src/tools/handlers/observe.ts`. Headless twins. PATH_PARAMS in headlessGuards. Out-of-workspace rejected.

**Troubleshooting**:
- **Problem**: `vi.spyOn(fs, "readFileSync")` fails (Cannot redefine property).
- **Resolution**: Hash success writes a real file under `MOCK_WORKSPACE_ROOT`.
- **Problem**: Duplicate `params` / `describe` in observe.test.ts after an edit.
- **Resolution**: Removed the duplicate block. 7/7 pass.

**Key files**: `src/tools/handlers/observe.ts`, `tests/unit/tools/handlers/observe.test.ts`

### 2.9 Action-introspected system prompts (Airi A4)

**Plan specification**: Generated per-tool docs from the registry. Test tool surfaces. Token cost bounded.

**What happened**: `modules/coding/chat/ToolPromptAssembler.ts`. PromptBuilder `_buildToolDeclarations` uses it. PromptContext.registeredToolNames so a test tool surfaces. Token budget 8000.

**Key files**: `modules/coding/chat/ToolPromptAssembler.ts`, `src/chat/PromptBuilder.ts`

### 2.10 Testing and stabilization

**Plan specification**: Integration pass over each guard, hard-denied in unattended, seeded injection on web origin, spill/noop/near-miss. Full suite + lint + typecheck + golden-task. Update CI. Session history.

**What happened**: `tests/integration/guardrails/v1.19.1-hardening.test.ts`. CI already runs full Vitest on `test-ts`; concurrency cancel-in-progress and npm cache already present. No silent workflow rewrite. Golden-task unit suite is inside the 5054.

**Troubleshooting**:
- **Problem**: Session rewrite dropped imports (`fs`/`path` in OutputRedirector; `resolveInsideWorkspace` in filesystem; `getSettings` in ToolRegistry).
- **Resolution**: Restored the dropped imports.
- **Problem**: ToolRegistry.execute stamps `origin`; an equality test failed.
- **Resolution**: Expect `{ ...expected, origin: "workspace_file" }`.
- **Problem**: Headless vocabulary test missing `hash_file` / `watch_path`.
- **Resolution**: Updated the expected names.

**CI (8.3)**: Propose-only. Full `test-ts` already covers `tests/unit/guardrails/**`, `tests/integration/guardrails/**`, ssrf, tools, and desktop `SecuritySettings`. No extra path-filter job. Unapproved extra filters would have been a QG; none proposed.

**gitignore (8.1)**: 0 patterns added. `.nexus-output/` and `coverage/` already ignored.

**docs-layout (8.5)**: Audit only. Canonical `docs/v1/v1.19/` already has `plans/` and `comparisons/`. New session-history file stays in `development/history/`. `security:gen` updated `docs/archive/v0/v0.5/architecture.md` (generated permission table); not moved.

**9.0 (final phase, propose-then-apply)**:
- project-refactor: no empty-dir / duplicate / orphan moves proposed.
- known-gaps: v1.19.1 DF-1..DF-5 open; file stays in-progress for v1.19.2; not finalized.
- CI optimize: already has concurrency + npm cache; no extra OS matrix.
- platform-contract / Hub installer-parity / prompting-freshness: self-gate no-ops (this is not the Nexus-Hub catalog repo).
- Docs/version/tag: hand off to `/update release`.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run lint` | PASS - 0 errors |
| `npx tsc -b` | PASS |
| Desktop lint + typecheck + `SecuritySettings.test.tsx` | PASS |
| `npx vitest run --coverage` | PASS - 466 files / 3 skipped; 5054 passed / 11 skipped / 0 failed |
| Line / branch / function coverage | PASS - 87.71% / 84.02% / 91.27% (thresholds 80 / 75 / 80) |
| Observe unit tests | PASS - 7/7 |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Chat has no per-chat system-prompt field | P2 | Deferred (v1.19.1 DF-1) |
| Hub edits not merged / not synced | P3 | Deferred (v1.19.1 DF-2) |
| HeadlessAgentSession has no LoopGuards | P2 | Deferred (v1.19.1 DF-3) |
| No-action budget rarely trips in production (one-shot pass-state nudge) | P3 | Deferred (v1.19.1 DF-4) |
| getPermissionTier still maps DANGEROUS+override 0 to CONFIRM; confirmation gate saves the floor | P3 | Deferred (v1.19.1 DF-5) |

## 5. Plan Discrepancies

- Plan said "Extend ActionClassifier.ts and the terminal handler" for 2.1. Implementation lives in `policy.ts` + `commandBlocklist.ts` (the existing deny path the terminal handler already calls). Same contract, fewer files.
- Plan said "Update CI to cover the guardrails, loop, ssrf, and tools paths." `ci.yml` `test-ts` already runs the full Vitest tree. No dedicated extra job.
- Plan said Headless wiring was optional. Recorded as DF-3 rather than silently claiming sidecar coverage.

## 6. Assumptions Made

- Sharing one LoopDetector between ChatController and LoopGuards is the intended D1 integration; double-reset on session start is idempotent.
- `browser_snapshot` as a reserved origin string is enough for the v2.0.0 browser phase to plug in without a schema change.
- Unattended skipping CONFIRM (not DANGEROUS) is the "fewer confirmations above the floor" reading of the plan.
- Cursor model picker is manual. Session stayed on the current model (same-or-stronger than the plan's strong tier).

## 7. Testing Summary

### Automated Tests
- Root Vitest: 5054 passed, 11 skipped, 0 failed (466 files passed, 3 skipped)
- Coverage: 87.71% lines (threshold 80%)
- Desktop: SecuritySettings unit test plus lint/typecheck

### Manual Testing Performed
- Read ChatController LoopGuards wiring; shared the LoopDetector instance after noticing a duplicate construct.
- Confirmed HeadlessAgentSession does not import LoopGuards (DF-3).
- Confirmed `ci.yml` test-ts already covers new test globs.

### Manual Testing Still Needed
- [ ] Merge Hub `feat/v1.19.1-skill-native-wins` and run `nexus skills sync --apply` (DF-2).
- [ ] Exercise Strict / Standard / Unattended in the desktop Security tab on a live coding session.
- [ ] Confirm Unattended still prompts on `run_terminal` (DANGEROUS floor).

## 8. TODO Tracker

### Completed This Session
- [x] 2.1 Hard denials
- [x] 2.2 LoopGuards
- [x] 2.3 Self-recovery
- [x] 2.4 Compression
- [x] 2.5 Security posture
- [x] 2.6 Provenance screening
- [x] 2.7 DNS pin
- [x] 2.8 watch_path / hash_file
- [x] 2.9 ToolPromptAssembler
- [x] 2.10 Integration tests + full suite
- [x] Post-phase docs (known-gaps, DEVLOG, session history, plan ticks)

### Remaining (Not Started)
- [ ] `/update release` for v1.19.1 (version, changelog, README What's New, tag, GitHub Release)

### Out of Scope (Deferred)
- [ ] Per-chat persona field (DF-1)
- [ ] Hub merge + sync (DF-2)
- [ ] HeadlessAgentSession LoopGuards (DF-3)
- [ ] Production no-action counting (DF-4)
- [ ] getPermissionTier DANGEROUS clamp (DF-5)
- [ ] Literal QM "Dangerous" no-floor posture (rejected)
- [ ] Browser tool surface (v2.0.0)

## 9. Summary and Next Steps

Phase 2 hardens the coding agent loop. Hard denials, LoopGuards, recovery, compression tail, posture dial, provenance, DNS pin, watch/hash, and generated tool docs all landed with a green full suite. Package version is still 1.19.0.

**Next session should**:
1. Run `/update release` for v1.19.1 (docs, version bump, changelog, tag, GitHub Release). Keep confirmation gates for tag and publish.
2. Keep the PermissionTiers floor clamp authoritative. Do not ship a no-floor posture.
3. Carry DF-1..DF-5; do not close the known-gaps file (v1.19.2 is still open).
