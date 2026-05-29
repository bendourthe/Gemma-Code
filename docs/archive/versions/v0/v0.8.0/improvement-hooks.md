# Improvement Hooks (v0.8.0 Phase 3.4)

User-editable markdown files that overlay additive rules onto Gemma-Code's prompt at specific lifecycle moments. Hooks are *additive*; they cannot override the built-in system prompt or the plan-mode addendum. A missing or empty hook is treated as a no-op.

## Location

Hooks live under `~/.gemma-code/hooks/`. Each hook is a markdown file named after its trigger:

| Hook file | When it fires | Where the body is injected |
|---|---|---|
| `enterplanmode-improve.md` | Every time plan mode activates (user toggles the editor to "plan" mode) | System message appended to the conversation, after the plan-mode addendum and the PFM capabilities reminder |

Additional hooks will be added in later phases. The `HookName` type in `src/chat/ImprovementHook.ts` is the authoritative list of recognised names.

## Editing a hook

From the VS Code command palette: run `Gemma Code: Edit Plan-Mode Improvement Hook`. If the file does not exist, Gemma-Code creates the directory + a starter template and opens it. Save the file; the next plan-mode activation reads the updated content.

You can also edit the file directly on disk -- no restart required.

## File format

Plain markdown. No frontmatter, no schema. The body is read as-is, trimmed, and prepended with a `## User-supplied plan-mode rules` heading so the model can distinguish the user overlay from the built-in addendum.

## Example: `enterplanmode-improve.md`

```markdown
# Plan-mode improvement rules

- When the plan touches the storage layer, always include a migration step.
- When the plan involves git operations, always include a backup checkpoint.
- Prefer dependency injection over module-level globals when introducing new collaborators.
- Every step that touches a webview render primitive must include a paired jsdom test.
```

When plan mode activates, the body above is injected as a system message after the rebuilt system prompt. The model sees the heading + the bullets verbatim and can fold them into its plan generation.

## Empty bodies and missing files

A hook file that is missing, empty, or contains only whitespace is treated as a no-op. The plan-mode entry flow continues with the built-in system prompt only.

## Disabling a hook

Delete the file or replace its contents with whitespace. Renaming it to a name not in the `HookName` union also disables it -- only the canonical names are read.

## Safety

- Hook content is loaded synchronously at activation time only; there is no background watcher.
- The file is read with UTF-8 encoding. Non-text payloads will be treated as text and may produce a noisy system message but cannot trigger code execution.
- The prompt-injection scanner that guards `Memory.md` / `Context.md` does **not** run against the hook file -- the assumption is that the user authored the content themselves. Treat the hooks directory the same way you treat your shell rc files.
