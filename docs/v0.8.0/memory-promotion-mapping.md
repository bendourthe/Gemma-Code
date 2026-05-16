# Memory promotion mapping (v0.8.0)

**Source**: `src/panels/MemoryPanel.ts:sectionForType`
**Setting**: `gemma-code.memory.promotionMapping` (record of `<sql-type> -> <section-heading>`)
**Cross-references**:
- `docs/v0.7.0/known-gaps.md` Section 10 row 10.O.5 (the open item this document closes).
- `docs/v0.8.0/plans/v0.8.0-cycle.md` Phase 5 sub-task 5.10.

## What this controls

The MemoryPanel's "Promote to Memory.md" action takes a SQL-backed memory row and appends its `content` under one of the four headings in `Memory.md`:

```
## Preferences
## Corrections
## Patterns
## Decisions
```

The chosen heading is derived from the SQL row's `type` column. v0.7.0 baked the mapping in code; v0.8.0 documents it and exposes a setting so power users can rewire it without forking.

## Default mapping

| SQL `type` value     | Memory.md section |
|----------------------|-------------------|
| `decision`           | `Decisions`       |
| `preference`         | `Preferences`     |
| `error_resolution`   | `Corrections`     |
| `file_pattern`       | `Patterns`        |
| _(anything else)_    | `Preferences`     |

The fallback to `Preferences` is intentional: an unrecognised SQL type indicates either a new memory category the panel does not yet understand or a hand-crafted row from `/memory save`. Either way, dropping it into `Preferences` keeps it visible without requiring the user to invent a new section.

## Override syntax

`gemma-code.memory.promotionMapping` is a flat object whose keys are SQL types and whose values are one of the four allowed section headings:

```jsonc
{
  "gemma-code.memory.promotionMapping": {
    "decision": "Decisions",
    "preference": "Patterns",       // route preferences to Patterns instead
    "error_resolution": "Corrections",
    "file_pattern": "Patterns",
    "custom_team_rule": "Decisions" // user-defined SQL type
  }
}
```

- Any key whose value is **not** one of `Preferences` / `Corrections` / `Patterns` / `Decisions` is silently ignored (the default applies).
- Removing a key falls back to the default mapping for that type.
- The setting is read on every promotion; no restart is required.

## Why this is a setting, not a refactor

The Memory.md schema (`Preferences / Corrections / Patterns / Decisions`) is intentionally small. We do not let users invent new sections via this setting because doing so would split memories across an unbounded set of headings, which downstream tools (`/memory search`, the consolidator, the curator) would have to enumerate. The override is therefore restricted to remapping existing SQL types onto existing sections.

## v0.8.0 feedback gate

This mapping is the kind of UX choice that benefits from real user testing. During v0.8.0:

1. The default mapping ships unchanged from v0.7.0.
2. Users can override via `gemma-code.memory.promotionMapping`.
3. Telemetry / chat feedback is collected in `docs/v0.8.0/known-gaps.md` Section 10 if anyone hits a mapping they want to change.
4. Phase 7 re-reads this document before tagging v0.8.0 and decides whether to (a) keep the mapping, (b) revise the defaults, or (c) deprecate this setting altogether.

## Closing 10.O.5

This document plus the `gemma-code.memory.promotionMapping` setting closes the v0.7.0 open item 10.O.5 ("Promote-to-Memory section mapping"). The item is moved from `## Open Items` to `## Resolved` in `docs/v0.7.0/known-gaps.md` with the note "Resolved in v0.8.0 Phase 5.10".
