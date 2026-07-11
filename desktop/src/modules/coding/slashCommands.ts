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
//
// v1.1.0 Phase 8.4: skill-backed slash commands (user / nexus-hub) can be
// folded into the autocomplete via `filterSlashCommandsWithSkills`. When
// two skills share a display name, the `nexus.skills.preferUpstream`
// setting controls which one appears first (closes 10.P2.JJJ).

export interface SlashCommand {
  /** Command name without the leading slash (e.g. "plan", "review-pr"). */
  readonly name: string;
  readonly description: string;
  /** Composer pre-fill when the user picks this entry from the dropdown. */
  readonly template: string;
  /**
   * v1.1.0 Phase 8.4 -- where this command came from. Built-ins omit
   * the field. Skill-backed entries carry their namespace so the UI can
   * render a "nexus-hub" / "user" badge and the ordering policy can
   * differentiate between same-named candidates.
   */
  readonly namespace?: "builtin" | "user" | "nexus-hub";
  /** Optional canonical skill id (e.g. `nexus-hub/code-quality`). */
  readonly skillId?: string;
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
  // v1.1.0 Phase 6.3 - 6.5 -- hybrid retrieval + write + delete surfaces.
  { name: "recall", description: "Hybrid-search memory for a query and render the top-10 hits.", template: "/recall " },
  { name: "remember", description: "Write a working-tier observation tagged with the current session.", template: "/remember " },
  { name: "forget", description: "Delete memories by id or pattern (prompts for confirmation).", template: "/forget --id " },
  // v1.1.0 Phase 9.2 -- opt-in file compressor (gated by nexus.memory.compression.enabled).
  { name: "memory-compress", description: "Compress a file into a semantic-tier observation via the local Ollama model (opt-in).", template: "/memory-compress " },
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

// ---------------------------------------------------------------------------
// v1.1.0 Phase 8.4 -- skill-augmented autocomplete with preferUpstream
// ---------------------------------------------------------------------------

/**
 * Minimal projection of a `SkillRecord` (from `core/skills/SkillCatalog.ts`)
 * that the autocomplete needs. Kept structural so the desktop module does
 * not depend on the core skills types directly.
 */
export interface SkillForAutocomplete {
  /** Canonical id (e.g. `nexus-hub/code-quality` or `user/code-quality`). */
  readonly id: string;
  /** Display name (slash-command surface uses this verbatim as the name). */
  readonly displayName: string;
  /** Provenance source. Determines ordering when names collide. */
  readonly namespace: "builtin" | "user" | "nexus-hub";
  /** Short description -- rendered next to the entry in the dropdown. */
  readonly description?: string;
}

export interface FilterOptions {
  /**
   * When `true`, same-named user / nexus-hub pairs surface the nexus-hub
   * variant first. When `false` (default), the user variant wins.
   */
  readonly preferUpstream?: boolean;
}

/**
 * Build a slash-command-shaped entry from a skill record. Skill commands
 * pre-fill the composer with `/<displayName> ` so the user can supply
 * arguments before submitting.
 */
function toSlashCommandFromSkill(skill: SkillForAutocomplete): SlashCommand {
  return {
    name: skill.displayName,
    description: skill.description ?? `Skill from ${skill.namespace}.`,
    template: `/${skill.displayName} `,
    namespace: skill.namespace,
    skillId: skill.id,
  };
}

/**
 * Stable ordering for skill entries sharing the same display name. The
 * primary key is namespace: `nexus-hub` first when `preferUpstream`, else
 * `user` first. Secondary tiebreak preserves catalog order via the
 * caller-supplied array.
 */
function sortByPreference(
  entries: readonly SlashCommand[],
  preferUpstream: boolean,
): SlashCommand[] {
  const order: Record<string, number> = preferUpstream
    ? { "nexus-hub": 0, user: 1, builtin: 2, "": 3 }
    : { user: 0, "nexus-hub": 1, builtin: 2, "": 3 };
  return [...entries].sort((a, b) => {
    const aRank = order[a.namespace ?? ""] ?? 4;
    const bRank = order[b.namespace ?? ""] ?? 4;
    return aRank - bRank;
  });
}

/**
 * Return autocomplete entries for `input`, folding skill-backed commands
 * into the catalog. Builtin entries are always listed first (preserves
 * the existing UI); skills follow, ordered by `preferUpstream`. When two
 * skills (user + nexus-hub) share a `displayName`, both appear in the
 * dropdown so the user can pick explicitly; the `preferUpstream` flag
 * decides which one comes first within that pair.
 *
 * Pure function -- no I/O, no settings reads. Callers (the chat
 * composer) read `nexus.skills.preferUpstream` from `SettingsStore`
 * once and pass the boolean in.
 */
export function filterSlashCommandsWithSkills(
  input: string,
  skills: readonly SkillForAutocomplete[],
  opts: FilterOptions = {},
): readonly SlashCommand[] {
  const builtinHits = filterSlashCommands(input);
  if (input && !input.startsWith("/")) return builtinHits; // == []

  const needle = input.startsWith("/") ? input.slice(1).toLowerCase() : "";
  const skillHits = skills
    .map((s) => toSlashCommandFromSkill(s))
    .filter((c) => needle === "" || c.name.toLowerCase().startsWith(needle));

  // Group skill hits by lowercased name so same-named pairs cluster.
  const groups = new Map<string, SlashCommand[]>();
  for (const hit of skillHits) {
    const key = hit.name.toLowerCase();
    const arr = groups.get(key) ?? [];
    arr.push(hit);
    groups.set(key, arr);
  }
  const skillOut: SlashCommand[] = [];
  for (const group of groups.values()) {
    const ordered = sortByPreference(group, opts.preferUpstream ?? false);
    skillOut.push(...ordered);
  }
  return [...builtinHits, ...skillOut];
}
