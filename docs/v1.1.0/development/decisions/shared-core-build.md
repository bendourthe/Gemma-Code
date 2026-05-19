# Decision: Shared-core build via TypeScript project references

**Status**: Accepted -- 2026-05-18
**Cycle**: v1.1.0
**Phase**: 1 -- Shared-core build + carryforward closure
**Sub-task**: 1.1

---

## Context

The v1.0.0 cycle introduced `core/` as the shared, runtime-neutral module surface (registry, storage, telemetry, scheduler, memory, image, video, skills primitives). Three workspaces consume it:

- `src/` -- the VS Code extension host (legacy "Gemma Code engine"), pre-Phase-1.4 layout.
- `desktop/sidecar/` -- the Node sidecar process spawned by the Tauri shell.
- `desktop/src/` -- the React frontend (limited consumption -- only `core/image` and `core/video` shape types).

In v1.0.0 the shared imports went through relative paths (`../../core/...` from `desktop/sidecar/`). That is brittle, breaks the dependency-cruiser boundary rules in interesting ways, and means every consumer pays for the same `tsc` typecheck pass across the same files.

## Options considered

### (a) TypeScript project references with `composite: true` on `core/`

`core/tsconfig.json` declares `composite: true`, `declaration: true`. Every consumer workspace (`tsconfig.json` at the root, `desktop/tsconfig.json`) lists `core` under `references`. `tsc -b` walks the graph in topological order, builds `core/` once into `out/core/`, and emits `.d.ts` files the other workspaces consume.

- **Pros**: incremental, cache-friendly, no rewrites of existing import paths (relative imports inside `core/` keep working; cross-workspace imports continue to use the same module specifiers because the consumer's `tsconfig` maps them via `paths` or rely on `out/` resolution); reversible; the dependency-cruiser config only needs the new `references` paths added to the allow-list.
- **Cons**: requires `composite: true` semantics (every input file must be in `include`); `declaration: true` means no `const enum` exports outside the module; `tsc -b` is the new build command (slightly different output reporting than `tsc`).

### (b) Workspace package -- restructure `core/` as `packages/core/` + `@nexus/core` in npm workspaces

A flat `npm install` would resolve `@nexus/core/registry` via the workspace symlink. Sidecar code uses `import { ModelRegistry } from "@nexus/core/registry"`.

- **Pros**: idiomatic monorepo layout; tooling like nx / turborepo could plug in cleanly; clean public-surface boundary.
- **Cons**: requires moving 26 files (and growing) under a new path; every consumer import (including the 100+ inside `core/` itself) needs a rewrite to `@nexus/core/...`; non-trivial change for the 517 test files that currently import `core/...` via relative paths; the desktop workspace already exists, so adding a sibling `packages/` complicates the workspace topology.

## Decision

Adopt **option (a) -- TypeScript project references with `composite: true`** for v1.1.0.

Rationale: preserves the current import paths, is reversible, and the only mechanical change is wiring `tsc -b` into the build / typecheck scripts. The phase-1 cluster is already moving 192 files in `src/` -> `modules/coding/` (sub-task 1.4); piling another wholesale path rewrite on top would multiply the risk surface. Option (b) remains the long-term direction if the catalog grows past ~50 shared modules or if we onboard nx.

## Consequences

- A new `core/tsconfig.json` is added with `composite: true, declaration: true, declarationMap: true, outDir: "../out/core"`.
- The root `tsconfig.json` becomes a solution-style file that `references` core/; the legacy `include` set is preserved so the existing `npm run build` (raw `tsc`) keeps working for the VS Code extension build, but `tsc -b` is the v1.1.0 canonical entry point.
- `desktop/tsconfig.json` gains a `references: [{ "path": "../core" }]` entry. The shell-build CI keeps running `tsc --noEmit` for the desktop typecheck; the root CI step `npm run build` switches to `tsc -b` once Phase 1.4 lands and the source tree is stable.
- `configs/dependency-cruiser.cjs` gains explicit allowances for the new reference graph (no functional change because the imports were already permitted; the rules just become more precise).
- A future commit (Phase 1.4 follow-up) rewrites the few remaining `../../core/` style imports inside `desktop/sidecar/` to the resolved module specifier produced by the project-references graph.

## Validation

- `tsc -b` from the repo root succeeds.
- `npm run check-architecture` is green (the new references are in the allow-list).
- `npm run build` (legacy `tsc`) still produces the same `out/` shape so the VS Code extension package step continues to find the entry point at `out/src/extension.js`.

## References

- Plan: [docs/v1.1.0/plans/phase-01-shared-core-and-carryforward-closure.md](../../plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.1
- TypeScript handbook: https://www.typescriptlang.org/docs/handbook/project-references.html
