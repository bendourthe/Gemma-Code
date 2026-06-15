/**
 * v1.5.0 Phase 7 (HUB.P3.CMD) -- consume the Nexus-Hub command catalog.
 *
 * The Hub ships verb-first command definitions under `catalog/commands/*.md`
 * (frontmatter `description` + a markdown body that instructs the agent). They
 * were sparse-cloned by the skills syncer but never reached the slash-command
 * surface. This loader reads them from a synced bundle and exposes each as a
 * CommandDescriptor (for autocomplete / `/help`) plus its body (so invoking a
 * Hub command injects its instructions, the same way a skill prompt does).
 *
 * Built-in command names take precedence and are never shadowed by a Hub
 * command of the same name (the router checks built-ins first).
 */

import * as fs from "fs";
import * as path from "path";
import { getLogger } from "../utils/logger.js";
import type { CommandDescriptor } from "./CommandRouter.js";

/** A Hub command translated into Nexus terms. */
export interface HubCommand {
  readonly name: string;
  readonly description: string;
  /** Markdown body (frontmatter stripped) -- injected as the agent directive. */
  readonly body: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Pull `description` out of the minimal frontmatter and return the body. */
function parseCommandFile(content: string): { description: string; body: string } {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) return { description: "", body: content.trim() };
  const block = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  let description = "";
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === "description") {
      description = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      break;
    }
  }
  return { description, body };
}

/**
 * Loads Hub commands from a synced bundle's `catalog/commands/` directory.
 * Inert (empty) when the directory is null or absent.
 */
export class HubCommandCatalogLoader {
  private _cache: Map<string, HubCommand> | null = null;

  constructor(private readonly _commandsDir: string | null) {}

  get(name: string): HubCommand | null {
    return this._index().get(name) ?? null;
  }

  /** Descriptors for autocomplete / `/help`. */
  descriptors(): CommandDescriptor[] {
    return [...this._index().values()].map((c) => ({
      name: c.name,
      description: c.description || `Nexus-Hub command: ${c.name}`,
    }));
  }

  private _index(): Map<string, HubCommand> {
    if (this._cache) return this._cache;
    const cache = new Map<string, HubCommand>();
    this._cache = cache;
    if (!this._commandsDir) return cache;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this._commandsDir, { withFileTypes: true });
    } catch {
      return cache;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = entry.name.replace(/\.md$/, "");
      let content: string;
      try {
        content = fs.readFileSync(path.join(this._commandsDir, entry.name), "utf-8");
      } catch {
        continue;
      }
      const { description, body } = parseCommandFile(content);
      if (!body) {
        getLogger().debug(`[HubCommandCatalogLoader] skipped empty command ${entry.name}`);
        continue;
      }
      cache.set(name, { name, description, body });
    }
    return cache;
  }
}
