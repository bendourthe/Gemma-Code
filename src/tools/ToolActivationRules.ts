import type { DynamicToolMetadata } from "./ToolCatalog.js";
import type { BuiltinToolName, ToolName } from "./types.js";

/** Maximum number of tools to include in the prompt for reliable Gemma 4 tool calling. */
const MAX_TOOL_COUNT = 20;

/**
 * v1.16.0 Phase 4 (adoption item A6) -- opt-in built-ins that are NOT part of
 * the default coding path and may be trimmed under the tool-count cap. Adding a
 * built-in that is neither MCP nor `codegraph_*` would otherwise be untrimmable
 * and would breach the prompt budget outright.
 */
const OPTIONAL_SPECIALTY_TOOLS: ReadonlySet<string> = new Set([
  "parse_document",
  "watch_path",
  "hash_file",
]);

/** v2.0 DF-7 -- browser family trims after codegraph so coding symbol tools win first. */
const BROWSER_FAMILY_TOOLS: ReadonlySet<string> = new Set([
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_aria_snapshot",
  "browser_close",
]);

/**
 * v0.8.0 Phase 5 sub-task 5.4 (item D3) -- 30 s TTL for expensive availability
 * probes. Used by callers that need to ask "is Docker reachable", "is the
 * Playwright binary on disk", "is Ollama up": instead of hitting the network /
 * filesystem on every prompt build, the result is cached for the TTL window.
 *
 * The cache is keyed by (name, argSignature) so the same `name` with different
 * arguments produces independent entries. The default TTL matches the source
 * registry pattern (30 s); callers can override via the `ttlMs` option.
 */

export const DEFAULT_CHECK_TTL_MS = 30_000;

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: unknown;
}

const _checkCache = new Map<string, CacheEntry>();

function cacheKey(name: string, args: readonly unknown[]): string {
  if (args.length === 0) return name;
  return `${name}::${JSON.stringify(args)}`;
}

/**
 * Run `probe` and cache its result for `ttlMs`. A second call within the
 * window returns the cached value without invoking `probe`. Useful for
 * Docker / playwright / Ollama / MCP availability checks that are expensive
 * but stable over short windows.
 */
export async function cachedCheck<T>(
  name: string,
  args: readonly unknown[],
  probe: () => Promise<T> | T,
  options: { ttlMs?: number; now?: () => number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_CHECK_TTL_MS;
  const now = (options.now ?? Date.now)();
  const key = cacheKey(name, args);
  const cached = _checkCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  const value = await probe();
  _checkCache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

/** Synchronous variant for callers whose probe is itself synchronous. */
export function cachedCheckSync<T>(
  name: string,
  args: readonly unknown[],
  probe: () => T,
  options: { ttlMs?: number; now?: () => number } = {},
): T {
  const ttlMs = options.ttlMs ?? DEFAULT_CHECK_TTL_MS;
  const now = (options.now ?? Date.now)();
  const key = cacheKey(name, args);
  const cached = _checkCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  const value = probe();
  _checkCache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

/** Drop a single cache entry by name (all argument variants) or the entire cache. */
export function invalidateCheck(name?: string): void {
  if (!name) {
    _checkCache.clear();
    return;
  }
  const prefix = `${name}::`;
  for (const key of [..._checkCache.keys()]) {
    if (key === name || key.startsWith(prefix)) {
      _checkCache.delete(key);
    }
  }
}

/** Test-only: peek at the cache size. */
export function _checkCacheSizeForTests(): number {
  return _checkCache.size;
}

export interface ToolActivationContext {
  readonly ollamaReachable: boolean;
  readonly networkAvailable: boolean;
  readonly readOnlySession: boolean;
  readonly subAgentType?: "research" | "verification" | null;
  readonly totalToolCount: number;
}

export interface ToolActivationResult {
  readonly disabledTools: Set<ToolName>;
  readonly reasons: Map<ToolName, string>;
  /**
   * v1.4.0 Phase 8 (gap 3.5.P3.I): true when Rule 6 (the tool-count cap) trimmed
   * at least one `codegraph_*` tool. Lets the prompt builder warn the agent that
   * code-graph navigation is unavailable this turn (fall back to grep) instead
   * of the tools silently vanishing from the catalog.
   */
  readonly trimmedCodegraph: boolean;
}

const NETWORK_TOOLS: readonly BuiltinToolName[] = [
  "web_search",
  "fetch_page",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_aria_snapshot",
];

const WRITE_TOOLS: readonly BuiltinToolName[] = [
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
  "run_terminal",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_aria_snapshot",
  "browser_close",
];

const RESEARCH_DISABLED: readonly BuiltinToolName[] = [
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
];

const VERIFICATION_DISABLED: readonly BuiltinToolName[] = [
  "write_file",
  "create_file",
  "delete_file",
];

/**
 * Compute which tools should be disabled based on the current runtime context.
 * Rules are applied in order; a tool disabled by an earlier rule stays disabled.
 */
export function computeToolActivation(
  allTools: readonly DynamicToolMetadata[],
  context: ToolActivationContext,
): ToolActivationResult {
  const disabled = new Set<ToolName>();
  const reasons = new Map<ToolName, string>();
  let trimmedCodegraph = false;

  function disable(names: readonly ToolName[], reason: string): void {
    for (const name of names) {
      if (!disabled.has(name)) {
        disabled.add(name);
        reasons.set(name, reason);
      }
    }
  }

  // Rule 1: Ollama unreachable — disable all tools.
  if (!context.ollamaReachable) {
    disable(
      allTools.map((t) => t.name),
      "Ollama is not reachable",
    );
    return { disabledTools: disabled, reasons, trimmedCodegraph };
  }

  // Rule 2: No network — disable network-dependent tools.
  if (!context.networkAvailable) {
    disable(NETWORK_TOOLS, "Network is unavailable");
  }

  // Rule 3: Read-only session — disable all write/execute tools.
  if (context.readOnlySession) {
    disable(WRITE_TOOLS, "Read-only session");
  }

  // Rule 4: Research sub-agent — disable write tools (but not run_terminal).
  if (context.subAgentType === "research") {
    disable(RESEARCH_DISABLED, "Research sub-agent is read-only");
  }

  // Rule 5: Verification sub-agent — disable create/delete tools (can read + edit).
  if (context.subAgentType === "verification") {
    disable(VERIFICATION_DISABLED, "Verification sub-agent cannot create or delete files");
  }

  // Rule 6: Tool count cap — trim lowest-priority MCP tools, then the opt-in
  // specialty built-ins, then codegraph_*, then the browser family. Cap is 20
  // so the five browser tools can remain after a full coding catalog.
  // Core built-ins (read_file, write_file, grep_codebase, etc.) are never
  // trimmed because the agent depends on them for the default path.
  const enabledTools = allTools.filter((t) => !disabled.has(t.name));
  if (enabledTools.length > MAX_TOOL_COUNT) {
    const mcpTools = enabledTools
      .filter((t) => t.source === "mcp")
      .sort((a, b) => b.priority - a.priority); // highest priority number = lowest importance
    // v1.16.0 Phase 4 (A6): `parse_document` is opt-in and off by default, and a
    // coding turn almost never needs it, so it is trimmed BEFORE codegraph --
    // losing symbol navigation hurts the default coding path more than losing
    // document OCR does. Without this it would be untrimmable and would push the
    // untrimmable core past the cap, breaking the prompt budget for everyone.
    const specialtyTools = enabledTools.filter(
      (t) => t.source !== "mcp" && OPTIONAL_SPECIALTY_TOOLS.has(String(t.name)),
    );
    const codegraphTools = enabledTools.filter(
      (t) => t.source !== "mcp" && String(t.name).startsWith("codegraph_"),
    );
    const browserTools = enabledTools.filter(
      (t) => t.source !== "mcp" && BROWSER_FAMILY_TOOLS.has(String(t.name)),
    );
    const trimCandidates = [...mcpTools, ...specialtyTools, ...codegraphTools, ...browserTools];

    let toDisable = enabledTools.length - MAX_TOOL_COUNT;
    for (const tool of trimCandidates) {
      if (toDisable <= 0) break;
      disable([tool.name], `Exceeds ${MAX_TOOL_COUNT}-tool limit (priority: ${tool.priority})`);
      if (String(tool.name).startsWith("codegraph_")) trimmedCodegraph = true;
      toDisable--;
    }
  }

  return { disabledTools: disabled, reasons, trimmedCodegraph };
}
