# ADR-0006: Unified path-guard for filesystem tool handlers

- **Status**: Accepted (2026-05-04)
- **Deciders**: Benjamin Dourthe (project owner) — closes pen-test F-001 + the symlink leg of Attack Path A as part of v0.6.0 Phase 1

## Context

Through v0.5.0 the filesystem tool surface had two path-resolution helpers running in parallel: a lexical `resolveWorkspacePath` defined inside [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) (uses `path.resolve` + `startsWith`) and a realpath-aware `resolveInsideWorkspace` defined in [src/tools/handlers/pathGuard.ts](../../src/tools/handlers/pathGuard.ts) (uses `fs.realpathSync` via `safeRealpath`, with an ancestor-walk for paths whose leaf does not yet exist).

The lexical helper did not follow symlinks. A workspace containing `inner -> /etc` (or any symlink whose target resolves outside the workspace root) bypassed the boundary check: the agent could `read_file inner/passwd`, `write_file inner/anything`, and `delete_file inner/...` because the lexical resolver only saw the literal `inner/...` segment under the root. The pen-test report tracked this as F-001 (split-brain path resolution); chained with the auto-approve leg of Attack Path A (covered by ADR-0007), it became the only P0 finding in the v0.5.0 review pass.

A second symptom of the split-brain was `run_terminal`: only the cwd of the spawned shell flowed through the realpath-aware guard (added in v0.4.0 Phase 1); every other filesystem tool used the lexical resolver. Closing only the cwd path would leave the symlink class half-open.

## Decision

Every filesystem tool handler in [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) routes path resolution through `resolveInsideWorkspace` from [src/tools/handlers/pathGuard.ts](../../src/tools/handlers/pathGuard.ts). The lexical `resolveWorkspacePath` helper is deleted; callers (`read_file`, `write_file`, `edit_file`, `create_file`, `delete_file`, `list_directory`, `grep_codebase`) now share a single guard.

`resolveInsideWorkspace` realpaths the deepest existing ancestor of the requested path and re-attaches any non-existent tail before comparing against the realpath'd workspace root, so the boundary check is symlink-correct for both reads (target exists) and writes (target does not exist yet but a parent symlink could redirect it).

A regression test at [tests/unit/tools/handlers/filesystem-symlink.test.ts](../../tests/unit/tools/handlers/filesystem-symlink.test.ts) exercises every filesystem tool against an `inner -> os.tmpdir()` symlink and asserts each refuses with a workspace-boundary error.

## Consequences

**Positive**

- Symlink leg of Attack Path A is broken at the entry point: the agent cannot construct any in-workspace path that escapes via a symbolic link, regardless of which filesystem tool it picks.
- One implementation, one test surface: future tool additions inherit the guard for free by importing `resolveInsideWorkspace`.
- The ancestor-walk fallback means `write_file new/dir/file.txt` still works on previously non-existent paths while remaining symlink-correct for any pre-existing parent.

**Negative**

- `resolveInsideWorkspace` issues `realpathSync` syscalls on every call. For large `grep_codebase` sweeps that already iterate through thousands of paths, the per-call cost (~1 ms p99 on Windows for cached entries) is non-trivial. The hot-path tools that do bulk traversal (`grep_codebase`, `list_directory`) call `resolveInsideWorkspace` only on the user-supplied root, then walk the resolved subtree without re-resolving every leaf.
- Paths under network filesystems with broken symlink semantics (rare on Windows; possible on misconfigured WSL mounts) may resolve in unexpected ways. The guard fails closed: an unresolvable parent throws, which the tool surfaces as an error rather than silently allowing the operation.

**Neutral**

- The `safeRealpath` and `realpathThroughExistingAncestor` helpers stay in [pathGuard.ts](../../src/tools/handlers/pathGuard.ts) as private internals. The public surface is `workspaceRoot()` + `resolveInsideWorkspace()`.

## Alternatives considered

- **Add a second realpath check inside the lexical resolver.** Rejected: doubles the syscall cost without removing the duplicate code path. Two implementations of the same invariant drift; one always wins eventually.
- **Audit each filesystem tool to add a per-handler symlink check.** Rejected: same reasoning as the v0.5.0 ADR-0005 critique of per-tool confirmation gates -- the policy belongs in one place, not seven.
- **Block all symlinks in the workspace.** Rejected: legitimate workspaces use symlinks (monorepo `node_modules` link-into-workspace patterns, dotfile repos). The boundary check is the right axis, not the symlink itself.

## Links

- Implementation: [src/tools/handlers/pathGuard.ts](../../src/tools/handlers/pathGuard.ts), [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts)
- Regression test: [tests/unit/tools/handlers/filesystem-symlink.test.ts](../../tests/unit/tools/handlers/filesystem-symlink.test.ts)
- Pen-test finding: [docs/archive/versions/v0/v0.6.0/review/penetration-test.md](../v0.6.0/review/penetration-test.md) F-001
- Companion ADR (clamp leg of Attack Path A): [ADR-0007](./0007-permission-tier-floor.md)
- v0.6.0 Phase 1 plan entry: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../v0.6.0/plans/v0.6.0-cycle.md) sub-task 1.1
