// v1.0.0 Phase 3.6 -- slash-command catalog (frontend-side).
//
// The existing slash-command parser lives in
// `modules/coding/chat/SlashCommandRouter.ts` (still under the legacy
// `src/chat/` tree during the one-cycle compat window). The desktop chat
// input does not parse commands itself; it pre-fills the chat composer with
// the selected entry's `template` and routes execution through the IPC
// `coding.session.sendMessage` call. The exhaustive parity check (every
// slash command in the catalog producing identical output to the VS Code
// reference) is tracked in v1.0.0 known-gaps and runs as the Phase 3.7
// operator action.

export interface SlashCommand {
  /** Command name without the leading slash (e.g. "plan", "review-pr"). */
  readonly name: string;
  readonly description: string;
  /** Composer pre-fill when the user picks this entry from the dropdown. */
  readonly template: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = Object.freeze([
  { name: "plan", description: "Switch to Plan mode for the current task.", template: "/plan " },
  { name: "clear", description: "Clear the current session's chat history.", template: "/clear" },
  { name: "commit", description: "Generate a structured commit message.", template: "/commit" },
  { name: "review-pr", description: "Run an autonomous PR review on the current branch.", template: "/review-pr " },
  { name: "curate", description: "Run the memory curator (use --dry-run to preview).", template: "/curate --dry-run" },
  { name: "trace", description: "Open the trace dashboard (status / clear / start).", template: "/trace status" },
  { name: "thinking-mode", description: "Toggle thinking mode (off / think / think hard / ultrathink).", template: "/thinking-mode think" },
  { name: "skill-metrics", description: "Print skill activation metrics.", template: "/skill-metrics" },
  { name: "memory", description: "Inspect or mutate the four-layer memory.", template: "/memory status" },
  { name: "verify", description: "Verify the most recent agent claim against the workspace.", template: "/verify" },
  { name: "research", description: "Run a research sub-agent on the current question.", template: "/research " },
  { name: "help", description: "List available slash commands.", template: "/help" },
]);

export function listSlashCommands(): readonly SlashCommand[] {
  return SLASH_COMMANDS;
}

/**
 * Return entries whose name starts with `prefix` (case-insensitive), preserving
 * catalog order. An empty prefix returns the full list; a non-slash prefix
 * returns the empty list. `/` alone returns the full list.
 */
export function filterSlashCommands(input: string): readonly SlashCommand[] {
  if (!input) return SLASH_COMMANDS;
  if (!input.startsWith("/")) return [];
  const needle = input.slice(1).toLowerCase();
  if (needle === "") return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(needle));
}
