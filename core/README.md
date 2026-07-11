# Nexus shared core

Provides infrastructure consumed by every pillar module under [`../modules/`](../modules/). Per the v1.0.0 cycle plan ([../docs/versions/v1/v1.0.0/plans/phase-02-rebrand-and-core-extraction.md](../docs/v1/v1.0/plans/phase-02-rebrand-and-core-extraction.md) sub-tasks 2.3 and 2.6), this tree owns:

- **`registry/`** — `ModelRegistry` (Phase 2.6 stub, Phase 5 full implementation): list / install / remove / inspect models in `~/.nexus/models/`.
- **`memory/`** — `MemoryHub` (Phase 2.6 stub): cross-module facade over the four-layer memory system (working / episodic / semantic / graph).
- **`telemetry/`** — `TelemetryBus` (Phase 2.6 stub, Phase 8 GpuScheduler integration): in-process pub/sub for hardware and module-level events.
- **`skills/`** — `SkillCatalog` (Phase 2.6 stub, Phase 10 DevAI-Hub sync): list, load, and hot-reload skills.
- **`storage/`** — `StorageMigration` (Phase 2.2) plus path constants for `~/.nexus/`.

## Boundary rule

`core/**` MUST NOT import from `modules/**`. Modules may import from `core/**` but NOT from each other. Enforced by [`../configs/dependency-cruiser.cjs`](../configs/dependency-cruiser.cjs) rules `no-core-from-modules` and `no-cross-module-deps`.

## Compatibility window (v1.0.0 cycle)

During v1.0.0, the historical [`../src/`](../src/) tree still hosts the Coding engine. Once Phase 2.3's wholesale move completes (tracked in [`../docs/versions/v1/v1.0.0/known-gaps.md`](../docs/v1/v1.0/known-gaps.md) under code `MV`), the layout simplifies to `core/` + `modules/<pillar>/`.
