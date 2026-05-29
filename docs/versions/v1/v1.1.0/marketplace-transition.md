# v1.1.0 -- VS Code Marketplace transition (gemma-code -> nexus-coding)

**Audience**: release operator.
**Purpose**: capture the operator-action steps for publishing the renamed `nexus-coding` Marketplace listing and updating the legacy `gemma-code` listing with a transition note. The code-level rename (manifest IDs, npm package name, publisher, command IDs, view-container ID, settings keys) already landed in Phase 1 (commit `de219a5`). Phase 10 exercises the rename and ships the listing transition.

This file mirrors the v1.0.0 `operator-actions.md` style. The two sub-tasks below are operator-driven because they require Marketplace publisher credentials that are not (and must not be) committed.

---

## OA-V1.1.0-10A -- Publish the renamed `nexus-coding` Marketplace listing

- **Reference**: Phase 10 sub-task 10.3; closes v1.0.0 carryforward `3.P1.O` + `11.P1.LLL`.
- **Prerequisite**: the publisher account `nexus-coding` must exist on the Marketplace (see Azure DevOps publisher dashboard at <https://marketplace.visualstudio.com/manage/publishers>).
- **What**:
  1. Confirm `package.json` carries the renamed identity:
     - `"name": "nexus-coding"`
     - `"publisher": "nexus-coding"`
     - `"displayName": "Nexus - Agentic AI Coding"`
     - `"main": "./out/src/extension.js"`
     - every `contributes.commands[].command` starts with `nexus.coding.`
     - every `contributes.views.*[].id` starts with `nexus.coding.`
     - the activity-bar `viewsContainers.activitybar[0].id` is `nexus-coding-sidebar`
  2. Build the VSIX:
     ```powershell
     npm ci
     npm run build
     npm run package           # runs scripts/build-vsix.ps1
     # or, for a quick local check:
     npm run package:quick     # runs `vsce package`
     ```
     The build script writes `nexus-coding-<version>.vsix` to the repo root.
  3. Smoke-test the VSIX against a clean VS Code install:
     ```powershell
     code --install-extension nexus-coding-<version>.vsix
     ```
     Verify the activity-bar icon labelled "Nexus Coding" appears, all three sidebar views (Chat / Memory / Traces) load, and the Command Palette lists `Nexus Coding: Ping Ollama` / `Nexus Coding: New Session` / `Nexus Coding: Show Sessions` / `Nexus Coding: Open Session` / `Nexus Coding: Detect GPU` / `Nexus Coding: Edit Plan-Mode Improvement Hook`. Confirm activation log starts with `[Nexus Coding] Daemon discovery: mode=...`.
  4. Publish the VSIX:
     ```powershell
     vsce publish --packagePath nexus-coding-<version>.vsix
     ```
     This requires the Personal Access Token for the `nexus-coding` publisher (Marketplace -> Manage Publishers -> Access Tokens). PATs are short-lived; rotate per Microsoft policy.
  5. Confirm the listing URL `https://marketplace.visualstudio.com/items?itemName=nexus-coding.nexus-coding` resolves and shows the new icon + readme.
- **Blocked by**: publisher PAT availability (operator-procured).
- **Status**: pending (target: cycle close window prior to Phase 15 RTM).

---

## OA-V1.1.0-10B -- Update the legacy `gemma-code` listing with a transition note

- **Reference**: Phase 10 sub-task 10.3 acceptance ("Update the legacy `gemma-code` listing description on the Marketplace with a transition note pointing to the new listing").
- **What**:
  1. Sign in to the legacy `gemma-code` publisher dashboard at <https://marketplace.visualstudio.com/manage/publishers/gemma-code>.
  2. Edit the existing `gemma-code` listing description; prepend the transition banner verbatim:
     ```
     > **Renamed: this extension is now published as `nexus-coding`.**
     >
     > The VS Code extension was renamed in v1.1.0 to `nexus-coding` and is published by the `nexus-coding` publisher. Install the new listing from
     > https://marketplace.visualstudio.com/items?itemName=nexus-coding.nexus-coding to receive new features.
     >
     > Existing keybindings bound to `gemma-code.<cmd>` continue to fire the renamed handlers via a runtime compat shim in the new listing; a one-line deprecation note appears in the "Nexus Coding" Output channel once per session. The compat shim is retained through v1.2.0.
     >
     > This `gemma-code` listing receives no further updates; the final release is the v0.X.0 baseline.
     ```
  3. Save the listing. Verify the banner renders correctly in both light and dark Marketplace themes.
  4. **Do not** unpublish the legacy listing; leave it in place so existing keybindings continue to resolve for users who have not yet migrated. The next v1.x.x cycle reassesses whether to unpublish.
- **Blocked by**: legacy `gemma-code` publisher PAT (operator-procured).
- **Status**: pending.

---

## Notes for future cycles

- The compat shim ([src/activation/compatShim.ts](../../../../src/activation/compatShim.ts)) maps six legacy `gemma-code.<cmd>` IDs to their `nexus.coding.<cmd>` replacements. The shim is targeted for removal in v1.2.0. Before removing it, audit GitHub issues + community channels for users still depending on the legacy IDs.
- The npm package name and publisher both became `nexus-coding` in Phase 1.6 (commit `de219a5`). If a future cycle needs to reclaim the `gemma-code` npm scope on the Marketplace (e.g. to redirect installs), the rename direction is one-way: the new publisher cannot re-publish under the old name without re-verifying the legacy account.
- The proxy branch ([src/activation/proxy.ts](../../../../src/activation/proxy.ts)) is the activation path when `discoverDesktopDaemon()` reports a live socket. Today every proxied command surfaces an "open the desktop app" hint; the full IPC client lands as the upstream Phase 2 sidecar IPC widening completes.
