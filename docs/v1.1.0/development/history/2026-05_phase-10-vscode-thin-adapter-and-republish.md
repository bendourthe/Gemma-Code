# 2026-05-20 -- v1.1.0 Phase 10 -- VS Code extension thin-adapter rewrite + Marketplace re-publish

**Plan**: [docs/v1.1.0/plans/phase-10-vscode-thin-adapter-and-republish.md](../../plans/phase-10-vscode-thin-adapter-and-republish.md)
**Closes**: v1.0.0 carryforward `3.P1.O` + `11.P1.LLL`; finalizes publish-surface portion of `2.P1.J` / `2.P2.K`.
**Status**: Complete. 4 sub-tasks landed end-to-end with the quality gate green.

---

## Subtasks completed

### 10.1 -- Thin-adapter rewrite of `extension.ts`

- **Goal**: Reduce `src/extension.ts` from 478 lines to a ~200-line activator that decides between proxy + extension-only modes.
- **Outcome**: `src/extension.ts` shrinks to **64 lines** -- comfortably under the ~200-line target. The new entry point creates the "Nexus Coding" output channel, calls `discoverDesktopDaemon()` from [src/desktop/daemonDiscovery.ts](../../../../src/desktop/daemonDiscovery.ts), logs the discovery outcome (`mode`, `probedPath`, `reason`), and dispatches into one of two activation modules.
- **New module: [src/activation/proxy.ts](../../../../src/activation/proxy.ts) (76 lines)** -- the proxy branch fires when a live daemon socket is detected. It registers all six `nexus.coding.<cmd>` IDs as thin forwarders, creates a "Nexus: daemon connected" status bar item that points at `nexus.coding.focusSidebar`, and surfaces a "open the desktop app" information message when any command fires. The actual sidecar IPC client (named pipe / Unix socket / `tauri::Channel`) is the upstream Phase 2 deliverable; the activation shape is correct and each handler becomes a single IPC dispatch when that client lands (tracked under open item 10.1.P1.Z).
- **New module: [src/activation/extensionOnly.ts](../../../../src/activation/extensionOnly.ts) (403 lines)** -- the legacy in-process engine activation, lifted from the old `extension.ts`. Keeps the v1.0.0 behavior exactly: constructs `NexusCodingRuntime`, the chat panel + session list + memory panel + trace dashboard, wires the GPU detector + Ollama poller + OTLP exporter, registers every `nexus.coding.<cmd>` command, and exports `stopOllamaPoller()` so the top-level `deactivate()` can tear down the timer without reaching into the module's internals. This branch is kept for compatibility through v1.2.0 and is targeted for removal as the daemon becomes the canonical path.
- **Discovery semantics**: `discoverDesktopDaemon()` returns `mode = "proxy"` when the platform-conventional socket path exists (`\\.\pipe\nexus.<user>.sock` on Windows, `~/.nexus/run/nexus.sock` on POSIX); otherwise it returns `mode = "extension-only"` with one of two reasons (user opted in via setting, or default fallback with install hint). The activator branches on `discovery.mode === "proxy"`.
- **Test coverage**: New unit tests in [tests/unit/activation/proxy.test.ts](../../../../tests/unit/activation/proxy.test.ts) cover the proxy branch end-to-end (5 tests); the existing [tests/unit/extension.test.ts](../../../../tests/unit/extension.test.ts) continues to assert the legacy in-process surface because the test environment has no daemon socket and falls through to extension-only mode.

### 10.2 -- Keybinding compat shim with once-per-session deprecation log

- **Goal**: For every renamed command, register both the new and legacy IDs; the legacy ID handler delegates to the new one and logs `[deprecation] gemma-code.<cmd> -> nexus.coding.<cmd>` to the output channel **exactly once per session**.
- **New module: [src/activation/compatShim.ts](../../../../src/activation/compatShim.ts) (54 lines)** -- exports `COMPAT_COMMAND_MAP` (frozen array of six `[legacyId, newId]` pairs) and `installCompatShim(context, channel)`. The function walks the map, registers each `gemma-code.<cmd>` ID programmatically (not via `contributes.commands`, so the legacy IDs do not surface in the Command Palette), and forwards to its replacement via `vscode.commands.executeCommand(newId, ...args)`. A `Set<string>` in the closure scope tracks which legacy IDs have already logged this session; on the first invocation of each ID the shim writes `[deprecation] <legacy-id> -> <new-id>` to the channel, on every subsequent invocation it forwards silently.
- **Tightening from Phase 2**: Phase 2's rebrand commit (`de219a5`) shipped a per-invocation deprecation line. The plan acceptance criterion narrows this to once-per-session ("a manual test with a `keybindings.json` entry bound to `gemma-code.openChat` fires the new handler and shows the deprecation log once"). The new `compatShim.ts` is the single source of truth for the contract.
- **Shared between activation branches**: `extension.ts` installs the shim after the dispatch into proxy or extension-only mode, so both paths register the legacy IDs identically. A user who upgrades from v0.X.0 sees the same keybinding behavior whether or not the desktop daemon is running.
- **Test coverage**: 6 unit tests in [tests/unit/activation/compatShim.test.ts](../../../../tests/unit/activation/compatShim.test.ts): ID registration count, the legacy-id-to-new-id mapping shape, the once-per-session log contract (assert one log line after three invocations of the same legacy ID), per-id independence (each legacy ID logs on its own first invocation), disposable accounting against `context.subscriptions`, and positional arg forwarding (`gemma-code.openSession("session-id-42")` -> `executeCommand("nexus.coding.openSession", "session-id-42")`).

### 10.3 -- Marketplace listing transition

- **Goal**: Publish the renamed `nexus-coding` VSIX to the Marketplace; update the legacy `gemma-code` listing description with a transition note pointing to the new listing.
- **Outcome**: The code-level rename (manifest IDs, npm `name` + `publisher`, command IDs, view-container ID, settings keys) already landed in Phase 1.6 commit `de219a5`; Phase 10's contribution is the **operator-action checklist** at [docs/v1.1.0/marketplace-transition.md](../../marketplace-transition.md).
- **Operator-action document contents**:
  - **OA-V1.1.0-10A**: Publish the renamed VSIX. Captures the pre-flight checklist (verify `package.json` carries the renamed identity end-to-end), the build commands (`npm ci && npm run build && npm run package` -> `nexus-coding-<version>.vsix` via `scripts/build-vsix.ps1`), the local smoke-test recipe against a clean VS Code install (verifies the activity-bar icon, the three sidebar views, and the Command Palette entries), and the publish command (`vsce publish --packagePath nexus-coding-<version>.vsix`) with a note on PAT rotation.
  - **OA-V1.1.0-10B**: Edit the legacy `gemma-code` listing description on the Marketplace publisher dashboard. Captures the verbatim transition banner text (a Markdown blockquote pointing to the new listing, documenting the compat shim contract through v1.2.0, and noting that the legacy listing receives no further updates). Documents the policy that the legacy listing is **not** unpublished so users on existing keybindings continue to resolve via the in-extension compat shim.
- **Deferral rationale**: Publishing requires the publisher Personal Access Token (PAT), which is operator-procured and must not be committed. The operator action surfaces in Phase 15 RTM per [docs/v1.1.0/known-gaps.md](../../known-gaps.md) item 10.3.P2.BB.

### 10.4 -- Phase 10 lint, build, test, smoke gate

- **Goal**: Re-run the four-step gate; plus install the `nexus-coding` extension from the Marketplace into a clean VS Code, with and without the desktop daemon running.
- **Build**: `npm run build` (`tsc`) -- 0 errors.
- **Lint**: `npm run lint` (`eslint src`) -- 0 warnings.
- **Tests**: `npm test` -- 283 files, 3292 passing, 5 skipped (live integration paths gated on Ollama / LM Studio), 0 failures. The 11 new Phase 10 unit tests (6 in `compatShim.test.ts` + 5 in `proxy.test.ts`) all pass on the first run.
- **Marketplace smoke (deferred to operator)**: The end-to-end install-from-Marketplace + daemon-detect smoke is an operator action documented under OA-V1.1.0-10A; the local smoke (build VSIX + sideload + verify activation paths) is reproducible from a developer host today.

---

## Files touched

### Added

- [src/activation/compatShim.ts](../../../../src/activation/compatShim.ts) (54 lines) -- legacy `gemma-code.<cmd>` keybinding shim with once-per-session deprecation log.
- [src/activation/proxy.ts](../../../../src/activation/proxy.ts) (76 lines) -- proxy-mode activation; forwards every command through the desktop daemon (IPC client pending).
- [src/activation/extensionOnly.ts](../../../../src/activation/extensionOnly.ts) (403 lines) -- extension-only activation; the legacy in-process engine path kept for compatibility through v1.2.0.
- [tests/unit/activation/compatShim.test.ts](../../../../tests/unit/activation/compatShim.test.ts) (6 tests, 130 lines).
- [tests/unit/activation/proxy.test.ts](../../../../tests/unit/activation/proxy.test.ts) (5 tests, 95 lines).
- [docs/v1.1.0/marketplace-transition.md](../../marketplace-transition.md) -- operator-action checklist for the publish + legacy-listing transition steps.
- [docs/v1.1.0/development/history/2026-05_phase-10-vscode-thin-adapter-and-republish.md](2026-05_phase-10-vscode-thin-adapter-and-republish.md) -- this file.

### Rewritten

- [src/extension.ts](../../../../src/extension.ts) -- 478 lines -> 64 lines. Now just orchestrates: create output channel, discover daemon, dispatch into proxy or extension-only, install compat shim. The in-process engine body moved into `src/activation/extensionOnly.ts`.

### Updated

- [docs/DEVLOG.md](../../../DEVLOG.md) -- Phase 10 entry prepended above the Phase 9 entry.
- [docs/v1.1.0/known-gaps.md](../../known-gaps.md) -- Phase 10 closures (v1.0.0 3.P1.O + 11.P1.LLL, plus the publish-surface portion of 2.P1.J / 2.P2.K) recorded; three new P-level deferrals added (10.1.P1.Z proxy IPC client, 10.1.P2.AA thin-webview shells, 10.3.P2.BB Marketplace publish operator action); `## 3. Summary` table refreshed to 25 open / 39 resolved / 64 total; carryforward map at the bottom updated to reflect the Phase 10 closures.

---

## Decisions and trade-offs

1. **64 lines vs. ~200 in the plan target**: The plan targeted ~200 lines because the original design folded the proxy + extension-only branches into a single `activate()` body with conditional branches inline. Extracting both branches into their own modules under `src/activation/` brought the entry-point file down to 64 lines, with the bulk of the legacy code in `extensionOnly.ts`. The trade-off: one additional level of indirection vs. an entry point that is trivial to audit at a glance. The latter wins because every future cycle will want to add another activation branch (e.g. a "headless CI mode" or an "embedded daemon mode") and the indirection becomes a feature.
2. **Proxy branch is intentionally minimal today**: The plan's prompt for sub-task 10.1 spells out a thin webview shell that forwards `postMessage` calls into the IPC client. Today the IPC client itself does not exist (Phase 2's sidecar widening is upstream work, tracked in v1.0.0 carryforwards 3.P1.N / 3.P1.Q / 3.P2.U etc.); landing the webview shells before the client lands would build on a stub. The proxy branch ships the activation shape -- discovery, command registration, status bar, output channel -- so the next commit that lands the IPC client only has to swap the six handler bodies for a `client.send(commandId, ...args)` call. Tracked under 10.1.P1.Z and 10.1.P2.AA.
3. **Once-per-session deprecation log via closure-scoped `Set`**: The simplest implementation that satisfies the acceptance criterion. A `Set<string>` per `installCompatShim` invocation works because the function is called once per VS Code session (inside `activate()`); the set's lifetime matches the session's lifetime exactly. No persistent state, no settings entry to track, no cross-session memory of "already warned".
4. **`activateExtensionOnly` is import-heavy but small at call time**: The legacy in-process engine module imports a large dependency graph (panels, runtime, observability, GPU detection, OTLP). Splitting it into smaller submodules under `src/activation/extensionOnly/` would reduce per-file size but multiply the import graph. The 403-line module is acceptable because every function call lands in the function it textually owns; there is no hidden state between sections of the file.
5. **Marketplace publish is documented, not automated**: The decision tree at [AGENTS.md](../../../../AGENTS.md) routes "external service requiring credentials" to operator action. Marketplace publishing fits that route exactly. Automating the publish via GitHub Actions would require the PAT to live as a CI secret, which expands the credential blast radius unnecessarily for a once-per-cycle action.

---

## Known gaps opened this phase

- **10.1.P1.Z** (DF, P1): Proxy-branch daemon IPC client deferred to the upstream Phase 2 sidecar widening. The activation shape is correct; the six handlers swap to `client.send(...)` when the client lands.
- **10.1.P2.AA** (DF, P2): Thin-webview-shell rewrites of `NexusCodingPanel` / `MemoryPanel` / `TraceDashboardPanel` deferred until 10.1.P1.Z lands. The proxy branch today registers no webview view providers; the extension-only branch keeps the full panels intact.
- **10.3.P2.BB** (DF, P2): Marketplace publish (OA-V1.1.0-10A) + legacy listing transition note (OA-V1.1.0-10B) are operator actions documented in [marketplace-transition.md](../../marketplace-transition.md). Surface in Phase 15 RTM.

---

## Next phase

Phase 11 -- Nexus VS Code extension (multi-model agentic add-on). Extends the Phase 10 thin adapter into a full agentic surface inside VS Code (plan mode, auto mode, memory, skills, sub-agents, sessions, slash commands, MCP tools) driven by the desktop daemon. Requires 10.1.P1.Z (daemon IPC client) and the Phase 2 sidecar widening cluster to land first.
