# Browser tool surface: security design (v2.0.0 Phase 2)

**Status**: implemented in Phase 2
**Plan**: [plans/v2.0.0-adoption-governed-autonomy-multimodal.md](plans/v2.0.0-adoption-governed-autonomy-multimodal.md)
**Reviewed against**: [comparisons/v2.0.2-comparison-atomic-agent.md](comparisons/v2.0.2-comparison-atomic-agent.md) Sections 5.1, 5.2, and 9

This note records the boundaries decided before the `browser_*` handlers shipped. It is the Phase 2.1 deliverable. Tool code lives under `modules/coding/browser/` (vscode-free session) and `src/tools/handlers/browser.ts` (VS Code adapters).

## Threats this surface adds

Atomic C1 is the only v2.0.0 candidate that widens the threat model (comparison 5.2: Medium). Two inbound/outbound facts:

1. **Agent-steered outbound.** `browser_navigate` reaches whatever URL the task names. That is the same class as `fetch_page`, never a lower permission tier (comparison 5.1).
2. **Indirect prompt injection.** Page text, hidden nodes, and ARIA labels flow back into the model. They are data, never instructions (comparison Section 9).

Session-cookie exfiltration is the named credential risk (comparison 5.1): pointing Playwright at the user's logged-in Chrome/Edge profile would hand the agent every site cookie on that profile. The user's default profile is never used.

## Isolated profile

- Profile root: `~/.nexus/browser-profiles/<session-id>/`.
- Construction refuses any path that is not under that root, and refuses well-known default profile fragments (`Google/Chrome`, `Microsoft/Edge`, Chromium `User Data`).
- Playwright, when present, launches `chromium.launchPersistentContext(userDataDir)` against that directory only.
- A coding-agent `run()` closes the session (and the context) on completion, cancel, or loop-guard halt so cookies from one turn do not leak into the next.

## Permission mapping

Every `browser_*` tool is `PermissionTier.DANGEROUS` in `permissionTierMap.ts`, matching `fetch_page` / `web_search`. The VS Code `ConfirmationGate` therefore prompts on every call. The DANGEROUS floor cannot be overridden to AUTO_APPROVE (existing F-003 clamp).

Headless hosts have no webview prompt. `screenHeadlessCall` still requires a `confirm` callback for DANGEROUS tools; without one the call is refused (fail-closed). Sidecar coding supplies that callback through the existing ask inbox.

`.nexus/permissions.deny` matches `browser_navigate` on the `url` subject.

Explore sub-agents do not receive these tools: they are absent from `EXPLORE_READONLY_TOOLS` on purpose (navigate/click/type mutate a browser; snapshots are hostile input).

## Snapshot handling

- ARIA-shaped text snapshots, not screenshots (token economy, comparison C1).
- Label: `[origin:browser_snapshot]` (the v1.19.1 reserved origin class).
- Before the text reaches the model: `redactSecrets`, then `PromptInjectionScanner.scan`. Findings wrap the body in an untrusted-content banner (warn-then-allow, same posture as `fetch_page`).
- `mustScreenOrigin("browser_snapshot")` is always on, in every security posture. AgentLoop still routes `browser_*` through the inbound classifier when that classifier is enabled; already-labelled snapshots skip a second heuristic wrap.

Hidden text, `aria-label`, `alt`, and HTML comments are included in the snapshot so a payload that is invisible in the GUI is still visible to the scanner.

## Interaction budget

v1.19.1 `LoopGuards` already bound a browsing session. Phase 2 does not add a second budget:

| Guard | Default | Browser effect |
|---|---|---|
| identical-call consecutive | 5 | Five identical `browser_click` / `browser_navigate` calls halt. The halt message tells the operator the browser session is still open; `run()` then closes it. |
| no-action | 3 | Tool-less turns still trip. |
| error-burst | 4 | Repeated failed navigations halt. |
| iteration ceiling | 60 | Hard cap on a long multi-page crawl. |

Hard denials (`isBlocked` / `BLOCKED_PATTERNS`) apply to `run_terminal` regardless of what a page suggested. `browser_type` additionally refuses to type a string that itself matches the shell blocklist (defense in depth: a page cannot use the type tool as a denylist bypass).

## Playwright dependency posture

- Local OSS library, not a browser-as-a-service. No new outbound destination besides the URL the user-approved navigate targets (comparison 5.1: zero hosted search / cloud inference / Telegram).
- Pinned version for operators who install it: **Playwright 1.55.x** (`npx playwright@1.55.0 install chromium`). It is **not** a `package.json` dependency so CI never downloads Chromium.
- CI and unit tests use `InMemoryBrowser` (HTML fixtures, `file://`, no network). Live Playwright is opt-in via `NEXUS_BROWSER_PLAYWRIGHT=1` on a developer machine.
- If Playwright is missing at runtime, `browser_navigate` returns an install message rather than falling back to the user's system Chrome.

## Explicit non-goals (comparison Section 9)

- No Exa / hosted search.
- No cloud LLM in the browse path.
- No Telegram remote control.
- No Atomic Agent code is vendored. Schemas and ARIA snapshots are reverse-engineered (re-partial).
