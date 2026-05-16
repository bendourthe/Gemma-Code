import * as fs from "fs";
import * as path from "path";
import { ToolRegistry } from "./ToolRegistry.js";
import { ConfirmationGate } from "./ConfirmationGate.js";
import {
  scanHandlerDirectory,
  reportRegistryDrift,
  type ScannedModule,
} from "./AstToolScanner.js";
import { getLogger } from "../utils/logger.js";
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
import { UpdateTodosTool, type TodoState } from "./handlers/todos.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { WebResponseCache } from "./handlers/webCache.js";
import type { EditMode } from "./types.js";
import type { PostMessageFn } from "../chat/StreamingPipeline.js";

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
  /**
   * v0.7.0 Phase 4.4: optional wiring for the `update_todos` tool. When
   * supplied, the tool is registered with permission tier 0 and emits
   * `renderTodoUpdate` messages through `post`.
   */
  readonly todos?: {
    readonly state: TodoState;
    readonly post: PostMessageFn;
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

  if (opts.todos) {
    registry.register(
      "update_todos",
      new UpdateTodosTool(opts.todos.state, opts.todos.post),
    );
  }

  registry.setConfirmationGate(gate, permissionOverrides, editMode);

  return registry;
}

/**
 * v0.8.0 Phase 5 sub-task 5.3 (item D2) -- AST scan of the handler directory.
 *
 * The builder above stays the source of truth for which handlers are wired;
 * this helper exposes the scanner result so a build / CI step can warn when
 * a handler module exists with no registration, or when a non-handler module
 * is lurking under `handlers/`. Non-fatal: the function returns a structured
 * report instead of throwing so the production startup path remains
 * import-cheap.
 */
export interface RegistryAstAuditOptions {
  readonly handlersDir?: string;
  readonly wiredClassNames: readonly string[];
}

export function auditToolRegistryAst(opts: RegistryAstAuditOptions): {
  scans: readonly ScannedModule[];
  drift: ReturnType<typeof reportRegistryDrift>;
} {
  const handlersDir = opts.handlersDir ?? defaultHandlersDir();
  if (!fs.existsSync(handlersDir)) {
    getLogger().debug(
      `[ToolRegistryBuilder] AST audit skipped: ${handlersDir} not found`,
    );
    return { scans: [], drift: { skippableModules: [], unwiredHandlers: [] } };
  }
  const scans = scanHandlerDirectory(handlersDir);
  const drift = reportRegistryDrift(scans, opts.wiredClassNames);
  if (drift.skippableModules.length > 0) {
    getLogger().debug(
      `[ToolRegistryBuilder] AST audit found ${drift.skippableModules.length} skippable module(s) ` +
        `(no handler exports): ${drift.skippableModules.join(", ")}`,
    );
  }
  if (drift.unwiredHandlers.length > 0) {
    getLogger().warn(
      `[ToolRegistryBuilder] AST audit found ${drift.unwiredHandlers.length} unwired handler(s): ` +
        drift.unwiredHandlers.map((h) => `${h.className} (${h.filePath})`).join(", "),
    );
  }
  return { scans, drift };
}

function defaultHandlersDir(): string {
  // Resolve relative to the source tree. Compiled `out/` mirrors `src/`, so
  // walking up two levels from the file location lands on the project root.
  // The audit is intended for dev/CI runs that operate against `src/`.
  const here = path.resolve(__dirname);
  return path.resolve(here, "..", "..", "src", "tools", "handlers");
}
