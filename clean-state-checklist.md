# Clean-State End-of-Session Checklist

**Version**: v0.8.0
**Status**: enforced
**Audience**: any agent or human ending a coding session on this repository
**Companion tool**: [scripts/cleanup-scanner.mjs](scripts/cleanup-scanner.mjs)

A session is "clean" only when every box below is checked. Run `node scripts/cleanup-scanner.mjs --format=text` for an automated pass over the items prefixed `[scan]`; the remaining boxes are intentionally manual.

## Build (4)

- [ ] `[scan]` No TypeScript build output present in `out/` from an aborted run (no stale .js/.map files mismatched with src/).
- [ ] `npm run build` exits 0 with zero warnings.
- [ ] `npm run lint` exits 0 with zero warnings.
- [ ] `npm run deps:check` (catalog check) passes.

## Architecture (4)

- [ ] `[scan]` No references to deleted file paths inside `Context.md` (per workspace).
- [ ] `[scan]` No references to deleted file paths inside `Memory.md` (per workspace).
- [ ] No new files outside the published Project Layout in AGENTS.md (run `git status` and check uncommitted new files).
- [ ] No new top-level directories created without an ADR.

## Runtime (4)

- [ ] `npm run test` passes 100%.
- [ ] `npm run test:integration` passes 100%.
- [ ] No `it.skip` / `it.only` / `describe.only` left in the diff.
- [ ] No `console.log` / `console.debug` left in production source (allowed in tests + `bin/`).

## Logging (4)

- [ ] `[scan]` `~/.gemma-code/operation-log.md` (when enabled) has no `<redacted>` rows for paths that should not have been touched.
- [ ] No new `getLogger().info(...)` calls without a level guard inside a hot path.
- [ ] No PII / secrets in any committed `.log` file.
- [ ] OperationLog file size stays under 10 MB (rotate with `/operation-log clear` if larger).

## Data (5)

- [ ] `[scan]` No orphan rows in `MemoryStore` (entries whose `sessionId` no longer exists in `ChatHistoryStore`).
- [ ] `[scan]` No orphan FTS5 rows (FTS index entries pointing at deleted memories).
- [ ] `[scan]` No dangling embeddings (zero-vector or NaN values in `memories.embedding`).
- [ ] `[scan]` No `.gemma-code/cache/*` files older than 30 days.
- [ ] No new SQLite schema versions added without a migration.

## Performance (4)

- [ ] `npm run bench` passes against the latest baseline (no regression > 30%).
- [ ] No new synchronous I/O in the prompt-build hot path.
- [ ] HNSW index `getCurrentCount()` is consistent with `MemoryStore.totalCount()`.
- [ ] No new tool with permission tier 0 (auto-approve) added without ADR.

## Repo (5)

- [ ] `git status` is clean (no uncommitted changes you forgot about).
- [ ] No committed `node_modules/`, `out/`, or `.gemma-code/` directories.
- [ ] `package-lock.json` exists and matches `package.json` exactly.
- [ ] No committed `.env`, `.env.*`, or credential file.
- [ ] No new dependency added without `npm audit --production` exiting 0.

---

**Total**: 30 checks across 7 categories.
**Automated subset**: 9 (`[scan]`) items run by `node scripts/cleanup-scanner.mjs`.
**Manual subset**: 21 items the operator audits visually or via a single command.
