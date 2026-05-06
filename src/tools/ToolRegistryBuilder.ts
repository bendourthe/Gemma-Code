import { ToolRegistry } from "./ToolRegistry.js";
import { ConfirmationGate } from "./ConfirmationGate.js";
import {
  ReadFileTool,
  WriteFileTool,
  CreateFileTool,
  DeleteFileTool,
  EditFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "./handlers/filesystem.js";
import { RunTerminalTool } from "./handlers/terminal.js";
import { WebSearchTool, FetchPageTool } from "./handlers/webSearch.js";
import { CompressRangeTool, CompressMessageTool, type CompressToolDeps } from "./handlers/compress.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { WebResponseCache } from "./handlers/webCache.js";
import type { EditMode } from "./types.js";

export interface ToolRegistryBuildOptions {
  readonly gate: ConfirmationGate;
  readonly editMode: EditMode;
  readonly secretPathDenyExtra: readonly string[];
  readonly permissionOverrides?: Record<string, number>;
  readonly toolOutputCache: ToolOutputCache | null;
  readonly webResponseCache: WebResponseCache | null;
  /**
   * v0.7.0 Phase 3: optional wiring for the model-callable compress tool.
   * When supplied, `compress_range` is registered (and `compress_message`
   * when its experimental flag is on). When omitted, neither tool is
   * registered, so legacy callers and the test harness keep working.
   */
  readonly compress?: {
    readonly deps: CompressToolDeps;
    readonly experimentalMessageMode: boolean;
  };
}

/**
 * Build the panel's primary {@link ToolRegistry}. Extracted from
 * GemmaCodePanel as part of v0.7.0 Phase 0 sub-task 0.4 so the panel no
 * longer hosts the per-tool registration list. Tool authorship continues to
 * follow the AGENTS.md Module Authorship Contract; this helper only
 * centralises the wiring.
 */
export function buildToolRegistry(opts: ToolRegistryBuildOptions): ToolRegistry {
  const { gate, editMode, secretPathDenyExtra, permissionOverrides } = opts;
  const registry = new ToolRegistry();

  registry.register(
    "read_file",
    new ReadFileTool(gate, secretPathDenyExtra, opts.toolOutputCache),
  );
  registry.register("write_file", new WriteFileTool(gate, editMode));
  registry.register("create_file", new CreateFileTool(gate, editMode));
  registry.register("delete_file", new DeleteFileTool());
  registry.register("edit_file", new EditFileTool(gate, editMode));
  registry.register("list_directory", new ListDirectoryTool(gate, secretPathDenyExtra));
  registry.register("grep_codebase", new GrepCodebaseTool(gate, secretPathDenyExtra));
  registry.register("run_terminal", new RunTerminalTool());
  registry.register("web_search", new WebSearchTool(opts.webResponseCache));
  registry.register("fetch_page", new FetchPageTool());

  if (opts.compress) {
    registry.register("compress_range", new CompressRangeTool(opts.compress.deps));
    if (opts.compress.experimentalMessageMode) {
      registry.register("compress_message", new CompressMessageTool(opts.compress.deps));
    }
  }

  registry.setConfirmationGate(gate, permissionOverrides, editMode);

  return registry;
}
