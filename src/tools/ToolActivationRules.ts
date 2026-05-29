import type { DynamicToolMetadata } from "./ToolCatalog.js";
import type { BuiltinToolName, ToolName } from "./types.js";

/** Maximum number of tools to include in the prompt for reliable Gemma 4 tool calling. */
const MAX_TOOL_COUNT = 15;

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
}

const NETWORK_TOOLS: readonly BuiltinToolName[] = ["web_search", "fetch_page"];

const WRITE_TOOLS: readonly BuiltinToolName[] = [
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
  "run_terminal",
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
    return { disabledTools: disabled, reasons };
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

  // Rule 6: Tool count cap — trim lowest-priority MCP tools, then trim the
  // specialized `codegraph_*` built-ins (v1.2.0 Phase 3.5) so the prompt
  // stays around the 15-tool budget. Core built-ins (read_file, write_file,
  // grep_codebase, etc.) are never trimmed because the agent depends on
  // them for the default path.
  const enabledTools = allTools.filter((t) => !disabled.has(t.name));
  if (enabledTools.length > MAX_TOOL_COUNT) {
    const mcpTools = enabledTools
      .filter((t) => t.source === "mcp")
      .sort((a, b) => b.priority - a.priority); // highest priority number = lowest importance
    const codegraphTools = enabledTools.filter(
      (t) => t.source !== "mcp" && String(t.name).startsWith("codegraph_"),
    );
    const trimCandidates = [...mcpTools, ...codegraphTools];

    let toDisable = enabledTools.length - MAX_TOOL_COUNT;
    for (const tool of trimCandidates) {
      if (toDisable <= 0) break;
      disable([tool.name], `Exceeds ${MAX_TOOL_COUNT}-tool limit (priority: ${tool.priority})`);
      toDisable--;
    }
  }

  return { disabledTools: disabled, reasons };
}
