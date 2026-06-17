# Cross-Project Comparison: Nexus (v1.5.0 codebase) vs. optimizerDuck -- a reversible, risk-rated Windows system optimizer

**Version**: v1.6.0 (forward-input single-source comparison for the v1.6.0 cycle; analysis snapshot taken against the v1.5.0 codebase on the `feat/v1.5.0-phase-3-inbound-security` branch, 2026-06-16)
**Generated**: 2026-06-16T00:00:00Z
**Analyzer**: Claude Code -- /compare
**Source Type**: Git repository -- [itsfatduck/optimizerDuck](https://github.com/itsfatduck/optimizerDuck). An open-source (GPL v3) C#/WPF/.NET desktop tool that speeds up Windows, improves privacy, and strips bloat via 30+ system tweaks plus built-in managers (startup, bloatware, scheduled tasks, disk cleanup), a system dashboard, and a one-click revert feature backed by automatic per-change backups.
**User framing**: "An open-source Windows optimizer that speeds up your PC, improves privacy, and strips away bloat with a clean, straightforward UI ... over 30 proven system tweaks and built-in tools like startup and bloatware managers, plus a one-click revert feature with automatic backups so you can experiment safely."
**Cycle context (user-directed)**: this comparison is run while the v1.6.0 [adoption-aisuite-harness](plans/adoption-aisuite-harness.md) plan is wrapping (its Phase 6 whole-plan acceptance gate closed 2026-06-16, per [known-gaps.md](known-gaps.md)) and the [adoption-openrouter-fusion](plans/adoption-openrouter-fusion.md) plan is **written but not started**. Per the user's instruction, any optimizerDuck adoption is sequenced **strictly after** that queued Fusion work and is explicitly **not** allowed to preempt it or open a competing cycle.
**Companion reports**: [comparison-aisuite.md](comparison-aisuite.md) and [comparison-openrouter-fusion.md](comparison-openrouter-fusion.md) (this cycle's other two single-source comparisons).
**Decision lens**: [AGENTS.md](../../../../AGENTS.md) MCP Registry Policy -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. Hard no: search / embeddings / scraping / generation as a service; no outbound calls without explicit user opt-in; no telemetry by default.
**Wording convention**: per [development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md), every claim about an *unbuilt* Nexus capability is stated at `candidate` or `future` tier, never `supported`. optimizerDuck's own feature claims are quoted at `vendor-described` confidence (a single read of its README/repo summary, not a build or audit). "not_observed != absent" applies to the Nexus code map.

This is a **cross-domain** comparison: optimizerDuck is a Windows OS optimizer (C#/WPF/.NET 10, writes to the registry/services/scheduled tasks/shell), and Nexus is a local-first TypeScript desktop AI Studio (four pillars, agent harness, local inference). There is **no product-level overlap** -- Nexus does not optimize the host OS and never will. The comparison is therefore deliberately narrow: it ignores the entire OS-tweak surface (which is not-applicable by construction) and asks only one useful question -- *does optimizerDuck embody any engineering pattern, at the level of how it manages risky, reversible change, that Nexus would be better for adopting?* The answer is that optimizerDuck and Nexus have **independently converged** on the same safety philosophy (risk-rate every action; no defaults; capture a backup before a destructive change; one-click revert; zero telemetry; build from public source), and Nexus already ships a mechanism for each. The **single** axis on which optimizerDuck is genuinely more granular than Nexus is its **typed, per-change revert ledger with selective one-click rollback over non-git state** (Registry / Service / Scheduled-Task / Shell revert steps, JSON-persisted) -- and that maps onto a real, narrow Nexus gap, because Nexus's revert mechanism (`GitSafetyNet`) is an all-or-nothing `git reset --hard` that does not cover the out-of-repo / terminal / MCP side effects its own `ActionClassifier` flags as destructive.

---

## 1. Executive Summary

optimizerDuck applies up to ~30 curated Windows tweaks across six categories (performance, privacy, GPU, power, bloatware/services, UX), discovered automatically via reflection + custom attributes rather than hand-registration. Each tweak carries a **risk rating** (Safe / Moderate / Risky), **nothing runs without explicit user selection** (no defaults applied), and **every modification writes a revert file** of one of four typed kinds (Registry, Service, Scheduled Task, Shell), JSON-persisted with thread-safe I/O, so any single tweak -- or the entire set -- can be rolled back with one click. It collects **zero telemetry**, runs fully offline, and its releases are **built from public source by GitHub Actions** (no post-build binary tampering). These are `vendor-described` from the repo summary, not independently verified.

Mapped against Nexus's Coding-pillar harness, the analysis surfaces **9 distinct capabilities/ideas**, of which **0 require net-new adoption beyond one narrow item**, **4 are already implemented convergently and should simply be preserved** (risk-rated actions, manifest auto-discovery, no-telemetry/offline, build integrity), **1 is partially implemented and is the lone genuine adoption candidate** (a typed per-action revert ledger), and **4 are not-applicable / dropped on domain or stack grounds** (the OS-tweak surface, the OS resource dashboard, UI localization, the portable-.exe distribution model).

The dominant finding is **"convergent on safety philosophy; one granularity gap worth a single backlog item."** Nexus already classifies every tool call as `REVERSIBLE` / `DESTRUCTIVE` / `BLOCKED` with `requiresCheckpoint` / `enhancedConfirmation` flags ([modules/coding/guardrails/ActionClassifier.ts](../../../../modules/coding/guardrails/ActionClassifier.ts)) -- the direct analogue of optimizerDuck's Safe/Moderate/Risky badges -- and creates a pre-run checkpoint + hard-reset rollback via [modules/coding/guardrails/GitSafetyNet.ts](../../../../modules/coding/guardrails/GitSafetyNet.ts) -- the analogue of optimizerDuck's automatic-backup-then-revert. It auto-discovers pluggable units from validated manifests (the v1.6.0 `LocalAdapterRegistry`, the skills catalog, the MCP registry) the way optimizerDuck auto-discovers tweaks via attributes. It is no-outbound-by-default with no telemetry. And it ships a tampering check + builds from source in CI.

The one place optimizerDuck's design is materially finer-grained is **revert granularity and coverage**:

- **(O1) A typed, per-action revert ledger ("mutation journal") with selective one-click rollback** (`re-full`): `GitSafetyNet` checkpoints the *whole* working tree and reverts via `git reset --hard <sha>` -- an all-or-nothing reset to a SHA, repo-scoped only. It cannot revert *one* agent action selectively, and it does **not** cover the destructive actions `ActionClassifier` itself flags but does not git-protect: `write_file`/`edit_file`/`create_file` (which set `requiresCheckpoint: false`), `delete_file` and `run_terminal` side effects that touch files **outside** the git repo or the filesystem in non-tracked ways, and MCP tool mutations. optimizerDuck's revert system solves exactly this -- a typed pre-state capture (Registry/Service/Task/Shell) per change, individually revertible. The Nexus equivalent is a local `MutationJournal` under `modules/coding/guardrails/` that captures typed pre-state for destructive, non-git-revertible actions and offers selective rollback, **reusing the v1.6.0 A1 `ArtifactStore`** ([core/memory/ArtifactStore.ts](../../../../core/memory/ArtifactStore.ts), content-addressed + redaction-on-write) for the captured blobs and `ActionClassifier`'s existing `requiresCheckpoint` signal as the trigger.

Everything else is either a strength to keep (O2-O5) or out of scope (D1-D4). Crucially, **O1 is one small, optional, local-only backlog item -- not a version cycle.** It does not justify a `comparison -> plan` chain of its own ahead of the queued [adoption-openrouter-fusion](plans/adoption-openrouter-fusion.md) work, which is the genuinely high-value next build. The honest recommendation is to record O1 in the v1.6.0 [known-gaps ledger](known-gaps.md) as a `candidate` and fold it into a *later* cycle, after Fusion.

---

## 2. Source Inventory

Because the source is a peer repository in an unrelated domain, this inventory compares **how each project manages risky, reversible change and pluggability**, and explicitly brackets the OS-optimization surface as not-applicable.

| Field | optimizerDuck | Nexus |
|---|---|---|
| Identity | Windows system optimizer: 30+ tweaks + managers, one-click revert | Local-first four-pillar desktop AI Studio (Coding / Chat / Image / Video) |
| Stack | C# 94% / WPF on .NET 10 / WPF UI (Fluent); single unsigned portable `.exe` | TypeScript; VS Code extension + Electron desktop + Node sidecar |
| What it mutates | The host OS: registry, services, scheduled tasks, shell, AppX packages | The user's codebase + workspace; local inference runtimes; never the OS |
| Risk model | Per-tweak **Safe / Moderate / Risky** badge; **no defaults** -- nothing runs unselected | Per-action `ActionClassifier`: **REVERSIBLE / DESTRUCTIVE / BLOCKED** + `requiresCheckpoint` / `enhancedConfirmation`; three-tier permissions + denylist |
| Backup / revert | **Per-change revert file**, 4 typed kinds (Registry / Service / Task / Shell), JSON-persisted, thread-safe; **selective** one-click revert of any single tweak or full rollback | `GitSafetyNet`: pre-run checkpoint (HEAD SHA + auto-stash) -> **all-or-nothing** `git reset --hard`; repo-scoped only; no per-action selective revert; no coverage of non-git mutations |
| Extensibility / discovery | Tweaks **auto-discovered via reflection + custom attributes** | Pluggable units **auto-discovered via validated manifests**: `LocalAdapterRegistry` (v1.6.0), skills catalog, MCP registry |
| Telemetry / network | **Zero** telemetry; runs fully offline | **No outbound by default**; local models on loopback; no telemetry by default |
| Build integrity | GitHub Actions **builds releases from public source** (no post-build tampering); unsigned | `check:tampering` (0 findings) + CI build from source; security-SSOT in sync |
| Observability | "System Dashboard": CPU / RAM / GPU / storage / OS monitoring | Always-on **GPU / VRAM** telemetry ([core/telemetry/GpuTelemetrySource.ts](../../../../core/telemetry/GpuTelemetrySource.ts)) -- scoped to what local inference needs |
| Localization | 10 languages (community translators) | English only |
| Distribution | Single portable `.exe`, no install | VS Code extension / Electron app |

---

## 3. Capability Comparison (per dimension)

Legend: `+` external-only (adoption candidate) | `=` current-only (strength to preserve) | `~` both, different approach | `.` both, equivalent.

### 3.1 Risk-rated actions, no defaults -- `.` (convergent; Nexus equivalent or stronger)

optimizerDuck badges every tweak Safe / Moderate / Risky and applies **nothing** without explicit selection. Nexus's [ActionClassifier.classifyAction](../../../../modules/coding/guardrails/ActionClassifier.ts) returns `REVERSIBLE` / `DESTRUCTIVE` / `BLOCKED` per tool call, with `requiresCheckpoint` and `enhancedConfirmation` flags, a read-only allowlist, a destructive-pattern list, a hard blocklist (`isBlocked`), and default-deny for unrecognized shell commands -- sitting on top of the three-tier permission model + `.nexus/permissions.deny` denylist. This is a direct, arguably finer-grained analogue (it also has a hard-blocked tier optimizerDuck's three-level scale lacks). **Equivalent; preserve (-> O2).**

### 3.2 Automatic backup + revert -- `~` (Nexus reverts coarsely; optimizerDuck reverts selectively)

This is the crux. optimizerDuck writes a **typed revert file per change** and can roll back **any single tweak** or everything. Nexus's [GitSafetyNet](../../../../modules/coding/guardrails/GitSafetyNet.ts) takes a pre-run checkpoint (`createCheckpoint`: record HEAD SHA + `git stash` if dirty) and reverts with `rollback`: `git reset --hard <headSha>` then `stash pop`. Three structural differences make optimizerDuck's design genuinely more capable for the destructive actions Nexus already recognizes:

1. **Granularity**: `git reset --hard` is all-or-nothing to a SHA. There is no "undo just this one edit / this one command" the way optimizerDuck reverts a single tweak.
2. **Coverage**: the checkpoint only protects **git-tracked working-tree** state. `ActionClassifier` flags `delete_file` and destructive `run_terminal` patterns with `requiresCheckpoint: true`, but if the command writes outside the repo (global config, an installed package, a file in another directory) or the workspace is not a git repo (`createCheckpoint` returns `null`), `git reset` reverts nothing. And `write_file`/`edit_file`/`create_file` + MCP tools are set `requiresCheckpoint: false` -- so a multi-file agent edit has no per-action revert beyond the coarse session checkpoint.
3. **Typed pre-state**: optimizerDuck records *what kind* of thing changed (Registry/Service/Task/Shell) so the revert is precise. Nexus has no typed mutation record; it has a SHA and a stash.

**Partial; this is the lone genuine adoption candidate (-> O1).** The Nexus build is a local `MutationJournal` that captures typed pre-state (file-content snapshot, delete-tombstone, command-effect note) for `DESTRUCTIVE` actions, keyed to the action, with selective rollback -- reusing the A1 `ArtifactStore` for the captured blobs.

### 3.3 Convention/attribute auto-discovery of pluggable units -- `.` (convergent)

optimizerDuck auto-discovers tweaks via reflection + attributes, avoiding a hand-edited registry. Nexus reached the same conclusion from the other direction in this very cycle: the v1.6.0 Phase 5 `LocalAdapterRegistry` ([modules/coding/llm/LocalAdapterRegistry.ts](../../../../modules/coding/llm/LocalAdapterRegistry.ts)) replaced a hand-edited adapter switch with **validated manifests**; the skills catalog and MCP registry are similarly manifest/descriptor-driven. The mechanism differs (manifests vs. reflection -- and manifests are the safer choice for a security-sensitive tool, since reflection-based discovery widens the trust surface), but the design value is already captured. **Equivalent; preserve (-> O3).**

### 3.4 Zero telemetry, fully offline -- `.` (convergent by construction)

optimizerDuck collects no data and runs offline. Nexus is no-outbound-by-default with no telemetry by default, local models on loopback, and an explicit "Zero Tokens Billed" stance. There is nothing to adopt; this is shared first-principles design. **Equivalent; preserve (-> O4).**

### 3.5 Build-from-source integrity -- `.` (convergent)

optimizerDuck's releases are built by GitHub Actions from public source to eliminate post-build binary modification. Nexus runs `npm run check:tampering` (0 findings) and `npm run security:check` ("all safety surfaces in sync") and builds from source in CI. A faint forward-tier idea -- publishing build **provenance/attestation** -- exists, but it is not driven by this source in any load-bearing way and is not proposed here. **Equivalent; preserve (-> O5).**

### 3.6 OS-tweak surface (performance / privacy / GPU / power / bloatware / UX) -- not applicable (dropped)

The 30+ registry/service/power/privacy tweaks, the Disk Cleanup, Bloatware Remover, Startup Manager, and Scheduled-Tasks browsers are optimizerDuck's entire reason to exist -- and are squarely outside Nexus's domain. Nexus is an AI studio; it does not (and per its design principles must not) modify the host OS. **Not applicable; dropped (-> D1).**

### 3.7 System resource dashboard -- `~` (Nexus is GPU-scoped on purpose; no adoption)

optimizerDuck's dashboard monitors CPU / RAM / GPU / storage / OS. Nexus ships always-on **GPU/VRAM** telemetry because that is the binding constraint for local inference on one consumer GPU; broad CPU/RAM/disk/OS monitoring is off-mission for an AI studio and would be scope creep. **Both observe, different scope; no adoption (-> D2).**

### 3.8 UI localization -- `+` (real gap, but out of scope this cycle)

optimizerDuck supports 10 languages via community translators. Nexus is English-only. This is a genuine absence, but for a single-user local power-dev tool it is low priority, is not policy-relevant (no outbound, no processor), and is unrelated to anything else in this comparison. **External-only; recorded as a `future`-watch, not recommended this cycle (-> D3).**

### 3.9 Portable single-`.exe` distribution -- not applicable (different stack)

optimizerDuck ships one unsigned portable `.exe` (WPF/.NET). Nexus is a VS Code extension + Electron desktop app; the distribution model does not transfer. **Not applicable; dropped (-> D4).**

---

## 4. Gap Ledger

| ID | Capability / idea | Status in Nexus | Class | Target location |
|---|---|---|---|---|
| O1 | Typed, per-action **revert ledger** ("mutation journal") with **selective** one-click rollback over non-git-revertible destructive mutations | Partial (`GitSafetyNet` = coarse, repo-scoped `git reset --hard`; `ActionClassifier` flags destructive actions but `write/edit/create`/MCP set `requiresCheckpoint:false`, and out-of-repo/terminal effects are not git-revertible) | **re-full** (local-only) | new `MutationJournal` under [modules/coding/guardrails/](../../../../modules/coding/guardrails/) reusing [core/memory/ArtifactStore.ts](../../../../core/memory/ArtifactStore.ts) (A1) + [ActionClassifier.ts](../../../../modules/coding/guardrails/ActionClassifier.ts) + [GitSafetyNet.ts](../../../../modules/coding/guardrails/GitSafetyNet.ts) |
| O2 | Risk-rated action taxonomy, no defaults applied | **Implemented-convergent** (REVERSIBLE/DESTRUCTIVE/BLOCKED + checkpoint/confirmation flags + three-tier permissions + denylist) | **preserve** | [modules/coding/guardrails/ActionClassifier.ts](../../../../modules/coding/guardrails/ActionClassifier.ts) |
| O3 | Convention/manifest auto-discovery of pluggable units | **Implemented-convergent** (manifest-driven `LocalAdapterRegistry`, skills catalog, MCP registry) | **preserve** | [modules/coding/llm/LocalAdapterRegistry.ts](../../../../modules/coding/llm/LocalAdapterRegistry.ts) |
| O4 | Zero telemetry, fully offline | **Implemented-convergent by design** | **preserve** | n/a (design principle, [AGENTS.md](../../../../AGENTS.md)) |
| O5 | Build-from-source integrity (no post-build tampering) | **Implemented-convergent** (`check:tampering` + `security:check` + CI build) | **preserve** | repo scripts / CI |
| D1 | Windows OS tweaks + Disk Cleanup / Bloatware / Startup / Scheduled-Tasks managers | Absent by design (Nexus does not modify the host OS) | **drop** | n/a |
| D2 | System resource dashboard (CPU/RAM/disk/OS) | Partial-by-scope (GPU/VRAM telemetry only, intentionally) | **drop** (no adoption) | n/a |
| D3 | UI localization (10 languages) | Absent | **future-watch** (drop this cycle) | n/a |
| D4 | Single unsigned portable `.exe` distribution | N/A (Electron / VS Code extension stack) | **drop** | n/a |

---

## 5. Security and Reverse-Engineering Assessment (MANDATORY)

### 5.1 Threat-model comparison

| Axis | optimizerDuck | Nexus today | Delta from adopting O1 (local mutation journal) |
|---|---|---|---|
| Outbound destinations | None (offline) | None (Ollama/LM Studio on loopback) | **None** -- O1 is a local file store; zero egress |
| Credentials required | None | None | **None** |
| Privilege required | Elevated (writes registry/services) | User-level (edits files, runs the user's shell) | **None new** -- O1 only records pre-state of actions Nexus already performs |
| Does data leave the machine? | No | No | **No** |
| New data processor / billing | No | No ("Zero Tokens Billed") | **No** |
| New local risk introduced | Registry/service edits can brick the OS (mitigated by typed revert + restore-point advice) | Coarse revert leaves out-of-repo destructive effects unrecoverable | O1 **reduces** this risk; its own new surface is (a) secrets captured into the journal and (b) journal disk growth |

The pattern from the aisuite and Fusion scans holds: **the one locally-adopted item (O1) adds no new outbound call, credential, or data processor.** It is purely additive local safety. Its only genuinely new surfaces are local and already have in-repo mitigations: secret capture (reuse `redactSecrets` on write, exactly as the A1 `ArtifactStore` already does) and unbounded disk growth (reuse the `ArtifactStore` content-addressing + a mark-and-sweep mirroring the `AS005.P3.A` orphan-reclamation follow-up already logged in [known-gaps.md](known-gaps.md)).

### 5.2 Per-item risk scorecard

| ID | Risk tier | Rationale |
|---|---|---|
| O1 | Low | New local module; captures pre-state of already-permitted destructive actions; **must** redact secrets on write (`redactSecrets`) and bound storage (content-addressed `ArtifactStore` + sweep); no egress, no new privilege |
| O2 | None | Already implemented; preserve |
| O3 | None | Already implemented; preserve (manifest discovery is safer than optimizerDuck's reflection -- do **not** "adopt" reflection-based discovery) |
| O4 | None | Already implemented by design; preserve |
| O5 | None | Already implemented; preserve |
| D1 | n/a | Out of domain; not adopted (adopting OS-mutation would itself violate Nexus's design principles) |
| D2 | n/a | Out of scope; not adopted |
| D3 | Low | Localization is benign but out of scope this cycle |
| D4 | n/a | Stack-incompatible; not adopted |

### 5.3 Reverse-engineering viability

- **O1** -> realizable as a local internal artifact with **no external-source attribution**. A typed pre-state revert journal is a well-known undo/command-pattern + memento idea, not optimizerDuck IP; the Nexus implementation is a generic `MutationJournal` over the existing `ActionClassifier` signal and the A1 `ArtifactStore`. Classification `re-full`. optimizerDuck's *concrete* revert kinds (Registry/Service/Task/Shell) are Windows-OS-specific and are **not** ported; Nexus's kinds are its own action types (file-write snapshot, delete tombstone, terminal-effect note). Use optimizerDuck strictly as a design reference; strip the source name; use generic descriptive naming.
- **O2-O5** -> nothing to reverse-engineer; already shipped. Preserve.
- **D1, D2, D4** -> `out-of-domain` / `stack-incompatible`, dropped. Building any of them would be scope creep into OS-optimization or a distribution rewrite, with no mission value.
- **D3** -> `future-watch`; if localization is ever wanted it is an independent, benign effort unrelated to this source.

### 5.4 Recommendation ordering (this IS the adoption-plan ordering)

1. **skill-native** -- none.
2. **re-full** -- **O1** only (typed per-action revert ledger + selective rollback), as a single local-only backlog item, **sequenced after the queued [adoption-openrouter-fusion](plans/adoption-openrouter-fusion.md) plan** and not opening a competing cycle.
3. **vendor-intrinsic** -- none.
4. **preserve (validations, no work)** -- O2 (risk-rated actions), O3 (manifest discovery), O4 (no-telemetry/offline), O5 (build integrity).
5. **drop / future-watch** -- D1 (OS tweaks), D2 (OS dashboard), D4 (portable `.exe`); D3 (localization) as a `future`-watch only.

---

## 6. Adoption Plan (RE-ordered)

This comparison yields **one** small, optional, on-brand item. It does **not** warrant its own version cycle, and -- per the user's cycle context -- it must not preempt the written-but-unstarted [adoption-openrouter-fusion](plans/adoption-openrouter-fusion.md) plan, which is the genuinely high-value next build. The recommended disposition is to **record O1 as a `candidate` in the v1.6.0 [known-gaps ledger](known-gaps.md)** and fold it into a later cycle. A `/plan from-comparison` chain is offered below but is **not** recommended to run ahead of Fusion.

| Phase | Item(s) | Value/Effort | Why this order |
|---|---|---|---|
| (later cycle) | **O1** -- `MutationJournal`: typed pre-state capture for `DESTRUCTIVE` actions + selective one-click revert, reusing the A1 `ArtifactStore` + `ActionClassifier`'s `requiresCheckpoint` signal | Medium / Medium | Closes the one real granularity/coverage gap (out-of-repo + per-action revert) the rest of the harness already implies; pure local safety; reuses two existing v1.6.0 subsystems |

### Conflicts and risks

- **O1 must not duplicate `GitSafetyNet`.** For git-tracked, in-repo edits the existing coarse checkpoint is fine and cheaper; O1's value is precisely the **non-git** and **per-action selective** cases. Scope it to actions where `ActionClassifier` says `DESTRUCTIVE` **and** a git checkpoint would not (or did not) cover the effect.
- **Secret capture**: the journal records pre-state (file contents, command context) and **must** run `redactSecrets` on write, exactly as `ArtifactStore` already does, or it becomes a plaintext-secret store.
- **Disk growth**: capture blobs through the content-addressed `ArtifactStore` and add a mark-and-sweep (mirroring the already-logged `AS005.P3.A` orphan-reclamation follow-up) so the journal cannot grow unbounded.
- **Do not adopt reflection-based discovery (O3).** Nexus's manifest-driven discovery is the deliberately safer design; the convergence is a validation, not a prompt to switch mechanisms.

### NOT recommended (dropped, with grounds)

- **D1 -- Windows OS tweaks + system managers.** Out of Nexus's domain; adopting OS mutation would violate the local-first AI-studio mission and add an elevated-privilege attack surface for zero mission value.
- **D2 -- Broad CPU/RAM/disk/OS dashboard.** Off-mission scope creep; Nexus's GPU/VRAM telemetry is intentionally scoped to the inference constraint.
- **D4 -- Portable single-`.exe` distribution.** Stack-incompatible (Electron / VS Code extension).
- **D3 -- UI localization.** Benign but out of scope this cycle; recorded as a `future`-watch only.

---

## 7. Verification Checklist

- [x] Source type identified (Git repository) and a cross-domain, safety-pattern-focused comparison applied (OS-tweak surface explicitly bracketed as not-applicable)
- [x] Every comparison dimension evaluated for both projects with file-path evidence for the Nexus side (`ActionClassifier`, `GitSafetyNet`, `LocalAdapterRegistry`, `ArtifactStore`, `GpuTelemetrySource`)
- [x] The lone adoption candidate (O1) cites a concrete target location and reuses named existing subsystems
- [x] Convergent strengths (O2-O5) explicitly marked **preserve / no work**, not re-proposed
- [x] Priority assignments consistent with the value/effort matrix and the user's cycle context (O1 sequenced after the queued Fusion plan; no competing cycle)
- [x] Conflicts with existing conventions flagged (do not duplicate `GitSafetyNet`; redact secrets; bound disk; do not adopt reflection discovery)
- [x] Items NOT recommended include reasoning (D1-D4 with domain/stack/scope grounds)
- [x] **Step 5 complete** -- threat-model table, per-item risk scorecard, per-item RE classification all present
- [x] **Step 5.4 ordering used** -- skill-native (none) -> re-full (O1) -> vendor-intrinsic (none) -> preserve (O2-O5) -> drops (D1-D4)
- [x] **MCP Registry Policy cited by name**; O1 confirmed zero-outbound / zero-credential / zero-new-processor; no item involves an outbound call (nothing to gate)
- [x] optimizerDuck feature claims quoted at `vendor-described` confidence; Nexus "implemented/partial" findings grounded in the cited v1.5.0 code map, not a line-by-line audit

---

## Appendix A -- optimizerDuck technical anchors (from the repo summary)

- **Stack**: C# 94.2% / WPF on .NET 10 / WPF UI (Fluent, Mica, Dark/Light/High-Contrast); Python 2.7%, JS 1.4%. Single unsigned portable `.exe`, no install.
- **Structure**: `optimizerDuck/` (app), `optimizerDuck.Resources/` (assets), `optimizerDuck.Test/` (unit tests), `.github/workflows/` (CI).
- **Tweaks**: ~30 across 6 categories -- Performance, Privacy, GPU (AMD/NVIDIA/Intel registry tweaks), Power, Bloatware & Services (200+ service startup-type tuning), UX. Auto-discovered via reflection + custom attributes.
- **Managers/utilities**: System Dashboard (CPU/RAM/GPU/storage/OS), Startup Manager, Scheduled Tasks browser, Disk Cleanup, Bloatware Remover (AppX, with risk badges).
- **Safety**: per-tweak Safe/Moderate/Risky rating; **no defaults applied**; recommends a Windows System Restore point before first use.
- **Revert system**: every modification writes a revert file; 4 typed kinds (Registry / Service / Scheduled Task / Shell); JSON-persisted, thread-safe; one-click revert of a single tweak or full rollback.
- **Privacy/integrity**: zero telemetry, fully offline; GitHub Actions builds releases from public source (no post-build tampering); GPL v3; 54+ releases; 10-language localization.

## Appendix B -- Confidence notes

optimizerDuck findings are at `vendor-described` confidence: a single read of the repository's README/summary (purpose, structure, feature list, revert design), not a clone, build, or code audit. The revert-system internals (4 typed revert kinds, JSON persistence, thread-safe I/O) and "no defaults / risk-rated" claims are as the repo describes them. Nexus "implemented / partial" findings are at `internal-compatible` confidence -- grounded in the v1.5.0 code map taken for this report (`ActionClassifier`, `GitSafetyNet`, `LocalAdapterRegistry`, `ArtifactStore`, `GpuTelemetrySource`) plus the README/ARCHITECTURE capability framing and the v1.6.0 plan + known-gaps -- not a line-by-line audit of every cited file. Where a Nexus capability is "partial" (O1), that reflects the specific granularity/coverage gap the item closes (per-action selective revert; non-git-revertible mutations), not an absence of the surrounding guardrails subsystem, which exists and is tested.
