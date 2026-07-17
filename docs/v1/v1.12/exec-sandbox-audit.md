# Code-Execution Sandbox Hardening Audit (v1.12.0 Phase 5 / H3)

**Version**: v1.12.0
**Generated**: 2026-07-16
**Author**: Claude Code -- /implement Phase 5 (adoption-ecosystem-2026-07 H3)
**Scope**: Nexus's isolation for agent-run shell commands / code (`run_terminal`) vs an OS-level process sandbox (macOS Seatbelt, Linux Landlock/seccomp, Windows job objects / AppContainer) of the kind the Codex-lineage Open Interpreter uses.
**Verdict (at a glance)**: Nexus has **NO OS-level process sandbox**. Its isolation is tool-layer command-string filtering + a human confirmation gate + env-var scrubbing + a working-directory re-root, all running in-process at the app user's full privilege. For the "confine an approved-but-harmful command" threat, this is **materially weaker** than an OS sandbox. One concrete, bounded gap was **closed this phase** (the secret-path denylist now gates `run_terminal`); the larger gap (no OS process confinement) is a multi-cycle native, cross-OS feature recorded as `EM.P5.A`, not landed here.

---

## 1. Nexus's current isolation model (facts)

Agent commands run via [src/tools/handlers/terminal.ts](../../../src/tools/handlers/terminal.ts) `RunTerminalTool`:

```ts
const child = spawn(command, [], { shell: true, cwd, env: this._childEnv() });
```

`child_process.spawn` with `shell: true` -- the whole command string is handed to `/bin/sh` (POSIX) or `cmd.exe` (Windows). The child runs as the **same OS user** as the extension host, with the full ambient authority that user has (filesystem, network, processes). The only runtime bound is a wall-clock timeout (`SIGTERM` after 30s).

A repo-wide search for `sandbox-exec | seatbelt | landlock | seccomp | bubblewrap | firejail | AppContainer | CreateRestrictedToken | JobObject | prctl | setuid | chroot | nsjail` across all runtime code returns **no matches**. There is no process confinement anywhere in the runtime.

The isolation Nexus *does* have, all at the tool layer:

| Control | What it does | Confines the... | Fail-closed? | Always-on? |
|---|---|---|---|---|
| Hard blocklist ([commandBlocklist.ts](../../../src/tools/commandBlocklist.ts) `isBlocked` / `BLOCKED_PATTERNS`) | Refuses ~14 literal destructive substrings (`rm -rf /`, `mkfs`, ...) | command STRING | yes | yes (its own docstring calls it "advisory") |
| Allowlist (`isAllowlisted`) | Labels the confirmation prompt "OUTSIDE the allowlist" | -- (advisory only) | n/a | n/a (not a gate) |
| Touched-path deny ([shellIntrospection.ts](../../../modules/coding/guardrails/shellIntrospection.ts) + `ToolRegistry._denyByTouchedPath`) | Matches statically-enumerated touched paths against operator `.nexus/permissions.deny` rules | command STRING | yes | **no** -- dormant unless the operator authored a denylist |
| **Secret-path deny (NEW, this phase)** | Refuses a `run_terminal` command that touches a built-in secret path (`.env`, `~/.ssh/id_rsa`, `*.pem`, `.aws/**`, ...) | command STRING | yes | **yes** |
| Permission tier + [ConfirmationGate](../../../src/tools/ConfirmationGate.ts) | `run_terminal` is DANGEROUS-tier -> a human prompt on the whole call (auto-reject on 60s timeout; cannot be downgraded) | -- (human-in-loop) | yes | yes |
| Env scrub ([scrubEnv.ts](../../../core/observability/scrubEnv.ts), `terminalEnvScrub` default true) | Drops secret-shaped env vars before spawn | env exposure | -- | yes |
| Worktree / snapshot ([WorktreeManager.ts](../../../modules/coding/agents/WorktreeManager.ts), [goldenSnapshot.ts](../../../modules/coding/evaluation/goldenSnapshot.ts)) | Runs the agent in a separate working directory / git tree | working DIR only | -- | opt-in |

Every control is a **filter on the command string**, a **prompt to the human**, an **env scrub**, or a **choice of cwd**. None is an OS enforcement boundary: once a command is approved, it runs unconfined.

## 2. Threat-by-threat vs an OS process sandbox

| Threat | OS sandbox (Seatbelt / Landlock+seccomp / job object) | Nexus today |
|---|---|---|
| An approved command does more than intended | Damage contained -- the process is confined to allowed paths/syscalls/network regardless | **Uncontained** -- runs with full user authority once approved |
| Read a secret file (`cat ~/.ssh/id_rsa`) | Blocked by the FS sandbox | **Now gated** for statically-parseable commands (this phase); still slips via an interpreter (below) |
| Arbitrary code via an allowlisted interpreter (`python -c "..."`, `node -e "..."`) | Confined by the sandbox regardless of what the code does | **Not confined** -- the interpreter runs freely; paths inside its args are invisible to introspection |
| Paths hidden by dynamic constructs (`$(...)`, backticks, `%VAR%`) | Confined | **Fail-open** to the tier + confirmation gate (introspection returns `parsed:false`) |
| Network egress (`curl evil.tld`) | Kernel/proxy-enforced deny | **Unrestricted** -- the SSRF denylist ([ssrf.ts](../../../modules/coding/utils/ssrf.ts)) only guards Nexus's own `fetch`, not spawned commands |
| Write outside the workspace | Confined to the sandbox's path allowlist | **Unrestricted** -- `cwd` is re-rooted but a command can `cd /` and write anywhere the user can |

## 3. Verdict

Nexus's exec isolation is **materially weaker** than an OS process sandbox for the core threat an agentic coding tool must defend: *a command that is approved (or slips the blocklist) but does harm*. Nexus's primary defense against that is a **human confirmation prompt plus a tiny literal blocklist** -- once the human approves, nothing confines the process. An OS sandbox contains the damage *even when the command is approved*. This is a genuine, structural gap, not a nuance.

Per the H3 Stability Gate ("harden if weaker; any change only ever tightens, fail-closed"), the audit distinguishes **two** remediations of very different size:

## 4. Hardening landed this phase (bounded, verifiable, cross-OS)

The audit found a concrete inconsistency that is safe to close now: the built-in secret-path denylist (`matchesSecretPath`, patterns from [nexus.security.toml](../../../nexus.security.toml)) gated the **file-read tools** (`read_file(".env")` was refused) but **not** `run_terminal` (`echo x > .env` / `cat .env` slipped through). This phase adds an **always-on, fail-closed** secret-path gate to `run_terminal` in [ToolRegistry](../../../src/tools/ToolRegistry.ts) (`_denyBySecretPath`), reusing the existing shell introspection: a statically-parseable command that touches a built-in secret path is refused with the same policy as `read_file`. It runs *after* the operator `.nexus/permissions.deny` gate (so operator rules keep precedence) and honors `nexus.secretPathDenyExtra` (parity with the file tools). It only ever tightens; a dynamic command falls through to the DANGEROUS-tier confirmation. Verified by 4 unit tests (secret write refused, non-secret allowed, dynamic falls through, operator extra patterns honored), cross-OS via redirection enumeration; full root suite green.

This does **not** confine the process -- it closes the read/write-a-secret-path-via-terminal parity gap, one concrete slice of the larger sandbox gap.

## 5. The OS-process-sandbox gap -- recorded, NOT landed (`EM.P5.A`)

Full OS-native process sandboxing is the correct long-term remediation but is a **multi-cycle, platform-specific, native undertaking** far beyond a single conditional-hardening phase, and it cannot be verified in a headless CI (it needs the three target OSes + their sandbox syscalls). It is recorded as `EM.P5.A` with a recommended approach:

- **macOS**: wrap the spawn in `sandbox-exec` with a Seatbelt profile (FS allowlist = workspace + tool dirs; deny network unless opted in).
- **Linux**: Landlock (FS) + a seccomp filter (syscall allowlist), or a `bubblewrap` wrapper.
- **Windows**: a restricted-token / job-object confinement (or AppContainer), the weakest-supported of the three.
- Applied at the `spawn` site in `terminal.ts`, behind an off-by-default `nexus.coding.execSandbox` setting during rollout, with a per-OS capability probe (degrade to today's tier + confirmation when the OS primitive is unavailable). Must only ever tighten (fail-closed), and be tested on all three OSes before default-on.

Until then, the honest statement (to be reflected in [SECURITY.md](../../../SECURITY.md)) is: Nexus's defense against a harmful agent command is the confirmation gate + blocklist + secret-path/path denylists + env scrub, **not** OS process confinement. Regulated / high-assurance users should run Nexus against a trusted model on a host where the blast radius of an approved command is acceptable, or in an externally-sandboxed environment (container/VM), until `EM.P5.A` lands.

## 6. Cross-OS + verification

The runtime terminal does not branch per-OS at the spawn site (Node picks `/bin/sh` vs `cmd.exe`); the introspection is dialect-aware (`bash`/`cmd`/`powershell`). The secret-path hardening landed this phase is cross-OS (redirection-target enumeration is dialect-agnostic; `matchesSecretPath` is `nocase` on win32). Verified: `tsc -b` clean, `eslint` 0 warnings, `check-architecture` 0 errors, full root suite green (4639 passed / 6 skipped / 0 failed).
