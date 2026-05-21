/**
 * v1.1.0 Phase 11.5 -- daemon-side slash-command autocomplete.
 *
 * The Phase 11 chat panel forwards `tab` keystrokes for completion via
 * `coding.chat.autocomplete` IPC and renders the resulting suggestions.
 * The daemon owns the skill catalog and the `preferUpstream` setting; the
 * extension does not duplicate any of that state. This module ships the
 * pure handler the daemon mounts behind that method id.
 *
 * The desktop module already has `filterSlashCommandsWithSkills` in
 * `desktop/src/modules/coding/slashCommands.ts`; the daemon handler
 * delegates to a structurally-identical implementation here so the
 * extension webview and the desktop module produce identical suggestion
 * lists for the same `(input, skills, preferUpstream)` triple.
 */

export type SlashNamespace = "builtin" | "user" | "devai-hub";

export interface SlashSuggestion {
  readonly name: string;
  readonly description: string;
  readonly template: string;
  readonly namespace?: SlashNamespace;
  readonly skillId?: string;
}

export interface SlashSkillRecord {
  readonly id: string;
  readonly displayName: string;
  readonly namespace: "user" | "devai-hub";
  readonly description?: string;
}

export interface AutocompleteRequest {
  readonly input: string;
  readonly preferUpstream: boolean;
}

export interface AutocompleteContext {
  readonly builtins: readonly SlashSuggestion[];
  readonly skills: readonly SlashSkillRecord[];
}

const PREFER_UPSTREAM_ORDER: Record<SlashNamespace, number> = {
  "devai-hub": 0,
  user: 1,
  builtin: 2,
};

const PREFER_USER_ORDER: Record<SlashNamespace, number> = {
  user: 0,
  "devai-hub": 1,
  builtin: 2,
};

function filterBuiltins(
  input: string,
  builtins: readonly SlashSuggestion[],
): readonly SlashSuggestion[] {
  if (!input) return builtins;
  if (!input.startsWith("/")) return [];
  const needle = input.slice(1).toLowerCase();
  if (needle === "") return builtins;
  return builtins.filter((c) => c.name.toLowerCase().startsWith(needle));
}

function toSuggestion(skill: SlashSkillRecord): SlashSuggestion {
  return Object.freeze({
    name: skill.displayName,
    description: skill.description ?? `Skill from ${skill.namespace}.`,
    template: `/${skill.displayName} `,
    namespace: skill.namespace,
    skillId: skill.id,
  });
}

function rankFor(ns: SlashNamespace | undefined, preferUpstream: boolean): number {
  const table = preferUpstream ? PREFER_UPSTREAM_ORDER : PREFER_USER_ORDER;
  return table[ns ?? "builtin"] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Daemon-side handler for the `coding.chat.autocomplete` IPC. Returns
 * builtin entries first (preserves the existing UI), then skill-backed
 * entries grouped by display name with the `preferUpstream`-favoured
 * namespace leading inside each pair.
 *
 * Pure function -- no fs / network. The caller injects the live catalog
 * via `context.skills`.
 */
export function autocompleteSlashCommands(
  request: AutocompleteRequest,
  context: AutocompleteContext,
): readonly SlashSuggestion[] {
  const builtinHits = filterBuiltins(request.input, context.builtins);
  if (request.input && !request.input.startsWith("/")) return builtinHits;

  const needle = request.input.startsWith("/")
    ? request.input.slice(1).toLowerCase()
    : "";
  const skillHits = context.skills
    .map(toSuggestion)
    .filter((c) => needle === "" || c.name.toLowerCase().startsWith(needle));

  const groups = new Map<string, SlashSuggestion[]>();
  for (const hit of skillHits) {
    const key = hit.name.toLowerCase();
    const arr = groups.get(key) ?? [];
    arr.push(hit);
    groups.set(key, arr);
  }
  const skillOut: SlashSuggestion[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) =>
        rankFor(a.namespace, request.preferUpstream) -
        rankFor(b.namespace, request.preferUpstream),
    );
    skillOut.push(...ordered);
  }
  return Object.freeze([...builtinHits, ...skillOut]);
}

export const AUTOCOMPLETE_IPC_METHOD = "coding.chat.autocomplete";
