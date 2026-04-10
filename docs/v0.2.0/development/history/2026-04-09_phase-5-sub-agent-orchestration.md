# Phase 5: Sub-Agent Orchestration

**Date**: 2026-04-09
**Plan**: `docs/v0.2.0/development/implementation-plan.md`
**Phase**: 5 of 6

---

## Objective

Enable the main AgentLoop to spawn isolated sub-agents (verification, research, planning) with focused prompts and restricted tool access. Sub-agents run sequentially on the same GPU via Ollama's request queue.

## Subtasks Completed

1. Created `src/agents/types.ts` -- SubAgentType, SubAgentConfig, SubAgentResult
2. Created `src/agents/SubAgentPrompts.ts` -- prompt templates and context message builder
3. Extended `src/chat/PromptBuilder.types.ts` -- added subAgentType, subAgentContext fields
4. Modified `src/chat/PromptBuilder.ts` -- buildForSubAgent(), section skipping for sub-agents, type-specific sub-agent section
5. Added settings to `src/config/settings.ts` + `package.json` -- verificationEnabled, verificationThreshold, subAgentMaxIterations
6. Added `SubAgentStatusMessage` to `src/panels/messages.ts`
7. Registered `/verify` and `/research` in `src/commands/CommandRouter.ts`
8. Created `src/agents/SubAgentManager.ts` -- core orchestrator with fresh ToolRegistry per run
9. Modified `src/tools/AgentLoop.ts` -- AgentLoopOptions, file edit tracking, auto-verification trigger, spawnSubAgent()
10. Wired into `src/panels/GemmaCodePanel.ts` -- SubAgentManager initialization, command handlers
11. Added webview sub-agent status banner UI in `src/panels/webview/index.ts`

## Test Results

- **Tests**: 449 passed, 0 failed, 2 skipped (integration tests requiring Ollama)
- **New tests**: 33 (18 agent tests + 8 PromptBuilder tests + 7 AgentLoop tests)
- **Coverage**: 88.57% lines, 81.96% branches (agents module: 93.83% lines, 95.45% branches)
- **Lint**: 0 errors, 13 pre-existing warnings

## Key Design Decisions

- **Fresh ToolRegistry per sub-agent** rather than cloning the main registry, to avoid ConfirmationGate entanglement. Read-only handlers are instantiated directly; RunTerminalTool uses confirmationMode "never".
- **Advisory verification** -- results injected as user message, model decides how to act. No auto-reject.
- **AgentLoopOptions interface** groups new optional parameters to avoid constructor explosion (was 8 positional params).
- **Error detection via postMessage wrapper** -- AgentLoop catches stream errors internally, so SubAgentManager tracks errors via hadError flag on the message callback.

## Deviations from Plan

None. The implementation followed the plan exactly.

## Files Changed

### New (5)
- `src/agents/types.ts`
- `src/agents/SubAgentPrompts.ts`
- `src/agents/SubAgentManager.ts`
- `tests/unit/agents/SubAgentPrompts.test.ts`
- `tests/unit/agents/SubAgentManager.test.ts`

### Modified (11)
- `package.json` (+19 lines: 3 new VS Code settings)
- `src/chat/PromptBuilder.ts` (+72/-5: buildForSubAgent, section skipping, sub-agent directives)
- `src/chat/PromptBuilder.types.ts` (+3: subAgentType, subAgentContext)
- `src/commands/CommandRouter.ts` (+6/-1: /verify, /research commands)
- `src/config/settings.ts` (+6: 3 new settings)
- `src/panels/GemmaCodePanel.ts` (+70/-1: SubAgentManager wiring, command handlers)
- `src/panels/messages.ts` (+11/-1: SubAgentStatusMessage)
- `src/panels/webview/index.ts` (+43: sub-agent banner CSS + JS)
- `src/tools/AgentLoop.ts` (+82/-1: tracking, options, auto-verification)
- `tests/unit/chat/PromptBuilder.test.ts` (+79: sub-agent prompt tests)
- `tests/unit/tools/AgentLoop.test.ts` (+143: tracking + verification tests)

## Next Steps

Phase 6: Integration, Polish & Backend Alignment -- align Python backend with TypeScript changes, update webview UI, add documentation, E2E testing, version bump.
