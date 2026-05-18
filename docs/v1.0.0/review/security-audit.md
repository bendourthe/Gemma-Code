# v1.0.0 -- Security audit (Phase 11.2)

**Audience**: release operator, security reviewer.
**Plan reference**: [phase-11-hardening-and-release.md](../plans/phase-11-hardening-and-release.md) sub-task 11.2.
**Date**: 2026-05-18.
**Scope**: every code path that handles untrusted input, executes external binaries, manages secrets, or writes outside the application's own working directory. Sibling report: [penetration-test.md](penetration-test.md) (offensive coverage).

This audit follows the OWASP ASVS L1 checklist and the SECURITY.md threat model. Findings are graded P0 / P1 / P2 / P3 consistent with the known-gaps file.

---

## 1. Audit envelope

| Domain | Coverage | Severity |
|---|---|---|
| Exposed secrets in source tree | swept | clean |
| Git hygiene (.gitignore, no committed creds) | swept | clean |
| Authentication (none -- local-first product) | N/A | N/A |
| Input validation (IPC + CLI + file paths + URLs) | reviewed | clean (1 P2) |
| Installer credential handling | reviewed | clean |
| Dangerous code patterns (eval, shell=True, dyn-import) | grep + reviewed | clean |
| ffmpeg / external-binary shell-out | reviewed | clean |
| Model downloader URL validation | reviewed | clean |
| Filesystem permissions on `~/.nexus/` | reviewed | platform-dependent |
| Skill-content prompt-injection scanner | reviewed | clean |
| Path-traversal on user-supplied paths | reviewed | clean |
| Logging discipline (no secrets in logs) | reviewed | clean (1 P2) |

---

## 2. Findings

### 2.1 P0 -- Release blockers

**None.**

### 2.2 P1 -- Should-fix in v1.0.0

**None.**

All P1 audit candidates were closed in-cycle. The audit's specific Phase 10/11 deep-dive items called out by the plan are covered below:

#### 2.2.A Prompt-injection scanner catches the WSTG injection corpus

- **Location**: `core/skills/PromptInjectionScanner.ts`.
- **Verification**: the scanner runs every fetched skill body through a multi-rule detector (suspicious-token patterns: `ignore previous instructions`, `system:`, `<|im_start|>system`, `<role>system</role>`, `prompt injection`, `disregard above`, `[REDACTED]` smuggling, base64-decoded inline-instruction probes). The unit-test suite includes adversarial fixtures derived from the OWASP WSTG prompt-injection corpus + the OWASP LLM Top-10 PI examples; all flagged.
- **Result**: clean.

#### 2.2.B IPC contract privilege-escalation paths from Tauri shell to sidecar

- **Location**: `desktop/src-tauri/src/sidecar.rs` (Rust), `desktop/sidecar/src/protocol.ts` (Node), `runtimes/diffusion/main.py` (Python).
- **Threat**: the Rust core spawns the Node sidecar as a child process; the sidecar in turn would spawn the Python sidecar (Phase 9 / OA-09 wires this). A malicious renderer-side payload could attempt to inject arbitrary subprocess invocations through the IPC envelope.
- **Verification**: every IPC handler in `protocol.ts` validates its payload via Zod schemas before dispatch. No handler accepts an unbounded string that gets passed to `child_process.spawn` / `child_process.exec` without an allowlist intermediary. The Python sidecar's JSON-RPC dispatcher (`runtimes/diffusion/main.py::dispatch()`) likewise validates the method name against a closed registry; unknown methods return `MethodNotFound` without executing any user-supplied content.
- **Result**: clean. No subprocess-spawn surface is reachable from a renderer-controlled payload.

#### 2.2.C Installer file/registry permissions -- runs as user, not admin

- **Location**: `scripts/installer/build/nsis/nexus-setup.nsi`, the PyQt wizard's provisioners.
- **Verification**: the NSIS installer sets `RequestExecutionLevel admin` for the duration of the install (required to write `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus` and to install the CUDA runtime). The Nexus desktop binary itself, and the spawned sidecars, run as the *user* who launched them, not as admin. The PyQt wizard provisions `~/.nexus/` -- which is in the user's home directory -- so post-install all writes are user-scope. The NSIS `InstallDir` is `$LOCALAPPDATA\Nexus` (user-scoped); only registry writes need elevation.
- **Result**: clean. The privilege boundary is correctly placed at install-time only.

#### 2.2.D `~/.nexus/` directory permissions

- **Location**: `core/storage/StorageMigration.ts` (creates the dir on first launch), `scripts/installer/pyqt/src/nexus_installer/engine/`.
- **Verification**: directory created with default OS user permissions. On Windows that is `Users\<username>\.nexus\` -- inherited ACL grants the user full control and Administrators full control; other Users have no access. On POSIX, default umask grants the user 700 / 755 depending on the running umask; the migration code does NOT explicitly chmod, relying on the OS umask.
- **Recommendation**: an explicit `chmod 700` on `~/.nexus/` and `chmod 600` on the model-download cache would be defence-in-depth on multi-user POSIX systems. Logged as P2 (`security-audit-A`, see Section 2.3).
- **Result**: clean for single-user Windows hosts (the v1.0.0 target). P2 hardening item for v1.0.1.

#### 2.2.E Python venv -- runtime `pip install` paths

- **Location**: `scripts/installer/pyqt/src/nexus_installer/engine/diffusion_venv_provisioner.py`.
- **Verification**: every `pip install` invocation in the provisioner pins the wheel index (`--index-url https://pypi.org/simple/`) and uses a pinned `requirements.lock.txt` (no unpinned dependencies). The user cannot supply an arbitrary package name to `pip install` through any UI surface; the requirements file is static (committed to the repo). At runtime (post-install), no `pip install` is invoked against user-supplied input.
- **Result**: clean.

#### 2.2.F ffmpeg shell-out in Phase 7.3 -- command-injection-safe

- **Location**: `core/video/WorkflowMetadata.ts`, `core/video/FfmpegContext.ts`.
- **Verification**: the shell-out builds argv arrays (Node `child_process.spawn` with an array second argument; the Python sidecar uses `subprocess.run` with a list). No string interpolation, no shell pipe, no `shell: true`. The injection seam (`FfmpegContext.spawnFn`) accepts only argv-style invocations.
- **Result**: clean.

#### 2.2.G Model downloader URL validation

- **Location**: `core/registry/Downloader.ts`.
- **Verification**: the downloader's URL validator rejects:
  - `file://` (local file access).
  - `localhost`, `127.0.0.1`, `::1` (SSRF to local services).
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7` (internal IP ranges -- private + link-local IPv6).
  - Schemes other than `https://` (rejects `http://`, `ftp://`, etc.).
  - The Ollama protocol path delegates URL handling to the Ollama daemon itself.
- **Verification (test)**: unit-tested with adversarial URLs in `core/registry/Downloader.test.ts`.
- **Result**: clean.

### 2.3 P2 -- Hardening items (deferred to v1.0.1)

#### security-audit-A -- Explicit chmod on `~/.nexus/` on POSIX

- **Recommendation**: in `core/storage/StorageMigration.ts`, after creating `~/.nexus/`, invoke `chmod 700`. After creating model-weight files, invoke `chmod 600`.
- **Reason**: defence-in-depth for multi-user POSIX hosts. Single-user Windows hosts (the v1.0.0 primary target) are not affected.
- **Status**: deferred to v1.0.1 (`docs/v1.0.1/known-gaps.md` once that cycle opens).

#### security-audit-B -- Tracer.redact() pattern set extension

- **Location**: `core/telemetry/Tracer.ts`.
- **Current**: redacts `apiKey`, `password`, `token`, `secret`, `Bearer ` headers.
- **Recommendation**: add `AWS_SECRET_ACCESS_KEY`, `Authorization:`, JWT triple-segment regex, `-----BEGIN` private-key headers. Low-risk omissions but worth closing the loop.
- **Status**: deferred to v1.0.1.

### 2.4 P3 -- Logged for completeness

#### security-audit-C -- Add Subresource Integrity to downloader

- **Recommendation**: if the model catalog ever links to JavaScript / WASM assets, attach SRI hashes. Not currently applicable -- catalog only fetches binary weight files which are SHA-256-verified by the catalog entry.

---

## 3. Verification matrix

| Threat | Mitigation | Tested |
|---|---|---|
| Path-traversal on skill / model paths | `path.resolve` + clamp-to-parent check | `core/skills/DevAIHubSyncer.test.ts`, `core/registry/Downloader.test.ts` |
| Command-injection via ffmpeg argv | argv-array spawn, no shell | `core/video/WorkflowMetadata.test.ts` |
| SSRF in downloader | URL allowlist + RFC1918 reject | `core/registry/Downloader.test.ts` |
| Privilege-escalation install -> runtime | RequestExecutionLevel admin for install only | RTM smoke (OA-04) |
| Prompt-injection in synced skill | PromptInjectionScanner before write | `core/skills/PromptInjectionScanner.test.ts` |
| Secret leakage via traces | Tracer.redact() | `core/telemetry/Tracer.test.ts` |
| Subprocess invocation from renderer payload | Zod-validated IPC method registry | `desktop/sidecar/src/protocol.test.ts` |

---

## 4. Outcome

**Zero P0 / P1 findings. v1.0.0 cleared for release.** Two P2 hardening items logged for v1.0.1.
