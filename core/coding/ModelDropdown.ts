/**
 * v1.1.0 Phase 11.1 -- model dropdown view model.
 *
 * The Phase 11 chat panel renders a `<select>` populated from every locally
 * installed text model that has chat capability (not just the v1.0.0
 * Gemma 4 default). The picker pulls the canonical catalog from
 * `core/registry/ModelCatalog` so the desktop module and the extension's
 * webview see the same list.
 *
 * When the daemon IPC client lands (known-gap 10.1.P1.Z), the dropdown
 * source flips to `ipc.call("models.list", { type: "text", capability:
 * "chat" })`; both code paths return the same `ModelDropdownEntry[]`
 * shape, so the rest of the panel does not change.
 */

import {
  ModelCatalog,
  type LlmCatalogEntry,
  type ModelFamily,
} from "../registry/ModelCatalog.js";

/** Capability flag the chat panel filters on; widened in later phases. */
export type ModelCapability = "chat" | "tool-use" | "coding";

/** Model type filter; the chat panel always passes `"text"`. */
export type ModelType = "text";

export interface ModelDropdownEntry {
  readonly id: string;
  readonly displayName: string;
  readonly family: ModelFamily;
  readonly capabilities: readonly ModelCapability[];
  readonly recommended: boolean;
}

export interface ModelDropdownFilter {
  readonly type?: ModelType;
  readonly capability?: ModelCapability;
}

const KNOWN_CAPABILITIES: readonly ModelCapability[] = Object.freeze([
  "chat",
  "tool-use",
  "coding",
]);

const CHAT_CAPABLE_TAGS: ReadonlySet<string> = new Set([
  "chat",
  "tool-use",
  "coding",
]);

function projectCapabilities(
  tags: readonly string[],
): readonly ModelCapability[] {
  const out: ModelCapability[] = [];
  // Every text LLM in the catalog can be conversed with; tag the entry as
  // chat-capable when any of the "chat / tool-use / coding" surface tags is
  // present so the dropdown filter does not accidentally hide a coder model
  // whose tag list omits the bare "chat" string.
  const inferredChat = tags.some((t) => CHAT_CAPABLE_TAGS.has(t));
  if (inferredChat) out.push("chat");
  if (tags.includes("tool-use")) out.push("tool-use");
  if (tags.includes("coding")) out.push("coding");
  return Object.freeze(out);
}

function projectEntry(entry: LlmCatalogEntry): ModelDropdownEntry {
  return Object.freeze({
    id: entry.id,
    displayName: entry.displayName,
    family: entry.family,
    capabilities: projectCapabilities(entry.tags),
    recommended: entry.tags.includes("recommended"),
  });
}

/**
 * Return the dropdown view model for every text model in the canonical
 * catalog. The list is stable (insertion order from `ModelCatalog.listLlm()`)
 * with the `recommended` entries hoisted to the front.
 */
export function listModelDropdownEntries(
  filter: ModelDropdownFilter = {},
): readonly ModelDropdownEntry[] {
  return projectModelDropdownEntries(ModelCatalog.listLlm(), filter);
}

/**
 * Project + filter an arbitrary catalog snapshot into the dropdown view
 * model. Exposed for tests + the daemon-side `models.list` handler so it
 * can pass in a fresh snapshot rather than the module-level singleton.
 */
export function projectModelDropdownEntries(
  catalog: readonly LlmCatalogEntry[],
  filter: ModelDropdownFilter = {},
): readonly ModelDropdownEntry[] {
  const required: ModelCapability | undefined = filter.capability;
  const projected = catalog
    .map(projectEntry)
    .filter((e) => (required ? e.capabilities.includes(required) : true));
  const recommended = projected.filter((e) => e.recommended);
  const rest = projected.filter((e) => !e.recommended);
  return Object.freeze([...recommended, ...rest]);
}

/**
 * Resolve the active model id from a settings store, with a deterministic
 * fallback to the first dropdown entry (after the `recommended` hoist).
 *
 * Returns the stored id verbatim when it matches an entry in the supplied
 * dropdown list. Falls back when the stored id is missing, blank, or no
 * longer present in the catalog (e.g. the user uninstalled the model
 * between sessions).
 */
export function resolveActiveModelId(
  stored: string | null | undefined,
  entries: readonly ModelDropdownEntry[],
): string | null {
  if (entries.length === 0) return null;
  if (stored && entries.some((e) => e.id === stored)) {
    return stored;
  }
  return entries[0]?.id ?? null;
}

export const ACTIVE_MODEL_SETTING_KEY = "nexus.coding.activeModel";
