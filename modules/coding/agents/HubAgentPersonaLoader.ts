/**
 * v1.5.0 Phase 7 (HUB.P3.AGENT) -- consume the Nexus-Hub agent roster.
 *
 * The Hub ships ~23 reviewer/specialist agent personas under `catalog/agents/`
 * (markdown with `name` / `description` / `tools` frontmatter and a system-prompt
 * body). They were sparse-cloned by the skills syncer but never reached the
 * sub-agent layer. This loader reads them from a synced bundle and translates
 * each into a `Specialist`-shaped persona the SubAgentManager can dispatch:
 *
 *  - the Hub `tools` list (human names: "Read, Glob, Grep, Bash") is mapped to
 *    Nexus registry tool ids ("read_file", "list_directory", ...); unknown /
 *    non-local tools are dropped so a persona can never widen the tool surface;
 *  - the markdown body becomes the persona's system prompt.
 *
 * Pure + offline: it only reads files under the given agents directory and never
 * touches the network.
 */

import * as fs from "fs";
import * as path from "path";
import { getLogger } from "../utils/logger.js";
import type { Specialist, SpecialistTier } from "./SpecialistLoader.js";

/** A Hub agent persona translated into Nexus terms. */
export interface HubAgentPersona {
  readonly name: string;
  readonly description: string;
  /** Nexus registry tool ids (translated + filtered from the Hub `tools` list). */
  readonly toolScope: readonly string[];
  readonly systemPrompt: string;
}

/**
 * Map the Hub's human-facing tool names to Nexus registry tool ids. Tools with
 * no safe local equivalent (e.g. the Hub `Task` sub-agent spawner) are omitted
 * deliberately, so a persona never expands the tool surface beyond what Nexus
 * already exposes.
 */
const HUB_TOOL_TO_REGISTRY: Readonly<Record<string, string>> = {
  Read: "read_file",
  Write: "write_file",
  Edit: "edit_file",
  Glob: "list_directory",
  Grep: "grep_codebase",
  Bash: "run_terminal",
  WebSearch: "web_search",
  WebFetch: "fetch_page",
  TodoWrite: "update_todos",
};

/** Translate a Hub `tools` frontmatter value into deduped registry tool ids. */
export function translateHubTools(toolsValue: string | undefined): string[] {
  if (!toolsValue) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of toolsValue.split(",")) {
    const mapped = HUB_TOOL_TO_REGISTRY[raw.trim()];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse the minimal `key: value` frontmatter the Hub agent files use. */
function parseAgentFrontmatter(
  content: string,
): { name?: string; description?: string; tools?: string; body: string } | null {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) return null;
  const block = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) meta[key] = val;
  }
  return { name: meta.name, description: meta.description, tools: meta.tools, body };
}

/** Parse one Hub agent markdown file into a persona, or null if unusable. */
export function personaFromMarkdown(content: string, fallbackName: string): HubAgentPersona | null {
  const parsed = parseAgentFrontmatter(content);
  if (!parsed || !parsed.body) return null;
  const name = parsed.name || fallbackName;
  if (!name) return null;
  return {
    name,
    description: parsed.description ?? "",
    toolScope: Object.freeze(translateHubTools(parsed.tools)),
    systemPrompt: parsed.body,
  };
}

/**
 * Loads the Hub agent personas from a synced bundle's `catalog/agents/`
 * directory. Construct with the directory; call `loadAll()` (memoized) or
 * `get(name)`. When the directory is absent the loader is simply empty -- the
 * feature is inert until a Hub bundle with agents is synced.
 */
export class HubAgentPersonaLoader {
  private _cache: Map<string, HubAgentPersona> | null = null;

  constructor(private readonly _agentsDir: string | null) {}

  loadAll(): HubAgentPersona[] {
    return [...this._index().values()];
  }

  listNames(): string[] {
    return [...this._index().keys()].sort();
  }

  get(name: string): HubAgentPersona | null {
    return this._index().get(name) ?? null;
  }

  /** Resolve a persona to a `Specialist` for the SubAgentManager. */
  toSpecialist(name: string, modelTier: SpecialistTier = "balanced"): Specialist | null {
    const persona = this.get(name);
    if (!persona) return null;
    return {
      role: persona.name,
      modelTier,
      toolScope: persona.toolScope,
      systemPrompt: persona.systemPrompt,
      provenance: "hub",
    };
  }

  private _index(): Map<string, HubAgentPersona> {
    if (this._cache) return this._cache;
    const cache = new Map<string, HubAgentPersona>();
    this._cache = cache;
    if (!this._agentsDir) return cache;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this._agentsDir, { withFileTypes: true });
    } catch {
      return cache;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      let content: string;
      try {
        content = fs.readFileSync(path.join(this._agentsDir, entry.name), "utf-8");
      } catch {
        continue;
      }
      const persona = personaFromMarkdown(content, entry.name.replace(/\.md$/, ""));
      if (persona) cache.set(persona.name, persona);
      else getLogger().debug(`[HubAgentPersonaLoader] skipped unusable agent file ${entry.name}`);
    }
    return cache;
  }
}
