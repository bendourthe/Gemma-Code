# v1.7.0 Phase 5 -- tree-sitter shell-command introspection for permission gating (O-A, SO006)

**Date**: 2026-07-01
**Plan**: [../../plans/adoption-self-optimizing-skills.md](../../plans/adoption-self-optimizing-skills.md)
**Comparison**: [../../comparison-opencode.md](../../comparison-opencode.md) (O-A, the secondary harness-hardening track)
**Outcome**: COMPLETE. The terminal permission gate now enumerates the paths / cwd a shell command will touch (bash / PowerShell / cmd) and matches each write / delete / read path against the `.nexus/permissions.deny` file-tool rules, turning "what will this command touch?" from a regex guess into a structural answer. Fails closed: an un-parseable or unsupported command falls back to the existing denylist + DANGEROUS-tier gate and never auto-allows. The introspection only ever tightens the surface.

---

## 1. What was asked

`/implement phase 5 of v1.7.0 adoption-self-optimizing-skills`. Phase 5 was the first incomplete phase (Phases 1-4 closed 2026-06-29..2026-07-01 at `a60714f`/`0b8ad7e`/`35e91a1`/`e13553b`). Phase 5 is O-A, the one clearly-worthwhile local adoption from the opencode scan; it is independent of the S1-S3 optimization track.

## 2. Model-routing pre-flight

The plan recommended "Strong reasoning tier, high effort -- `claude-sonnet-4-6`, high" (O-A is security-sensitive). The session ran on **Opus 4.8**, a stronger tier than the plan's concrete id; per the no-degradation guarantee, staying on the stronger tier is correct -- no switch.

## 3. Pre-implementation review (key findings)

- **Existing shell surface.** `run_terminal` ([src/tools/handlers/terminal.ts](../../../../../src/tools/handlers/terminal.ts)) already sits at the DANGEROUS tier (every call confirmed), hard-blocks `BLOCKED_PATTERNS`, and resolves cwd via `pathGuard`. The `.nexus/permissions.deny` gate ([ToolRegistry](../../../../../src/tools/ToolRegistry.ts) `_denyList` + `evaluateDeny`) matches the *whole command string* against `run_terminal:` rules, and file paths against `write_file:`/`delete_file:` rules -- but a shell command that writes a file (`echo x > secrets/y`) was gated only as a command string, never by the path it touches. That is exactly the gap O-A closes.
- **tree-sitter is already a dependency, but bash-only.** `web-tree-sitter` + `tree-sitter-wasms` ship in `package.json` and drive the codegraph scanner ([core/codegraph/scanner/TreeSitterScanner.ts](../../../../../core/codegraph/scanner/TreeSitterScanner.ts)). The bundled grammar set includes `tree-sitter-bash.wasm` but **no PowerShell / cmd grammar**. Pulling native grammars for those conflicts with the no-runtime-download / reverse-engineer-first principle.
- **Denylist is wired end-to-end.** [ChatPanelBootstrap](../../../../../src/panels/ChatPanelBootstrap.ts) loads `.nexus/permissions.deny` and threads it through `buildToolRegistry` -> `setPermissionsDeny`, so extending the `ToolRegistry` deny gate makes O-A live in the VS Code extension with no new wiring.
- **Import boundaries.** `src/tools/` already imports `modules/coding/guardrails/PermissionTiers` and `core/storage/PermissionsDeny`, so a new `modules/coding/guardrails/shellIntrospection.ts` consumed by `ToolRegistry` + the terminal handler respects the existing edges (no `no-core-from-modules` / `no-*` violation). The introspector is kept dependency-free (no vscode, no logger) so it stays pure and synchronously testable.

## 4. Design decisions

1. **A pure, dependency-free structural introspector, not an async tree-sitter parse in the hot path.** [shellIntrospection.ts](../../../../../modules/coding/guardrails/shellIntrospection.ts) `introspectShellCommand` is a quote-aware tokenizer + per-dialect file-command tables + redirection detection. It is synchronous, deterministic, cross-platform, and fully unit-testable. This matches the codebase's dependency-free-parser precedent (the Phase 1 `goldenTaskLoader`, the `PermissionsDeny` glob matcher) and the MCP Registry Policy bucket 3 (reverse-engineer-first, no new dependency). The bundled bash grammar exists, but wiring the async `web-tree-sitter` runtime + WASM packaging into the terminal gate for one of three dialects (PowerShell / cmd have no grammar) is disproportionate; the AST-bash upgrade is recorded as `SO006.P5.A`.
2. **Fail closed by construction.** The introspector returns `{ parsed: false }` on any construct that could hide a path from static analysis: command / process substitution (`$(`, `<(`, `>(`), variable expansion (`$` for bash/PowerShell, `%`/`!` for cmd), backtick, `Invoke-Expression`, or an unbalanced quote. Because the introspection is purely additive (it can only add a refusal), fail-closed means: when it cannot enumerate, it adds nothing and the existing DANGEROUS-tier + command-string gate still apply. It never downgrades a tier or approves a command.
3. **Path-scoped gating lives where the denylist lives (`ToolRegistry`).** `_denyByTouchedPath` maps write -> `write_file`, delete -> `delete_file`, read -> `read_file` and calls the existing `evaluateDeny` (which also honors blanket `*:` rules), so `write_file: secrets/**` now also blocks `echo x > secrets/prod.env`. It runs after the existing command-string match, inside the same `_denyList.rules.length > 0` guard, so it is a no-op for every caller without a denylist.
4. **Dialect from platform.** `detectShellDialect` maps win32 -> cmd, else bash -- what `spawn(command, [], { shell: true })` actually executes. Tests pin each dialect explicitly (the introspector takes the dialect as an argument), and the `ToolRegistry` / dry-run tests use dialect-agnostic redirection commands (`echo x > path`) or unbalanced-quote fail-closed cases so they are deterministic across the CI platform matrix.
5. **Transparency on the confirmation surface.** The `run_terminal` dry-run report gains a `Touched paths:` line (`write:'out.txt'`, ... or `(unresolved: <reason>)`), so a human approving a DANGEROUS command sees the structural enumeration.

## 5. Files

New: [modules/coding/guardrails/shellIntrospection.ts](../../../../../modules/coding/guardrails/shellIntrospection.ts). Modified: [modules/coding/guardrails/index.ts](../../../../../modules/coding/guardrails/index.ts) (export), [src/tools/ToolRegistry.ts](../../../../../src/tools/ToolRegistry.ts) (`_denyByTouchedPath` + the run_terminal path-gate branch + a fail-closed fallback log), [src/tools/handlers/terminal.ts](../../../../../src/tools/handlers/terminal.ts) (`Touched paths:` dry-run line). No `package.json` change -- no new dependency, no new setting (the gate is a tightening layer over the existing `.nexus/permissions.deny`).
New tests: [tests/unit/guardrails/shellIntrospection.test.ts](../../../../../tests/unit/guardrails/shellIntrospection.test.ts) (29). Modified tests: [tests/unit/tools/ToolRegistry.test.ts](../../../../../tests/unit/tools/ToolRegistry.test.ts) (+5), [tests/unit/tools/handlers/terminal.dry_run.test.ts](../../../../../tests/unit/tools/handlers/terminal.dry_run.test.ts) (+3).

## 6. Troubleshooting

- **`2>&1` enumerated `1` as a write path.** The first tokenizer folded the `&` into the redirection operator (`>&`), leaving `1` as the next word, which the redirect pass treated as a write target. Fix: do **not** fold `&` into the operator, so an fd-duplication target stays `&1` and is skipped (a token starting with `&` is not a filesystem path). A regression test pins `node build.js >> build.log 2>&1` enumerating only `build.log`.
- **Coverage tail.** Two branches (fd-prefixed append `2>>`; a trailing PowerShell `-Path` with no value -> `nextWordIndex` returns -1) were initially uncovered; two targeted tests brought the module to 100% lines / 92.59% branches / 100% functions.

## 7. Verification

- `npm run test`: **4498 passed / 6 skipped / 0 failed** (+37 over the Phase 4 baseline of 4461). `npm run lint`: **0 errors**. `tsc -b`: clean.
- `npm run check-architecture`: **0 errors**, 10 pre-existing warnings (no new orphan/circular; +1 module). `npm run check:tampering`: **0 findings**. `npm run security:check`: in sync (no tier change).
- New-module coverage: `shellIntrospection.ts` **100% lines / 92.59% branches / 100% functions** (above the 80/75/80 gate).
- Local-first / MCP Registry Policy clean: no new dependency, no new outbound call or credential; the introspector is a pure local parse and only tightens the permission surface.

## 8. Carryovers

Recorded in [../../known-gaps.md](../../known-gaps.md): `SO006.P5.A` (P2, tree-sitter-bash AST upgrade over the bundled grammar), `SO006.P5.B` (P3, opt-in workspace-escape hard-block), `SO006.P5.C` (P3, glob-expansion / read-scope precision). Phase 6 (FINAL) is the remaining phase: the whole-plan acceptance gate, docs, the demand-gated backlog (S5; opencode O-B/O-D/O-E), and the Nexus-Hub touchpoint.
