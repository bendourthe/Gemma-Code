# Session History - v2.0.0 Phase 2: Browser Tool Surface

**Date**: 2026-08-19
**Version**: v2.0.0
**Plan**: [../../plans/v2.0.0-adoption-governed-autonomy-multimodal.md](../../plans/v2.0.0-adoption-governed-autonomy-multimodal.md)
**Phase**: 2 of 6 - Browser Tool Surface
**Outcome**: Complete. Five `browser_*` tools drive an isolated Playwright (or InMemory) profile at DANGEROUS tier. ARIA snapshots are labelled `browser_snapshot` and screened. Adversarial HTML fixtures stay local. No cloud browser service.

## Goal

The coding agent can navigate, click, type, and read ARIA snapshots through a gated DANGEROUS tool family over a locally installed Playwright dependency and an isolated browser profile. Page content is hostile input.

## Pre-flight

`is_final_phase` = **false** (Phase 6 is the last phase). Model routing: plan recommended strong / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-6 with local commits after 1-5, then Phase 6 commit, push, and `/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `4767689` (Phase 1 multimodal chat + voice loop)
- **Environment**: Windows 10, root Vitest, desktop Vitest
- **Package version**: 1.20.0 (version bump waits for `/update release` after Phase 6)

## 2. Chronological Steps

### 2.1 Security design pass (2.1)

**Plan specification**: Short doc covering isolated profile, DANGEROUS + ConfirmationGate, ARIA + `browser_snapshot` + scanner, loop-guard budget, pinned local Playwright (no service). Review against Atomic comparison 5.1 / 5.2 / 9.

**What happened**: Wrote [browser-surface-security.md](../../browser-surface-security.md). Default Chrome/Edge profiles are refused. Playwright 1.55.x is documented as an optional local install, not a `package.json` dependency, so CI never downloads Chromium.

**Key files**: `docs/v2/v2.0/browser-surface-security.md`

### 2.2 `browser_*` tool family (2.2)

**Plan specification**: `browser_navigate`, `browser_click`, `browser_type`, `browser_aria_snapshot`, `browser_close`. Isolated profile. Per-action confirmation. Snapshots labelled and screened. Close on run end or guard trip.

**What happened**: vscode-free session in `modules/coding/browser/` (InMemory driver for tests; Playwright driver with injectable loader). VS Code handlers in `src/tools/handlers/browser.ts`. Headless twins opt in via `createHeadlessTools({ browserEnabled: true })`; the sidecar coding host always enables them. `AgentLoop.run` and `HeadlessAgentSession.run` close the shared session in `finally`. All five names are DANGEROUS specialty tools (trimmed under the 15-tool prompt cap before codegraph). `url` is the `.nexus/permissions.deny` subject for navigate. Explore sub-agents cannot call these tools.

**Key files**: `modules/coding/browser/`, `src/tools/handlers/browser.ts`, `src/tools/ToolRegistryBuilder.ts`, `modules/coding/guardrails/permissionTierMap.ts`

### 2.3 Adversarial validation (2.3)

**Plan specification**: Local HTML fixtures: instruction-shaped payloads, hidden text, ARIA-label injection, page that suggests a denied command, long flow for the interaction budget.

**What happened**: Fixtures under `tests/fixtures/browser-adversarial/`. `PromptInjectionScanner` flags "ignore previous instructions" including hidden/aria-label/comment text. `browser_type` of `rm -rf /` is refused; `isBlocked("rm -rf /")` remains true. Five identical `browser_click` calls trip `LoopGuards` identical-call. SSRF/egress denylist blocks metadata IPs and localhost on navigate.

**Key files**: `tests/fixtures/browser-adversarial/`, `tests/unit/browser/browser-surface.test.ts`

### 2.4 Testing and Stabilization (2.4)

**Plan specification**: Tier/gating, profile isolation, snapshot labelling, session lifecycle. CI: Playwright or skip with a local-run note.

**What happened**: InMemory covers CI. Live Playwright is `describe.skipIf(NEXUS_BROWSER_PLAYWRIGHT !== "1")`. CI comment documents that Chromium is not downloaded. Fake Playwright loader covers `launchPersistentContext` against `~/.nexus/browser-profiles/`.

## 3. Quality gates

- Root `npm run lint`, `tsc -b`, Vitest + coverage
- Desktop lint, typecheck, Vitest (sidecar registers `browser_navigate`)
- `npm run security:gen` regenerated `nexus.security.toml` permissions for the five tools

## 4. Deviations and findings

- Playwright is not pinned in `package.json` (CI size). Operators install `npx playwright@1.55.0 install chromium`. Recorded as DF-6.
- Five extra catalog entries are specialty-trimmed under `MAX_TOOL_COUNT = 15`, so the VS Code prompt may drop them when codegraph is also enabled. The desktop sidecar headless list always includes them. Recorded as DF-7.
- InMemory VAD-style energy browser is N/A. VAD was Phase 1. No change.
- `INBOUND_EXTERNAL_DATA_TOOLS` source assertion in `parse-document-wiring.test.ts` now reads a 400-char window so a multi-line Set still proves `parse_document` membership.

## 5. Ready for Phase 3

Yes. Video Lab continuation + avatar is next. Local commit only after this phase.
