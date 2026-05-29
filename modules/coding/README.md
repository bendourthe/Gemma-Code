# Nexus Coding module

Per the v1.0.0 cycle plan ([../../docs/versions/v1/v1.0.0/plans/phase-02-rebrand-and-core-extraction.md](../../docs/versions/v1/v1.0.0/plans/phase-02-rebrand-and-core-extraction.md) sub-task 2.3), the Agentic AI Coding pillar of Nexus is hosted here.

**Current state (v1.0.0 Phase 2):** the engine still lives under [`../../src/`](../../src/) (the historical Gemma Code tree) during the one-cycle compat window. The boundary rule is enforced for *new* code: anything net-new in v1.0.0 lands here or under [`../../core/`](../../core/), and `core/**` may not import from `modules/**`. The wholesale physical move of the 189 src/ files into `modules/coding/<sub-tree>/` is tracked in [`../../docs/versions/v1/v1.0.0/known-gaps.md`](../../docs/versions/v1/v1.0.0/known-gaps.md) under code `MV` (file-move backlog) and is scheduled for completion before v1.0.0 ships.

After the move the layout will be:

```
modules/coding/
  agents/         (from src/agents/)
  chat/           (from src/chat/)
  commands/       (from src/commands/)
  panels/         (from src/panels/)
  runtime/        (from src/runtime/, renamed NexusCodingRuntime)
  tools/          (from src/tools/)
```

The shared-core surfaces (ModelRegistry, MemoryHub, TelemetryBus, SkillCatalog) live alongside this module under [`../../core/`](../../core/) and are consumed by every pillar.
