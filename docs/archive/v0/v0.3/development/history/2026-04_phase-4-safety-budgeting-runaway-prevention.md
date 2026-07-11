# Development Log: Phase 4 -- Safety, Budgeting & Runaway Prevention

**Date**: 2026-04-15
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.6 (Claude Code)
**Objective**: Implement multi-layered safety infrastructure for the agent loop: loop detection, permission tiers, git safety nets, budget enforcement, action classification, and GPU-tier-aware iteration limits.
**Outcome**: All 6 sub-tasks implemented with 78 new tests passing. TypeScript compiles cleanly. No regressions in existing tests (587 non-storage tests passing).

---

## 1. Starting State

- **Branch**: `main` (ahead of last commit `cb883d3` by uncommitted Phase 3 changes + Phase 4 work)
- **Starting tag/commit**: `cb883d3` (feat(v0.3.0): implement graph-vector hybrid memory (Phase 3))
- **Environment**: Windows 11 Pro, Node.js, TypeScript, Vitest, VS Code extension development
- **Prior session reference**: `docs/archive/versions/v0/v0.3.0/development/history/2026-04_phase-3-graph-vector-hybrid-memory.md`
- **Plan reference**: `docs/archive/versions/v0/v0.3.0/implementation-plan.md` (lines 1410-1741)

Context: Phase 4 was motivated by the observation that local-only agents (unlike cloud API agents with billing alerts) can waste GPU time and electricity silently when they enter runaway loops. The implementation plan prescribed 6 safety modules to prevent this, plus infrastructure to make iteration limits, concurrency, and compaction behavior adapt to the detected GPU tier.

---

## 2. Chronological Steps

### 2.1 Sub-task 4.1: Sliding Window Hash Loop Detector

**Plan specification**: Create a LoopDetector class that tracks SHA-256 hashes of consecutive tool call payloads, warns after 3 identical calls in a window of 4, and terminates if the pattern persists.

**What happened**: Implemented `src/safety/LoopDetector.ts` (~90 lines) with configurable `windowSize` and `repeatThreshold`. SHA-256 hashing strips transient `id` and `_callId` fields to ensure identical logical calls produce the same hash regardless of invocation metadata. Created the `src/safety/` directory (new for Phase 4). Integrated into AgentLoop.ts at three insertion points: reset at `run()` start, record after each tool result, verdict check with early termination.

**Key files changed**: `src/safety/LoopDetector.ts` (new), `tests/unit/safety/LoopDetector.test.ts` (new, 9 tests), `src/tools/AgentLoop.ts` (modified)

**Verification**: 9/9 tests passing, AgentLoop regression tests (19) still passing.

---

### 2.2 Sub-task 4.4: Token & Time Budget Enforcement

**Plan specification**: Create a BudgetEnforcer that wraps the Ollama client, tracking cumulative token usage and wall-clock time per session with configurable ceilings.

**What happened**: Implemented `src/safety/BudgetEnforcer.ts` (~110 lines) as a standalone class that composes alongside (not replaces) the existing `BudgetMiddleware`. Tracks input/output tokens via chars/4 heuristic and session elapsed time. Fires callbacks at 80% (warning) and 100% (exceeded). Added `maxSessionTokens` (default 500K) and `maxSessionMinutes` (default 30) to settings.ts and package.json. Integrated into AgentLoop: budget check before each iteration, recordOutput after streaming, recordInput when injecting tool results.

**Key files changed**: `src/safety/BudgetEnforcer.ts` (new), `tests/unit/safety/BudgetEnforcer.test.ts` (new, 10 tests), `src/config/settings.ts`, `src/tools/AgentLoop.ts`, `package.json`

**Verification**: 10/10 tests passing, all prior tests still passing.

---

### 2.3 Sub-task 4.3: Git Safety Net

**Plan specification**: Implement automatic git stash/commit before agent file modifications with rollback capability.

**What happened**: Implemented `src/safety/GitSafetyNet.ts` (~110 lines). Uses `child_process.execFile` for all git operations with 10-second timeouts. `createCheckpoint()` records HEAD SHA and optionally stashes dirty state. `commitAgentChanges()` stages specific files and commits with `[gemma-code]` prefix using `--no-verify`. `rollback()` hard-resets to checkpoint and pops stash. All errors caught and logged (never thrown). Added `GitCheckpointMessage` and `RollbackRequest` to messages.ts. Integrated into AgentLoop (bookend: checkpoint at start, commit at end) and GemmaCodePanel (rollback handler).

**Key files changed**: `src/safety/GitSafetyNet.ts` (new), `tests/unit/safety/GitSafetyNet.test.ts` (new, 12 tests), `src/tools/AgentLoop.ts`, `src/panels/messages.ts`, `src/panels/GemmaCodePanel.ts`

**Verification**: 12/12 tests passing (git operations mocked via `child_process.execFile`).

---

### 2.4 Sub-task 4.2: Permission Tier System

**Plan specification**: Replace the flat ConfirmationMode with a 3-tier permission system enforced centrally in ToolRegistry.

**What happened**: Implemented `src/safety/PermissionTiers.ts` (~85 lines) with AUTO_APPROVE (6 read-only tools), CONFIRM (4 write tools), DANGEROUS (3 execution/network tools). MCP tools default to DANGEROUS. Refactored `ToolRegistry.ts` to add `setConfirmationGate()` and centralized permission checking in `execute()` before calling handlers. Simplified `terminal.ts` by removing its `_confirmationGate` and `_mode` constructor params and confirmation logic (BLOCKED_PATTERNS hard safety kept). Exported `BLOCKED_PATTERNS` and `isBlocked()` for reuse. Updated `SubAgentManager.ts` to use the new parameterless RunTerminalTool constructor (removed unused ConfirmationGate import). Updated terminal tests to match new constructor signature. Added `permissionOverrides` setting.

**Key files changed**: `src/safety/PermissionTiers.ts` (new), `tests/unit/safety/PermissionTiers.test.ts` (new, 15 tests), `src/tools/ToolRegistry.ts`, `src/tools/handlers/terminal.ts`, `src/agents/SubAgentManager.ts`, `src/config/settings.ts`, `tests/unit/tools/handlers/terminal.test.ts`, `tests/unit/errors/error-handling.test.ts`, `package.json`

**Troubleshooting**:
- **Problem**: `tsc --noEmit` reported `error TS2554: Expected 0-1 arguments, but got 2` at `SubAgentManager.ts:197` after changing RunTerminalTool's constructor.
- **Root cause**: SubAgentManager was still constructing `RunTerminalTool(noOpGate, "never")` with the old 2-argument signature.
- **Resolution**: Updated to `new RunTerminalTool()` and removed the unused ConfirmationGate import.

**Verification**: 15/15 PermissionTiers tests, 7/7 terminal tests, 23/23 error-handling tests all passing.

---

### 2.5 Sub-task 4.5: Irreversible Action Classifier

**Plan specification**: Build an action classification system that categorizes every tool call as reversible, destructive, or blocked, integrating with PermissionTiers and GitSafetyNet.

**What happened**: Implemented `src/safety/ActionClassifier.ts` (~140 lines). Classifies all 13 builtin tools plus MCP tools. For `run_terminal`, performs command content analysis: read-only whitelist (30+ commands), BLOCKED_PATTERNS reuse from terminal.ts, destructive pattern list (git push, rm, DROP, npm publish, etc.), and default-deny for unrecognized commands. Added `ActionClassificationMessage` to messages.ts. Integrated into AgentLoop before `registry.execute()`: BLOCKED actions skip execution, DESTRUCTIVE actions with `requiresCheckpoint` trigger git checkpoints.

**Key files changed**: `src/safety/ActionClassifier.ts` (new), `tests/unit/safety/ActionClassifier.test.ts` (new, 17 tests), `src/tools/AgentLoop.ts`, `src/panels/messages.ts`

**Verification**: 17/17 tests passing, AgentLoop regression clean.

---

### 2.6 Sub-task 4.6: GPU-Tier-Aware Iteration Limits

**Plan specification**: Make agent loop iteration limit, sub-agent concurrency, and compaction threshold configurable per GPU tier.

**What happened**: Implemented `src/config/GpuTierConfig.ts` (~95 lines). Defines 3 tier profiles (TIER_1: 25 iterations/0.7 compaction, TIER_2: 40/0.8, TIER_3: 60/0.85). `detectGpuTier()` reads explicit `gpuTier` setting or infers from model name. `getEffectiveProfile()` merges tier defaults with user overrides. Updated GemmaCodePanel to use `tierProfile.maxAgentIterations` for AgentLoop construction and instantiate a LoopDetector. Added `gpuTier` setting to settings.ts and package.json.

**Key files changed**: `src/config/GpuTierConfig.ts` (new), `tests/unit/config/GpuTierConfig.test.ts` (new, 15 tests), `src/config/settings.ts`, `src/panels/GemmaCodePanel.ts`, `package.json`

**Verification**: 15/15 tests passing.

---

### 2.7 Post-Phase Documentation

Updated `.gitignore` (no changes needed), `docs/DEVLOG.md` (new Phase 4 entry), and `docs/archive/versions/v0/v0.2.0/architecture.md` (new safety layer section, updated component descriptions, message protocol, and configuration reference).

---

## 3. Verification Gate

| Check | Result |
|---|---|
| Phase 4 unit tests (78 new) | PASS (78/78) |
| AgentLoop regression tests (19) | PASS |
| Terminal handler tests (7) | PASS |
| Error handling tests (23) | PASS |
| Full non-storage test suite (587) | PASS |
| TypeScript compilation (`tsc --noEmit`) | PASS (0 errors) |
| Pre-existing storage tests (95, better-sqlite3) | FAIL (pre-existing ERR_DLOPEN_FAILED) |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Pre-existing better-sqlite3 native module test failures (95 tests) | P2 | Pre-existing from Phase 3; requires `npm rebuild better-sqlite3`. Not caused by Phase 4. |
| BudgetEnforcer does not compose BudgetMiddleware as originally planned | Cosmetic | Runs as parallel check; functionally equivalent. Simpler integration. |

---

## 5. Plan Discrepancies

- **BudgetEnforcer composition**: Plan called for BudgetEnforcer to wrap BudgetMiddleware. Implemented as parallel checks instead to avoid changing the existing BudgetMiddleware contract.
- **ActionClassifier as module function**: Plan suggested an optional `actionClassifier` field on AgentLoopOptions. Implemented as a direct import (`classifyAction()`) that always runs, since every tool call should be classified.
- **terminal.ts exports**: Exported `BLOCKED_PATTERNS` and `isBlocked()` (not in plan) for ActionClassifier reuse.

---

## 6. Assumptions Made

- **chars/4 heuristic is sufficient for budget estimation**: BudgetEnforcer uses the same CHARS_PER_TOKEN=4 convention as the rest of the codebase. This is a rough estimate; actual token counts may differ significantly for non-English text or code-heavy content.
- **Default-deny for shell commands is acceptable**: ActionClassifier treats unrecognized shell commands as DESTRUCTIVE. This is conservative but may cause unnecessary confirmation prompts for safe-but-uncommon commands.
- **EditMode diff preview remains in file handlers**: The PermissionTier refactor only moved the "should this tool run?" confirmation to ToolRegistry. The "show diff and ask" workflow for file edits (tied to EditMode) remains in the filesystem handlers, since it is an edit workflow concern, not a safety concern.

---

## 7. Testing Summary

### Automated Tests
- LoopDetector: 9 passed, 0 failed
- BudgetEnforcer: 10 passed, 0 failed
- GitSafetyNet: 12 passed, 0 failed
- PermissionTiers: 15 passed, 0 failed
- ActionClassifier: 17 passed, 0 failed
- GpuTierConfig: 15 passed, 0 failed
- **Total new**: 78 passed

### Regression Tests
- AgentLoop: 19 passed
- Terminal handler: 7 passed
- Error handling: 23 passed
- Full non-storage suite: 587 passed

### Manual Testing Still Needed
- [ ] Load extension in VS Code and verify loop detector terminates a deliberately looping model
- [ ] Verify git checkpoint is created before agent modifies files in a real workspace
- [ ] Test rollback via webview button after agent makes file changes
- [ ] Verify budget exceeded message appears after configured token ceiling
- [ ] Confirm DANGEROUS-tier tools show enhanced warning in the confirmation dialog
- [ ] Test GPU tier auto-detection with different model names in Ollama

---

## 8. TODO Tracker

### Completed This Session
- [x] 4.1 Sliding Window Hash Loop Detector
- [x] 4.2 Permission Tier System
- [x] 4.3 Git Safety Net
- [x] 4.4 Token & Time Budget Middleware
- [x] 4.5 Irreversible Action Classifier
- [x] 4.6 GPU-Tier-Aware Iteration Limits
- [x] 4.T Testing and Stabilization

### Remaining
- [ ] Phase 4 exit checklist items (commit, session history)

### Out of Scope (Deferred)
- [ ] Resolving better-sqlite3 native module loading (pre-existing; affects Phase 3 storage tests)
- [ ] BudgetEnforcer composing BudgetMiddleware (decided against; parallel checks are simpler)

---

## 9. Summary and Next Steps

Phase 4 added a comprehensive safety layer to the Gemma-Code agent loop. Six new modules in `src/safety/` and `src/config/GpuTierConfig.ts` provide loop detection, permission enforcement, git checkpointing, budget caps, action classification, and tier-aware configuration. The most significant architectural change was centralizing tool confirmation in ToolRegistry.execute() (sub-task 4.2), which simplified terminal.ts and ensures consistent permission enforcement for all tools including future MCP additions.

**Next session should**:
1. Begin Phase 5: Plan-and-Execute Orchestration (TaskDAG, DAGExecutor, ReflexionEngine)
2. Commit Phase 3 + Phase 4 changes (currently uncommitted in working tree)
3. Consider resolving the better-sqlite3 native module issue to unblock storage tests
