# Nexus v1.0.0 Architecture

**Version**: v1.0.0
**Status**: in development (Phase 2 landed; Phases 3-11 in flight)

## Top-level layout

```
nexus-ai/
  desktop/                    Tauri 2.x shell + Node sidecar (Phase 1)
    src/                       React 19 + Vite + Tailwind v4 webview
    src-tauri/                 Rust shell, IPC bridge
    sidecar/                   Long-running Node process: engine host

  core/                       shared-core surfaces (Phase 2.3 + 2.6)
    registry/ModelRegistry.ts  list / install / remove / inspect models
    memory/MemoryHub.ts        4-layer memory facade
    telemetry/TelemetryBus.ts  in-process pub/sub for GPU + module events
    skills/SkillCatalog.ts     list / load / hot-reload skills
    storage/                   StorageMigration + canonical ~/.nexus/ paths

  modules/                    per-pillar code, one folder per pillar
    coding/                    Agentic AI Coding (engine living under src/ for one cycle)

  src/                        pre-v1.0.0 Coding engine (compat host during the
                              one-cycle migration window; wholesale move to
                              modules/coding/ tracked in known-gaps as MV)

  scripts/installer/pyqt/     Nexus installer (PyQt5 wizard, renamed from
                              gemma_installer in Phase 2.5)
  bin/nexus-check.mjs         deterministic-checks CLI (renamed from
                              gemma-check in Phase 2.4; legacy alias kept)
```

## Shared core surfaces (Phase 2.6 stubs; Phase 5 / 8 / 10 fill in)

| Surface | Stub location | Owner phase | What it covers |
|---|---|---|---|
| `ModelRegistry` | [core/registry/ModelRegistry.ts](../../../../core/registry/ModelRegistry.ts) | Phase 5 | List, install, remove, inspect locally-available models. Phase 5 adds content-addressed storage + SHA-256 verification. |
| `MemoryHub` | [core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts) | Phase 4 | 4-layer facade (working / episodic / semantic / graph). Wraps today's `UnifiedMemoryRetriever` in Phase 4. |
| `TelemetryBus` | [core/telemetry/TelemetryBus.ts](../../../../core/telemetry/TelemetryBus.ts) | Phase 8 | In-process pub/sub for GPU samples, module events, scheduler queue. Local-only; no phone-home. |
| `SkillCatalog` | [core/skills/SkillCatalog.ts](../../../../core/skills/SkillCatalog.ts) | Phase 10 | List, load, hot-reload skills. Phase 10 wires `nexus skills sync` (DevAI-Hub) into this surface. |
| `StorageMigration` | [core/storage/StorageMigration.ts](../../../../core/storage/StorageMigration.ts) | Phase 2.2 | First-launch migration of `~/.gemma-code/` -> `~/.nexus/`. Idempotent; POSIX symlink, Windows README. |

## Boundary rule (Phase 2.3)

Enforced by [`configs/dependency-cruiser.cjs`](../../../../configs/dependency-cruiser.cjs) (`no-core-from-modules`, `no-cross-module-deps`):

```
modules/<x>/**  may depend on  core/**
core/**         may NOT depend on  modules/**
modules/<x>/**  may NOT depend on  modules/<y>/**  for x != y
```

Run `npm run check-architecture` to verify.

## Rebrand sweep (Phase 2)

The v1.0.0 cycle renames forward-facing identifiers from `gemma-code.*` -> `nexus.*` with a one-cycle compat shim. Removed in v1.1.0.

| Surface | Old | New | Compat |
|---|---|---|---|
| Settings keys | `gemma-code.<group>.<key>` | `nexus.<group>.<key>` | [SettingsCompat shim](../../../../src/config/SettingsCompat.ts) resolves legacy keys with a one-time deprecation log. |
| Storage root | `~/.gemma-code/` | `~/.nexus/` | [StorageMigration](../../../../core/storage/StorageMigration.ts) copies on first launch; POSIX symlink, Windows README. |
| CLI binary | `gemma-check` | `nexus-check` | `bin/gemma-check-compat.mjs` forwards to `bin/nexus-check.mjs` with a one-line deprecation. |
| Installer pkg | `gemma_installer` | `nexus_installer` | Hard rename. Affects installer authors only, not end users. |
| Code identifiers | `GemmaCodePanel`, `GemmaRuntime` | `NexusCodingPanel`, `NexusCodingRuntime` | Live source files renamed; `Gemma 4`, `gemma4:e4b`, `Gemma4ToolFormat` (the model) are intentionally preserved. |

## Cross-cutting constraints

Per the v1.0.0 cycle plan ([phases-at-a-glance](plans/v1.0.0-cycle.md#phases-at-a-glance)):

1. **Local-first**. No outbound network call without explicit user opt-in. Installer-time model downloads and `nexus skills sync` are the two opt-in exceptions.
2. **Single-GPU ceiling**. Every benchmark runs on an RTX 4070-class machine (12 GB VRAM) baseline.
3. **Originality over wrappers**. Per AGENTS.md decision tree: local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop.
4. **No telemetry**. No usage analytics, no crash phone-home, no remote logging.
5. **Compat shims expire after one cycle**. Settings shim, storage migration shim, and `gemma-check` alias all log deprecation in v1.0.0 and are removed in v1.1.0.

## See also

- [Cycle plan](plans/v1.0.0-cycle.md)
- [Pivot brief](pivot-brief.md)
- [Known gaps](known-gaps.md)
- [Design tokens](design-tokens.md)
- Historical: [`docs/archive/versions/v0/v0.9.0/architecture.md`](../v0.9.0/) for the Gemma Code v0.x architecture.
