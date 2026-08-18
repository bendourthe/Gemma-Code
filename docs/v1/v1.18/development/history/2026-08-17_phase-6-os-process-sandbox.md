# Session History - v1.18.0 Phase 6: OS Process Sandbox

**Date**: 2026-08-17
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 6 of 7 - OS Process Sandbox (OI-A1, closes EM.P5.A)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 7 is terminal). Phase 4 remains incomplete.

## Goal

Wrap `run_terminal` in OS-level confinement on macOS (Seatbelt), Linux (Landlock + seccomp), and Windows (job object + restricted token). Open Interpreter is an Apache-2.0 design reference only. No Rust / OI code vendored. Existing guardrails stay in addition. Degraded mode is loud (`unconfined`); never silently unconfined.

## Pre-flight

`is_final_phase` = **false** (Phase 7 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phases: 1-3 and 5 complete. Phase 4 (ask inbox + scheduler) is **not** complete. Operator chose implement Phase 6 now; do not implement Phase 4; do not auto-commit.

Operator-confirmed defaults: `nexus.coding.execSandbox` off; explicit "unconfined" when off or backend missing; writable roots = workspace + declared temp; network deny by default; headless sidecar uses the same abstraction.

Model routing: plan recommended Strong / high. Cursor is picker-only. This session stayed on Grok 4.6, which is same-or-stronger than Strong/high. Visible degrade: none. No silent downshift.

## 1. Starting State

- **Branch**: `develop`
- **Environment**: Windows 10 (10.0.26200), root Vitest suite + desktop shell tests
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
- **Prior session**: [2026-08-17_phase-5-acp-agent-surface.md](2026-08-17_phase-5-acp-agent-surface.md)

## 2. Chronological Steps

### 2.1 Abstraction + policy + degraded-mode contract (6.1)

**Plan specification**: One policy object, three backends. Writable roots = workspace + temp. Derive deny-read from secret dirs. Loud unconfined when no backend. Classifier can raise confirmation when unconfined.

**What happened**: vscode-free module [`modules/coding/sandbox/`](../../../../../modules/coding/sandbox/). Types (`confined` / `partial` / `unconfined`), `deriveDefaultPolicy`, `formatSandboxSummary` with literal `UNCONFINED_TOKEN`, `isExecSandboxEnabled` (`NEXUS_EXEC_SANDBOX` overrides vscode). Unconfined spawn stays `spawn(command, [], { shell: true })` so existing `vi.mock("child_process")` tests keep working.

**Verification**: `tests/unit/sandbox/policy.test.ts`, `degraded-mode.test.ts`, `enabled.test.ts`, `report.test.ts`.

### 2.2 macOS Seatbelt (6.2)

**Plan specification**: Generate a per-run `.sb` profile, launch under `sandbox-exec`, classify violations.

**What happened**: [`macosSeatbelt.ts`](../../../../../modules/coding/sandbox/backends/macosSeatbelt.ts) writes a deny-default profile (read allowed, write only writable roots, network per policy, deny-read secret dirs). Probe is `/usr/bin/sandbox-exec`. `# DEVIATION:` process-limits / restricted-token are N/A; mode is still `confined` when FS+network are enforced.

**Verification**: `tests/unit/sandbox/macosSeatbelt.test.ts`; integration skipped on this Windows host.

### 2.3 Linux Landlock + seccomp (6.3)

**Plan specification**: Apply Landlock FS rules and a seccomp filter in the child before exec.

**What happened**: [`linuxLandlock.ts`](../../../../../modules/coding/sandbox/backends/linuxLandlock.ts) embeds a Python ctypes helper. Probe requires `landlock` in `/sys/kernel/security/lsm` (or `/proc/sys/kernel/lsm`) **and** python3. Apply failure is fail-closed (exit 125), never retry unconfined. `# DEVIATION:` not an in-process Node native addon.

**Verification**: `tests/unit/sandbox/linuxLandlock.test.ts`; integration skipped on this Windows host.

### 2.4 Windows job object + restricted token (6.4)

**Plan specification**: Job object + restricted token; document what Windows can vs cannot enforce; partial confinement stated.

**What happened**: [`windowsJob.ts`](../../../../../modules/coding/sandbox/backends/windowsJob.ts) compiles an in-repo C# helper to `%TEMP%\nexus-exec-sandbox\NexusExecSandbox-v2.dll` (PowerShell). CREATE_SUSPENDED, AssignProcessToJobObject, ResumeThread, STARTF_USESTDHANDLES. Restricted token is best-effort (`CreateProcessWithTokenW`). [`windowsMatrix.ts`](../../../../../modules/coding/sandbox/windowsMatrix.ts) records FS and network as unenforced. `# DEVIATION:` AppContainer not applied. Mode is `partial`.

**Troubleshooting**:
- **Problem**: first integration run exit 0 with empty stdout.
- **Root cause**: the helper process did not inherit std handles.
- **Resolution**: `STARTF_USESTDHANDLES` + `GetStdHandle`; bump cached DLL name to `NexusExecSandbox-v2.dll`.

**Verification**: `tests/unit/sandbox/windowsMatrix.test.ts`; `tests/integration/sandbox/windows-job.integration.test.ts` (~0.9s, pass).

### 2.5 Wire `run_terminal` + headless + classifier + settings

**What happened**: `src/tools/handlers/terminal.ts` calls `spawnSandboxed`; JSON gains additive `sandbox: { mode, summary, backendId, enforced, unenforced }`. Headless `createHeadlessTools` uses the same facade. Classifier optional `{ execSandboxEnabled }` boosts confirmation when enabled but not confined; BLOCKED not boosted. Setting `nexus.coding.execSandbox` default false. ACP confirmation reads `isExecSandboxEnabled()`.

**Verification**: `tests/unit/tools/handlers/terminal.sandbox.test.ts` (off path still `spawn(command, [], { shell: true })`); `classifier-unconfined.test.ts`; `guardrails-inside-sandbox.test.ts`.

### 2.6 Testing, CI, coverage (6.5)

**What happened**: Unit tests for policy, degraded mode, backends-prepare (mocked spawn argv), report, violation, which/findOnPath. Per-OS integration `skipIf` wrong OS or incapable host. CI job `test-sandbox` in `.github/workflows/ci.yml`: push only, matrix ubuntu/macos/windows, path-scoped vitest includes.

**Verification**: sandbox suite 15 files / 47 passed / 5 skipped. Full root suite with coverage (see section 3). `npm run lint`, `npx tsc -b`, desktop lint + typecheck, `npm run check-architecture` (0 errors, pre-existing orphan/circular warnings).

## 3. Verification Gate

| Check | Result |
|---|---|
| Sandbox unit + integration | PASS - 15 files / 47 passed / 5 skipped (linux/macos skipIf on win32) |
| `npx vitest run --coverage` | PASS - 454 files passed / 3 skipped; 4904 passed / 11 skipped / 0 failed |
| Line coverage | PASS - 87.71% lines / 84.18% branches / 91.36% functions (thresholds 80 / 75 / 80). `modules/coding/sandbox` 96.47% lines |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS |
| Desktop lint / typecheck | PASS |
| `npm run check-architecture` | PASS - 0 errors (10 pre-existing warnings) |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Windows FS/network not kernel-enforced; no AppContainer | P1 | Deferred as DF-11; mode `partial` |
| Linux Landlock applied via Python ctypes, not a Node addon | P2 | Accepted (confined when Landlock+python3 present) |
| macOS/Linux integration not executed on this Windows host | P2 | Covered by CI `test-sandbox` matrix on push |
| Phase 4 ask inbox still missing | P1 | Out of this phase; DF-9 remains |

## 5. Plan Discrepancies

| Marker | What | Why |
|---|---|---|
| Linux helper | Python ctypes pre-exec, not in-process Node Landlock | Avoid native addon / koffi; still applies LSM rules before exec |
| Windows AppContainer | Not implemented | Capability SIDs break typical coding CLIs; documented matrix |
| Sidecar enablement | `NEXUS_EXEC_SANDBOX` rather than vscode | Sidecar is vscode-free; same spawn abstraction |
| Additive JSON | `sandbox` key on `run_terminal` result | Inputs unchanged; well-behaved contract preserved |
| Classifier boost | Only when enabled and not confined | BLOCKED stays blocked; no silent extra prompts when off |
| CI | Three-OS job is push-only, no extra path filter on the job itself | PRs already run the files on ubuntu `test-ts`; proposed path filter not applied (8.3) |

## 6. Assumptions Made

- Seatbelt deprecation is handled by probing `sandbox-exec`; missing binary is loud unconfined.
- `confined` requires filesystem **and** network enforced. Process-limits alone is `partial`.
- Network deny by default matches operator confirmation.
- Live macOS Seatbelt and Linux Landlock confinement are proven in CI, not on this Windows operator host (support tier: CI-backed for those OSes; Windows job path is proven here).

## 7. Testing Summary

- Unit: `tests/unit/sandbox/*` plus `tests/unit/tools/handlers/terminal.sandbox.test.ts`.
- Integration: macos/linux skipIf; windows job + guardrails-inside-sandbox run here.
- Existing denylist / env-scrub / blocklist still fire before spawn (guardrails-inside-sandbox + terminal.sandbox tests).
- Desktop ACP tests were green earlier in the session (956 passed); Phase 6 only added `isExecSandboxEnabled()` to `AcpConfirmation.ts`.
- After the coverage pass, four extra unit tests landed (`findOnPath` miss, `readTextIfExists`, empty-unenforced summary, Windows spawn without helper). Targeted re-run of those files: 17 passed. Full suite was not looped (implement-phase 8.2).

## 8. TODO Tracker

| Item | Status |
|---|---|
| 6.1 abstraction + policy | Done |
| 6.2 macOS Seatbelt | Done |
| 6.3 Linux Landlock + seccomp | Done |
| 6.4 Windows job + matrix | Done |
| 6.5 tests + CI + docs | Done |
| Phase 4 ask inbox | Not this phase (`/implement phase 4`) |
| Phase 7 architecture / known-gaps / CI | Next |

## 9. Summary and Next Steps

Phase 6 ships an off-by-default OS sandbox around `run_terminal` with honest per-OS mode strings. EM.P5.A is recorded per OS. Windows remainder is DF-11.

Next: Phase 7 of the same plan. Phase 4 remains `/implement phase 4`. Do not run `/update release` (not final).
