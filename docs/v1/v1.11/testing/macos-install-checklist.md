# macOS Install Checklist (manual)

v1.11.0 Phase 2 (T204). macOS cannot be virtualized on the Windows dev host,
so the macOS install path is verified manually on a physical Mac using this
checklist. It mirrors the assertions the Windows Sandbox / Docker harnesses
make automatically.

**Preconditions:** a Mac WITHOUT Ollama, a Nexus install, or the VS Code
extension (or a fresh macOS user account). Record macOS version and
Apple-silicon vs Intel.

## A. Packaging

- [ ] `bash scripts/installer/build/build-macos.sh` produces a single launchable artifact.
- [ ] Double-clicking it opens exactly one branded installer window (no terminal window).
- [ ] Gatekeeper unsigned-app flow is the documented right-click -> Open path.

## B. Wizard flow (fresh machine)

- [ ] Welcome -> Prerequisites: Python and Ollama probes correctly report "missing" (not errors).
- [ ] GPU Detection: Apple-silicon reports the Metal path; no crash on Intel.
- [ ] Install Path: default `/Applications/NexusAI`; disk-space gate reads real free space.
- [ ] Models: every category tab renders; disk-aware selection guard works.

## C. Engine steps (watch the Installing page)

- [ ] Ollama installs via Homebrew (or the documented fallback) with NO terminal interaction.
- [ ] Python env step bootstraps without a system Python assumption.
- [ ] A small model (`nomic-embed-text`) downloads with live per-model progress.
- [ ] The VS Code extension step: installs when VS Code exists; reports a clear "skipped: not found" otherwise.
- [ ] Desktop app installs and passes its first-launch health check.
- [ ] No step hangs: any failure shows a plain-language reason with View/Copy/Save log actions.

## D. Headless contract (same assertions as the harnesses)

- [ ] `python3 src/nexus_installer/main.py --headless-smoke testing/profiles/sandbox-minimal.json --smoke-output /tmp/r.json` (run from `scripts/installer/`, adjust paths in a mac profile) writes a `nexus-smoke-result/v1` JSON and exits non-zero on any step failure.

## E. Result

Record: date, macOS version, hardware, per-step pass/fail, and attach the
exported install log. File failures as v1.11.0 known-gaps rows.
