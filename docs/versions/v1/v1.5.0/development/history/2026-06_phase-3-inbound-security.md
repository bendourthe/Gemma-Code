# Session history: v1.5.0 Phase 3 -- Inbound Security

**Date**: 2026-06-10
**Cycle**: v1.5.0 (Local Agent Maturity)
**Phase**: 3 (Inbound security -- Bucket 3 `re-full`: item 3)
**Plan reference**: [docs/versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md](../../plans/adoption-ecosystem-2026-06.md)
**Source comparison**: [docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md](../../comparison-ecosystem-2026-06.md)
**Branch (Nexus-AI)**: `feat/v1.5.0-phase-3-inbound-security` (off the Phase 2 branch; v1.5.0 not yet merged to `main`)
**Acceptance scope**: adopt report item 3 -- an inbound prompt-injection classifier screening fetched content before it enters the agent context, default warn-then-allow (never hard-block / silently drop). Stability gate: `npm run test`, `npm run lint`, `npm run check-architecture` clean; the classifier defaults to warn-then-allow and never drops content.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T008 (item 3) | Inbound untrusted-content classifier. New [modules/coding/security/InboundClassifier.ts](../../../../../modules/coding/security/InboundClassifier.ts): `InboundClassifier.screen` runs a deterministic core (reuses `guardrails/PromptInjectionScanner.scan` + a conservative inbound-specific marker table: new-instructions, role-spoof, imperative override, credential/data exfiltration, HTML-comment instructions), with an optional local-model second opinion via the injected `InboundModelScreener` seam (`createLlmInboundScreener` over the `LLMClient` port, fully defensive). `annotate` wraps flagged content in an untrusted-content banner (warn-then-allow), preserving the full original verbatim. Routed at the agent-context boundary by `AgentLoop._screenInboundResult` over `fetch_page` / `web_search`; constructed in `ChatController.buildAgentLoop`. Toggles `nexus.coding.inboundClassifier.enabled` (default on) + `.deepScan` (default off). Source: Viktor untrusted-data classifier (S1). | Closed |
| T009 | Tests + stabilization. 21 unit tests + 5 production-path integration tests, all green. Full suite 3988 passed / 5 skipped / 0 failed; `tsc -b` exit 0; `lint` 0; `check-architecture` 0 errors; `check:prompts` exit 0; `security:check` in sync. No outbound call introduced. | Closed |

## 2. Design decisions & deviations from the plan text

| # | Decision / deviation | Resolution |
|---|---|---|
| D1 | The plan prompt says "reusing the local model and the existing skill-install prompt-injection scanner pattern". There is no standalone "skill-install" scanner in TypeScript; the existing scanner is the memory-boundary `guardrails/PromptInjectionScanner.ts`. | Reused `PromptInjectionScanner.scan` as the deterministic core (the genuine existing pattern), supplemented with a small inbound-specific marker table. The "local model" is wired as an **optional, default-off** second opinion (`deepScan`), so the always-on gate is deterministic + zero-latency and testable without a live model, while the model reuse is real and unit-tested via a fake `LLMClient`. |
| D2 | Where to screen: inside `FetchPageTool`, or at the agent boundary? | Screened in `AgentLoop._screenInboundResult`, the single chokepoint where tool output is folded into the conversation (`formatToolResult` -> `addUserMessage`). This satisfies "fetch_page (and other inbound external-data tools) before it enters the agent's context" with one gate covering both `fetch_page` and `web_search`, rather than per-tool decoration. |
| D3 | Default-on vs. default-off for the model second opinion. | Master gate `enabled` defaults **on** (cheap deterministic heuristic, the security default). The model `deepScan` defaults **off**, mirroring the `nexus.memory.consolidation`/`compression` precedent, so the common fetch path makes no per-fetch model call and adds no latency. |
| D4 | Real outcome vs. annotated content in `AgentLoop`. | The annotated `contextResult` drives only the agent-facing surfaces (injected context, rolling recent-results window, webview summary). The true `result` still drives outcome tracking, telemetry, file-edit counting, and the lifecycle bus -- annotation never changes `success` (warn-then-allow). |

## 3. Open items added to known-gaps

One forward-tier follow-up recorded in [docs/versions/v1/v1.5.0/known-gaps.md](../../known-gaps.md) (`candidate`, not a defect):

- `T008.P3.A` (P3/DF) -- the deep-scan local-model second opinion is built and unit-tested via a fake `LLMClient` (`createLlmInboundScreener` + `parseModelVerdict`) but has no integration test against a live local model (the repo norm for model-dependent paths). The always-on heuristic IS `supported` (unit + production-path integration tested). Suggested next step: an opt-in live-model smoke test gated on `OLLAMA_URL`.

## 4. Verification evidence

- `npx vitest run` on the two new files + `AgentLoop.test.ts` -> **62 passed** (21 unit + 5 integration + 36 existing AgentLoop).
- `npm run test` (full suite) -> **3988 passed / 5 skipped / 0 failed** (348 files); includes `dep-cruiser-clean` integration baseline (`deps:check` over `src tests` exits 0).
- `npx tsc -b` -> **exit 0**.
- `npm run lint` (`eslint src modules`) -> **0**.
- `npm run check-architecture` -> **0 errors** (10 pre-existing orphan/circular warnings, none involving the new module; `no-llm-outside-llm-folder` holds -- the classifier imports only the `LLMClient` port type).
- `npm run check:prompts` -> **exit 0** (one pre-existing unrelated `review-pr/SKILL.md` oversize warning).
- `npm run security:check` -> **"All safety surfaces in sync"** (no tool/permission-tier change).
- No outbound call introduced: the heuristic is pure-local; the optional deep-scan reuses the already-loaded local model via the existing client.

## 5. Next steps

- Advance to Phase 4 (Swarm / DAG orchestration, item 36; T010-T014), which also closes the v1.4.0 deferrals `T018.P3.A`, `T018.P3.B`, `T016.P3.A`.
- Phase 7 (T024) whole-plan acceptance gate re-verifies item 3 as implemented + tested.
- Push of the Nexus-AI Phase 3 commit is pending user confirmation.
