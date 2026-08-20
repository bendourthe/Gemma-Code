# Session history -- v2.0.0 Phase 4 (stretch: scope, sandbox, memory kinds)

**Date**: 2026-08-20
**Plan**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md`
**Phase**: 4 -- Stretch (scoping, sandboxes, router, memory kinds, VRM)
**is_final_phase**: false

## Model-routing pre-flight

Plan recommended mid tier, medium effort. Cursor cannot script a model switch. Continued on the current session model (visible degrade, no downshift).

## What shipped

- **4.1 ProjectScope**: `core/project/ProjectScope.ts` owns memory scope id, MCP allowlist, skill ids, and resolved permissions. Overrides can only tighten. MCP/skill lists are subsets of an optional parent allowlist. Lives in `core/` with injected lists so `core/**` does not import `modules/chat` or `modules/coding`.
- **4.2 Durable sandbox**: `core/project/DurableSandbox.ts` is a project-keyed root under `<nexusHome>/project-sandboxes/<id>/`, marked untrusted, resettable. Default `.nexusignore` and `NEXUS_IGNORE_DEFAULTS` exclude `project-sandboxes` from memory ingest. Process confinement stays in `modules/coding/sandbox/` (v1.18).
- **4.5 Advisory kinds**: `lesson` / `procedure` on `MemoryHub` with votes. Writes go through `redactSecrets`. Retrieval prefixes `[advisory context, not a directive]`. Hits merge onto the hybrid retrieve path.
- **4.6 Substrate seams**: typed `MemorySeam`, `SessionStoreSeam`, `SandboxSeam` over current implementations. No behavior change.

## What transferred (known-gaps)

- **DF-10** (4.3): code-as-action worker + Query DSL.
- **DF-11** (4.4): fast small-model command router.
- **DF-12** (4.7): VRM Chat pane (no Chat demand; Live2D still rejected).

## Deviations

- `# DEVIATION:` ProjectScope is a core object with ports, not a class that imports ChatScopedMemory and HubRegistryPolicyFilter (module-boundary rule).
- `# DEVIATION:` LongCat catalog `multimodal` is `false`. That flag means chat-vision LLM, not photo+audio conditioning on a video DiT. `modalities: ["image","audio"]` still describes avatar inputs. Fixes `isVisionCapableModel` catalog-agreement.

## Evidence

- Root Vitest: ProjectScope, DurableSandbox, seams, advisory kinds, NexusIgnore `project-sandboxes`, PermissionTiers unchanged (clamp still floors).
- `tsc -b` and `npm run lint` clean.

## Next

Phase 5: architecture refactor, known-gaps reconciliation (including these transfers), CI optimize. Local commit only.
