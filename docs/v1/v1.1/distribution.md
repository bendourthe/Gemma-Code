# v1.1.0 -- Distribution channels

**Audience**: release operator, CI maintainer.
**Plan reference**: [phase-15-hardening-and-release.md](plans/phase-15-hardening-and-release.md) sub-task 15.10.

Three OS surfaces ship in v1.1.0 (Windows + macOS + Linux desktop installers), plus the renamed `nexus-coding` VS Code Marketplace listing. The pre-v1.1.0 `gemma-code` Marketplace listing is replaced by the renamed `nexus-coding` listing per Phase 10's [marketplace-transition.md](marketplace-transition.md); the legacy listing carries a one-cycle transition note pointing at the new listing.

This file mirrors the v1.0.0 [distribution.md](../v1.0/distribution.md) structure.

---

## 1. GitHub Releases (primary, all three OS installers)

### 1.1 Trigger

A push of an annotated tag `v1.1.0` to `main` triggers the existing semantic-release workflow at `.github/workflows/release.yml`, which in turn fires the three OS-specific installer workflows on tag-push:

- `.github/workflows/installer-build.yml` -- builds `Nexus-1.1.0-Setup.exe` (Windows NSIS outer installer; calls into the PyQt5 wizard).
- `.github/workflows/installer-macos.yml` -- builds `Nexus-1.1.0.dmg` (macOS DMG; PyInstaller-frozen wizard wrapped in a DMG via `create-dmg`).
- `.github/workflows/installer-linux.yml` -- builds `Nexus-1.1.0-x86_64.AppImage` (Linux AppImage; PyInstaller-frozen wizard wrapped via `appimagetool`).

```bash
git tag -a v1.1.0 -m "$(cat <<'EOF'
Nexus 1.1.0 -- stabilization + expansion cycle.

What's new:
- Cross-OS installer (Windows + macOS + Linux) with hardware + disk-aware model picker
- Nexus VS Code extension (multi-model successor to Gemma Code) bundled as opt-in add-on
- NVIDIA SANA family as default 1024px image model (SANA-1.6B + Sana-Sprint + 2K/4K/INT4 + ControlNet)
- SANA-Video 2B as Fast 720p video tier
- Hybrid memory retrieval (BM25 + dense + graph via RRF) with bundled local embedder
- Session replay timeline, /recall, /remember, /forget slash commands
- Closed v1.0.0 shared-core build carryforward cluster

See CHANGELOG.md and docs/versions/v1/v1.1.0/release-notes.md for the full surface.
EOF
)"
```

The release operator pushes the tag only after the Phase 15.11 final stabilization pass is green:

```bash
git push origin v1.1.0
```

### 1.2 Artifacts

The v1.1.0 GitHub Release page carries six binary artifacts plus the SHA-256 manifest:

| Artifact | Built by | Signing / notarization |
|---|---|---|
| `Nexus-1.1.0-Setup.exe` | `installer-build.yml` (windows-latest) | Authenticode-signed via OA-01 EV cert (operator-procured). |
| `Nexus-1.1.0-Setup.exe.sha256` | Same | -- |
| `Nexus-1.1.0.dmg` | `installer-macos.yml` (macos-latest) | Apple Developer ID notarized + stapled per OA-11. |
| `Nexus-1.1.0.dmg.sha256` | Same | -- |
| `Nexus-1.1.0-x86_64.AppImage` | `installer-linux.yml` (ubuntu-latest) | Unsigned; AppImage spec relies on user-side trust. |
| `Nexus-1.1.0-x86_64.AppImage.sha256` | Same | -- |
| `Nexus-1.1.0-checksums.txt` | Release workflow consolidation | One file consolidating all three SHA-256 lines for one-command verification. |
| Source tarball + zip | GitHub auto-generated | -- |

### 1.3 Release description

The GitHub Release body is populated from [docs/versions/v1/v1.1.0/release-notes.md](release-notes.md) (the user-facing notes). The semantic-release plugin auto-generates a per-commit summary; the Phase 15.7 release-notes content overrides it via `.releaserc.json`'s `@semantic-release/github` plugin config.

### 1.4 SmartScreen / Gatekeeper reputation

- **Windows (OA-01 / OA-02)**: the renewed EV cert + the same publisher identity continue accruing reputation against v1.0.0. v1.1.0 does not reset the reputation curve provided the signing thumbprint matches the v1.0.0 signing thumbprint. If the operator rotates the cert at v1.1.0, the reputation curve restarts; document this in the release-notes "Compatibility notes" section.
- **macOS (OA-11)**: notarized DMG passes Gatekeeper on first launch. The stapled ticket is verified offline; no internet round-trip required at install time.
- **Linux (OA-12)**: no central trust authority. The AppImage is documented as needing `chmod +x` plus the user's explicit "trust" gesture in their desktop environment. The SHA-256 manifest on the GitHub Release page is the canonical integrity check.

---

## 2. VS Code Marketplace (renamed listing: `nexus-coding`)

### 2.1 What ships under the Marketplace listing

The v1.1.0 Marketplace VSIX is the renamed `nexus-coding` extension (publisher: `nexus-coding`). Phase 10 ([phase-10-vscode-thin-adapter-and-republish.md](plans/phase-10-vscode-thin-adapter-and-republish.md)) lands the thin-adapter rewrite: the extension delegates every panel + every tool call to the desktop daemon over JSON-RPC when the daemon is running, and falls back to extension-only mode (in-process LLM hosting) when it is not.

Phase 11 ([phase-11-nexus-vscode-extension.md](plans/phase-11-nexus-vscode-extension.md)) extends the thin adapter into a full agentic surface inside VS Code:

- Plan mode + auto mode (driven by the daemon).
- Memory panel (four-layer view via webview).
- Skills (DevAI-Hub baseline + user skills) in slash-command autocomplete.
- Sub-agents stream their progress.
- Sessions persist across VS Code <-> daemon disconnect.
- MCP tools resolve via the daemon's MCP harness.
- Settings sync from the desktop app's settings store -- one source of truth.
- **Selectable across all installed local models** (not just Gemma 4): the model dropdown surfaces every Ollama model the daemon reports as resident (`gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b`, `phi-3.5`, etc.).

### 2.2 Publish workflow

```powershell
# In repo root.
npm install
npm run build
npm run package           # runs scripts/build-vsix.ps1
# or, for a quick local check:
npm run package:quick     # runs `vsce package`
vsce publish --packagePath nexus-coding-1.1.0.vsix
```

The Personal Access Token lives in the operator's keychain; for CI publishing, store as GitHub secret `VSCE_PAT` and gate the publish step on tag-push. See [marketplace-transition.md](marketplace-transition.md) OA-V1.1.0-10A for the full operator-action checklist.

### 2.3 Listing description (v1.1.0)

The Marketplace listing description leads with the multi-model agentic surface:

> **Nexus Coding** -- a multi-model agentic coding assistant for VS Code. When the Nexus desktop daemon is running, the extension exposes the full Coding-pillar surface (plan mode, auto mode, four-layer memory, skills, sub-agents, sessions, slash commands, MCP tools) and lets you pick any installed local model (Gemma 4, Llama 3.1, Qwen 2.5 Coder, Phi-3.5, ...). When the daemon is not running, the extension falls back to extension-only mode (in-process LLM hosting against your default model). Download the full Nexus desktop installer at https://github.com/bendourthe/Nexus-AI/releases.
>
> **Migrating from `gemma-code`**: this listing is the renamed successor to the v0.x `gemma-code` extension. The legacy `gemma-code` listing carries a transition note pointing here; your previously-bound `gemma-code.<cmd>` keybindings continue to work via the compat shim (with a one-shot deprecation log per session) and will be removed in v1.2.0.

### 2.4 Legacy `gemma-code` listing transition note

Per Phase 10's marketplace-transition checklist (OA-V1.1.0-10B), the legacy `gemma-code` listing remains live in the Marketplace with its description updated to surface the rename:

> **This listing is being retired.** Nexus Coding ships under the renamed `nexus-coding` listing as of v1.1.0. Install `Nexus Coding` (publisher: `nexus-coding`) to receive future updates. Your existing keybindings and settings continue to work in the new listing via the v1.1.0 compat shim (deprecation logs print once per session; legacy IDs are removed in v1.2.0).

The legacy listing continues to receive critical security patches through v1.2.0 (matching the compat-window deprecation schedule).

---

## 3. Direct-download landing page (deferred to v1.1.1)

Goal: `https://nexus.bendourthe.com/download` (or equivalent) hosts a one-page download landing site with platform-aware "Download Nexus" CTAs that detect the visitor's OS via `navigator.userAgent` and surface the matching installer button (`Nexus-1.1.0-Setup.exe` / `Nexus-1.1.0.dmg` / `Nexus-1.1.0-x86_64.AppImage`) prominently, with the other two as secondary downloads.

Out of scope for v1.1.0; tracked under operator action OA-05 (carried forward from v1.0.0). The GitHub Release URL remains the canonical distribution surface for v1.1.0.

---

## 4. Ollama-style direct-download (deferred)

Out of scope for v1.1.0. The three Nexus installers are self-contained; an Ollama-style direct binary (no NSIS / no DMG / no AppImage, no wizard) is a v1.2.0+ exploration if there is demand for headless / CLI-only install on dedicated GPU rigs.

---

## 5. Validation checklist

Before declaring 15.10 complete:

- [ ] `v1.1.0` tag created and ready to push (NOT pushed until 15.11 is green).
- [ ] Release-notes content ([release-notes.md](release-notes.md)) ready to paste into the GitHub Release body.
- [ ] `Nexus-1.1.0-Setup.exe` build verified via `installer-build.yml` workflow_dispatch dry-run.
- [ ] `Nexus-1.1.0.dmg` build verified via `installer-macos.yml` workflow_dispatch dry-run.
- [ ] `Nexus-1.1.0-x86_64.AppImage` build verified via `installer-linux.yml` workflow_dispatch dry-run.
- [ ] VSIX build verified (`vsce package` produces a `nexus-coding-1.1.0.vsix`).
- [ ] Marketplace listing description draft reviewed (both renamed and legacy listings).
- [ ] Operator action OA-05 (direct-download landing page) logged for v1.1.1.

---

## References

- [docs/versions/v1/v1.0.0/distribution.md](../v1.0/distribution.md) -- v1.0.0 distribution structure this file mirrors.
- [docs/versions/v1/v1.0.0/operator-actions.md](../v1.0/operator-actions.md) -- OA-01 through OA-12 (signing, notarization, AppImage, landing page).
- [docs/versions/v1/v1.1.0/operator-actions.md](operator-actions.md) -- v1.1.0 extensions to OA-09 (SANA timings) + OA-V1.1.0-12A (SANA digest rotation).
- [docs/versions/v1/v1.1.0/marketplace-transition.md](marketplace-transition.md) -- Phase 10 Marketplace transition checklist (OA-V1.1.0-10A + OA-V1.1.0-10B).
- [docs/versions/v1/v1.1.0/release-notes.md](release-notes.md) -- v1.1.0 user-facing release notes.
- [docs/versions/v1/v1.1.0/known-gaps.md](known-gaps.md) -- v1.1.0 gap log (finalized at Phase 15.9).
