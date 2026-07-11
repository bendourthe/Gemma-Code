# Phase 10 -- VS Code extension thin-adapter rewrite + Marketplace re-publish

**Goal**: Reduce `modules/coding/extension.ts` from 445 lines to ~200; flip the manifest IDs from `gemma-code.*` to `nexus.coding.*` (the rename itself landed in Phase 1.5; this phase exercises and publishes it); rename the npm package + publisher to `nexus-coding`; publish the new listing.
**Prerequisites**: Phase 1 (shared core + manifest rename), Phase 2 (sidecar IPC), Phase 11's add-on flow as a peer (so the new extension has a desktop-app peer).
**Stability Gate**: The `nexus-coding` Marketplace listing exists; installing on a clean VS Code launches and renders the legacy extension-only mode when the desktop daemon is not running; with the daemon running, auto-detects and proxies all traffic to it; previously-bound `gemma-code.<cmd>` keybindings continue to work via the compat shim with a single-line deprecation log.

**Closes**: 3.P1.O, 11.P1.LLL from `docs/versions/v1/v1.0.0/known-gaps.md` + finalizes 2.P1.J / 2.P2.K (whose code landed in Phase 1).

---

## Sub-tasks

### 10.1 -- Thin-adapter rewrite of `extension.ts`

**Objective**: Reduce `modules/coding/extension.ts` from 445 lines to a ~200-line activator that decides between proxy + extension-only modes.

**Prompt**:
> Open [modules/coding/extension.ts](../../../../src/extension.ts) (post-Phase-1.4 layout). Extract the activation into two branches: `activateProxy(daemonHandle)` (used when `discoverDesktopDaemon()` finds a running Nexus app) and `activateExtensionOnly()` (used when no daemon). The proxy branch: every command handler, every panel (`NexusCodingPanel`, `MemoryPanel`, `TraceDashboardPanel`) is a thin webview shell that forwards `postMessage` calls into the IPC client. The extension-only branch: the legacy in-process engine activation (this code path is kept for compatibility -- targeted for removal in v1.2.0). The new file is ~200 lines. Acceptance: extension activates cleanly in both modes; manual smoke (open Command Palette, run `Nexus: Open Coding Panel`) works in both.

---

### 10.2 -- Keybinding compat shim with deprecation log

**Objective**: User-bound `gemma-code.<cmd>` keybindings continue to work and emit a one-line deprecation log.

**Prompt**:
> Add the compat shim under [modules/coding/extension.ts](../../../../src/extension.ts): for every renamed command, register both ids (`nexus.coding.<cmd>` AND `gemma-code.<cmd>`); the legacy id handler delegates to the new one and logs `[deprecation] gemma-code.<cmd> -> nexus.coding.<cmd>` to the Output channel exactly once per session. Acceptance: a manual test with a `keybindings.json` entry bound to `gemma-code.openChat` fires the new handler and shows the deprecation log once.

---

### 10.3 -- Marketplace listing transition

**Objective**: Publish the renamed `nexus-coding` listing; update the legacy `gemma-code` listing with a transition note.

**Prompt**:
> Build the renamed VSIX with `vsce package`. The npm package + publisher are already renamed in Phase 1.6. Publish via `vsce publish --packagePath <file>`. Update the legacy `gemma-code` listing description on the Marketplace (via the publisher dashboard) with a transition note pointing to the new listing. Acceptance: both listings are visible; clicking through "Get" on the new listing installs the rebranded extension; existing `gemma-code` users see the transition note.

---

### 10.4 -- Phase 10 lint, build, test, smoke gate

**Objective**: Verify the thin-adapter + republish is CI-green and smokes against a real Marketplace install.

**Prompt**:
> Re-run the four-step gate. Plus: install the `nexus-coding` extension from the Marketplace into a clean VS Code, with and without the desktop daemon running, and verify both activation paths work. Acceptance: 0 failures; manual smoke passes.
