# Phase 3 -- Plan-mode UX overhaul

**Date**: 2026-05-16
**Plan reference**: [docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md](../../plans/v0.8.0-cycle.md) Phase 3
**Status**: complete

## Summary

Phase 3 turns plan mode from a numbered list with step-level approval into a plannotator-grade structured review surface. It ships three annotation primitives (DELETION / COMMENT / GLOBAL_COMMENT) with their cross-boundary message protocol, a persistent plan version archive at `~/.gemma-code/plans/<workspace>/<slug>/<NNNN>.md` with a 3-mode diff renderer (`clean` word-level inline, `classic` line-level block, `raw` unified), a quick-label chip catalog of five canonical tips plus a user-overlay JSON file, and a single user-editable improvement-hook file read on every plan-mode activation. All four sub-tasks landed with passing unit + integration tests, clean lint, and a clean build.

## Sub-tasks completed

### 3.1 -- Three annotation primitives (item B1)

- Created [src/panels/webview/render/planAnnotation.ts](../../../../versions/src/panels/webview/render/planAnnotation.ts) following the v0.7.0 Phase 4 `*_FN_SOURCE` + `compileX` pattern. The render function sorts annotations into three DOM buckets: `.plan-annotation-globals` (top-of-plan callouts for `GLOBAL_COMMENT`), `.plan-annotation-sidebar` (inline notes for `COMMENT`), and `.plan-annotation-deletions` (strikethrough struck spans for `DELETION`). Every annotation carries `data-block-id` and `data-anchor=<blockId>:<start>-<end>` so the webview's positioning layer can pin it without re-parsing.
- Extended [src/chat/PlanMode.ts](../../../../versions/src/chat/PlanMode.ts) with a `PlanAnnotation` type, an `annotations: PlanAnnotation[]` field on `PlanModeState`, and five new methods: `addAnnotation`, `removeAnnotation`, `getAnnotations`, `clearAnnotations`, `formatAnnotationsAsFeedback`. `setPlan` and `resetPlan` clear the buffer; `toggle` clears it when deactivating. `addAnnotation` is upsert-by-id (replaces the existing row when the id matches), matching the webview's edit-in-place UX.
- Extended [src/panels/messages.ts](../../../../versions/src/panels/messages.ts) with one extension-to-webview message (`renderPlanAnnotations`) and three webview-to-extension messages (`planAnnotationAdd`, `planAnnotationRemove`, `planAnnotationsSubmit`).
- Wired [src/panels/ChatMessageRouter.ts](../../../../versions/src/panels/ChatMessageRouter.ts): the three webview-side cases mutate the buffer and re-publish the canonical list via `renderPlanAnnotations`; the existing `planDeny` case folds the formatted annotation block into the user's free-form feedback before invoking `PlanMode.denyPlan` and then clears the buffer.
- Added [tests/unit/panels/webview/render/planAnnotation.test.ts](../../../../versions/tests/unit/panels/webview/render/planAnnotation.test.ts) (8 cases) plus 11 new `PlanMode` annotation cases extending [tests/unit/chat/PlanMode.test.ts](../../../../versions/tests/unit/chat/PlanMode.test.ts).

### 3.2 -- Plan version archive + 3-mode diff renderer (item A8 + B6)

- Created [src/storage/PlanArchive.ts](../../../../versions/src/storage/PlanArchive.ts) with `appendVersion(slug, content) -> number`, `listVersions(slug) -> PlanVersionEntry[]`, `getVersion(slug, n) -> string | null`, and `diff(slug, from, to) -> PlanDiffResult`. The static `computeDiff(fromContent, toContent, slug?, fromVersion?, toVersion?)` exposes the 3-mode helper for callers that hold the strings in memory. Slug components are whitelisted (`[A-Za-z0-9._-]+`); workspace ids derived from filesystem paths normalize via `replace(/[\\/]/g, "_")`. The 4-digit version filename pattern (`0001.md`, `0002.md`, ...) makes manual listing safe; the next-version pick uses `listVersions(slug).length + 1` so a manual `0001.md` deletion still advances.
- Diff modes:
  - **`clean`**: word-level diff via `diffWordsWithSpace`. Additions wrap in `**...**`, deletions in `~~...~~`. (Trailing-newline runs produce `**text\n**`; the classic + raw modes are unaffected. Logged as 10.O.I.)
  - **`classic`**: line-level diff via `diffLines` with `+` / `-` / ` ` prefixes. Each line becomes its own DOM row in the render primitive.
  - **`raw`**: `createPatch(slug + ".md", from, to, "v<from>", "v<to>")` unified diff.
- Created [src/panels/webview/render/planDiff.ts](../../../../versions/src/panels/webview/render/planDiff.ts) with a `compilePlanDiff(documentRef)` factory. The rendered surface ships a header (slug + version range), a 3-button mode toggle row, and a body that switches DOM shape per mode. Mode-toggle clicks invoke `handlers.onModeChange(mode)` so the consumer can re-render.
- Wired [src/panels/ChatPanelBootstrap.ts](../../../../versions/src/panels/ChatPanelBootstrap.ts) to construct a single `PlanArchive` instance per session (rooted at the existing `memoryFiles.workspaceId` so the archive sits next to the memory files). [src/panels/ChatController.ts](../../../../versions/src/panels/ChatController.ts) `_checkForPlan` now archives every detected plan and emits `renderPlanDiff` for the second-and-later versions.
- Added [tests/unit/storage/PlanArchive.test.ts](../../../../versions/tests/unit/storage/PlanArchive.test.ts) (11 cases: append, list, list-with-gap, get/null, version-bump under deletion, slug rejection, diff-shape, missing-version errors, static computeDiff, workspace-id normalization). Added [tests/unit/panels/webview/render/planDiff.test.ts](../../../../versions/tests/unit/panels/webview/render/planDiff.test.ts) (7 cases). Added [tests/integration/panels/planDiffRevise.test.ts](../../../../versions/tests/integration/panels/planDiffRevise.test.ts) (2 cases: revise-then-diff emits the right message; identical re-plan emits a diff with no add/del rows).

### 3.3 -- Quick-label chips (item B5)

- Created [src/panels/webview/render/quickLabels.ts](../../../../versions/src/panels/webview/render/quickLabels.ts) with `DEFAULT_QUICK_LABELS` (5 canonical chips: "Out of scope", "Add test", "Risky", "Missing rationale", "Wrong file") plus `findQuickLabel(id, labels?)` and the `compileQuickLabels(documentRef)` factory. Each chip carries a stable `id`, a short `label`, and a canonical `quickLabelTip` string. The render function emits one button per chip with `data-label-id` and the tip as the button's `title` attribute (hover preview). Clicks dispatch `onPick(label)` so the webview-side handler can build a prefilled `COMMENT` annotation and route it through the standard `planAnnotationAdd` message.
- `loadCustomQuickLabels(filePath = ~/.gemma-code/plans/quick-labels.json)` returns `[]` when the file is missing, parses a JSON array, and filters malformed rows (must have string `id`, `label`, `quickLabelTip`). Parse errors are logged via `console.warn` so the module imports nothing from `vscode` and stays jsdom-test-friendly.
- `PLAN_QUICK_LABELS_TIPS` exports a frozen `id -> tip` mapping for downstream docs-sync checks.
- Added [tests/unit/panels/webview/render/quickLabels.test.ts](../../../../versions/tests/unit/panels/webview/render/quickLabels.test.ts) (16 cases covering catalog shape, lookup, custom-overlay loader, malformed-row filtering, render output, hover-title attribute, and click dispatch).

### 3.4 -- Improvement-hook file (item B7)

- Created [src/chat/ImprovementHook.ts](../../../../versions/src/chat/ImprovementHook.ts) with `hookFilePath(name, rootDir?)`, `loadHook(name, rootDir?)`, and `renderHookAsSystemMessage(name, rootDir?)`. The `HookName` type is the authoritative list of recognised hook names; Phase 3 ships only `enterplanmode-improve`. Empty / whitespace-only / missing files return `null`; read errors other than `ENOENT` log via `getLogger().warn` and return `null` so the plan-mode entry path keeps flowing.
- Wired into [src/panels/ChatMessageRouter.ts](../../../../versions/src/panels/ChatMessageRouter.ts) `_handleSetEditMode`: when plan mode activates, the router rebuilds the system prompt (so the built-in addendum + PFM reminder fire first) and then -- if the hook file has non-empty content -- appends a `## User-supplied plan-mode rules` system message with the user's overlay.
- Added a new VS Code command `gemma-code.hooks.editPlanModeHook` in [src/extension.ts](../../../../versions/src/extension.ts) that opens the file (and lazily seeds it with a starter template) in a tab. Registered in [package.json](../../../../versions/package.json) under the `Gemma Code: Edit Plan-Mode Improvement Hook` title.
- Documented the file format, safety boundary, and example bodies in [docs/archive/versions/v0/v0.8.0/improvement-hooks.md](../../improvement-hooks.md).
- The prompt-injection scanner from Phase 2.7 deliberately does NOT cover the hook file -- the user is the author, so the threat model is shell-rc parity, not third-party content. Logged as 10.O.H.
- Added [tests/unit/chat/ImprovementHook.test.ts](../../../../versions/tests/unit/chat/ImprovementHook.test.ts) (5 cases: path build, missing file, empty body, populated body trim, render-as-system-message).

### 3.5 -- Testing and stabilization

- `npm run lint` exit 0.
- `npm run build` exit 0.
- Full unit + integration suite passes. The two pre-existing 10.O.D test-loader failures (`tests/unit/cli/gemma-check.test.ts`, `tests/unit/scripts/package-skills.test.ts`) carry forward from Phase 1 unchanged; their cause is the vitest 1.6.1 Node-vm transform path on Windows, not anything in Phase 3.

## Test results

```
New unit tests:        47 cases across 6 new test files (incl. 11 PlanMode annotation cases)
New integration tests: 2 cases (plan revise-then-diff flow)
Lint:                  clean
Build:                 clean
Regressions:           none
```

## Deviations from the plan

- The plan said "On `PlanMode.setPlan(steps)`, call `PlanArchive.appendVersion(slug, plan)`". The actual wiring lives in `ChatController._checkForPlan` rather than inside `PlanMode.setPlan` itself, because the slug derivation (session-id based) and the diff-emission both want access to the `postMessage` callback and the previous plan version -- both of which `PlanMode` does not own. `PlanMode.setPlan` stays a pure state mutator; the controller orchestrates the archive + diff side-effect. The behaviour the plan asked for ships, just at a different seam.
- The plan's `loadCustomQuickLabels` originally pointed at `getLogger().warn`. The actual implementation routes through `console.warn` so the render-primitive module can be imported in jsdom-environment tests without dragging in the `vscode` import that lives at the top of `src/utils/logger.ts`. Behaviour is equivalent (the user still sees the warning in the extension output channel because VS Code routes `console.warn` there); only the import surface differs.

## Known gaps surfaced this phase

- **10.O.H (NI, P3)** -- The improvement-hook file is not scanned by the prompt-injection guardrail. Rationale: shell-rc parity. Future hooks that ingest external content must extend the scanner first.
- **10.O.I (WN, P3)** -- The `clean` diff mode wraps additions with trailing newlines as `**text\n**`. `diff` library semantics; `classic` + `raw` modes unaffected.

## Next steps

Phase 4: Observability + runtime + hybrid scoring. Ships the `/trace` single-file bug-report primitive, the LM Studio second `LLMClient` adapter with auto-detect on Apple Silicon, the omlx Gemma 4 channel parser reverse-engineered into TypeScript, per-model sampler presets + three thinking modes (`nothink` / `think` / `think-max`), prefix-aware system-prompt construction, hybrid RRF memory scoring with why-retrieved transparency, and the evaluator-rubric template.
