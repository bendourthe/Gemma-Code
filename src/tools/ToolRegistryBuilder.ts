import * as fs from "fs";
import * as path from "path";
import { ToolRegistry } from "./ToolRegistry.js";
import { ConfirmationGate } from "./ConfirmationGate.js";
import {
  scanHandlerDirectory,
  reportRegistryDrift,
  type ScannedModule,
} from "./AstToolScanner.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import {
  ReadFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "./handlers/filesystem.js";
// v0.9.0 Phase 6.6 (from v0.8.0 known-gaps 10.O.Q) -- the tier `confirm` /
// `dangerous` handler modules below are loaded lazily via `await import()`
// inside the factories passed to `registerLazy()`. They are only resolved
// when the tool is actually invoked. The tier `auto-approve` handlers
// (read_file / list_directory / grep_codebase / compress_* / update_todos)
// stay eager because the prompt builder needs their catalog entries on the
// first turn. Reverse-engineered drift detection via `auditToolRegistryAst`
// remains the cross-validation.
import type { CompressToolDeps } from "./handlers/compress.js";
import { CompressRangeTool, CompressMessageTool } from "./handlers/compress.js";
import { UpdateTodosTool, type TodoState } from "./handlers/todos.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { WebResponseCache } from "./handlers/webCache.js";
import type { EditMode } from "./types.js";
import type { PostMessageFn } from "../../modules/coding/chat/StreamingPipeline.js";
import type { CodeGraphHandlerDeps } from "./handlers/codegraph.js";
import type { LspHandlerDeps } from "./handlers/lsp.js";
import type { DenyList } from "../../core/storage/PermissionsDeny.js";

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
  /**
   * v1.2.0 Phase 3.5: optional wiring for the 8 `codegraph_*` tools. When
   * supplied, the tools are registered lazily so the SQLite store + scanner
   * are only constructed on first invocation. Omit to keep the codegraph
   * surface disabled (e.g. on a fresh checkout that has not yet indexed).
   */
  readonly codegraph?: CodeGraphHandlerDeps;
  /**
   * v1.2.0 Phase 6.2: optional wiring for the 2 `lsp_*` tools. When
   * supplied, the tools are registered lazily so the per-language LSP
   * child process only spawns on first invocation. Omit to keep LSP
   * tooling disabled (e.g. when running in a sandbox without the
   * language servers installed).
   */
  readonly lsp?: LspHandlerDeps;
  /**
   * v1.4.0 Phase 8 (gap 5.3.P2.R): the parsed `.nexus/permissions.deny`
   * denylist. When supplied, the registry refuses write-capable tool calls
   * whose subject matches a deny rule. Omit (or pass an empty list) to leave
   * deny-gating off -- the default for every existing caller and test.
   */
  readonly permissionsDeny?: DenyList;
}

/**
 * Build the panel's primary {@link ToolRegistry}. Extracted from
 * NexusCodingPanel as part of v0.7.0 Phase 0 sub-task 0.4 so the panel no
 * longer hosts the per-tool registration list. Tool authorship continues to
 * follow the AGENTS.md Module Authorship Contract; this helper only
 * centralises the wiring.
 */
export function buildToolRegistry(opts: ToolRegistryBuildOptions): ToolRegistry {
  const { gate, editMode, secretPathDenyExtra, permissionOverrides } = opts;
  const registry = new ToolRegistry();
  // v1.12.0 Phase 5 (H3): the built-in secret-path denylist gates run_terminal
  // too; extend it with the operator's extra patterns, matching the file tools.
  registry.setSecretPathDenyExtra(secretPathDenyExtra);

  // Tier `auto-approve` -- eager. The prompt builder filters the catalog
  // against these on every turn so deferring would force a synchronous
  // catalog wait.
  registry.register(
    "read_file",
    new ReadFileTool(gate, secretPathDenyExtra, opts.toolOutputCache),
  );
  registry.register("list_directory", new ListDirectoryTool(gate, secretPathDenyExtra));
  registry.register("grep_codebase", new GrepCodebaseTool(gate, secretPathDenyExtra));

  // Tier `confirm` -- lazy. write/edit/create/delete tools only fire on a
  // user-confirmed edit, so importing them at boot is wasted work for the
  // common read-only first-turn case.
  registry.registerLazy("write_file", async () => {
    const mod = await import("./handlers/filesystem.js");
    return new mod.WriteFileTool(gate, editMode);
  });
  registry.registerLazy("create_file", async () => {
    const mod = await import("./handlers/filesystem.js");
    return new mod.CreateFileTool(gate, editMode);
  });
  registry.registerLazy("edit_file", async () => {
    const mod = await import("./handlers/filesystem.js");
    return new mod.EditFileTool(gate, editMode);
  });
  registry.registerLazy("delete_file", async () => {
    const mod = await import("./handlers/filesystem.js");
    return new mod.DeleteFileTool();
  });

  // Tier `dangerous` -- lazy. run_terminal pulls in child_process; web_*
  // pull in fetch + node-fetch shim; none are needed on a read-only turn.
  registry.registerLazy("run_terminal", async () => {
    const mod = await import("./handlers/terminal.js");
    return new mod.RunTerminalTool();
  });
  registry.registerLazy("web_search", async () => {
    const mod = await import("./handlers/webSearch.js");
    return new mod.WebSearchTool(opts.webResponseCache);
  });
  registry.registerLazy("fetch_page", async () => {
    const mod = await import("./handlers/webSearch.js");
    return new mod.FetchPageTool();
  });

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

  if (opts.codegraph) {
    const deps = opts.codegraph;
    // Tier `auto-approve`: codegraph tools are read-only over a local SQLite
    // file and never touch the network or the working tree.
    registry.registerLazy("codegraph_search", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphSearchTool(deps);
    });
    registry.registerLazy("codegraph_context", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphContextTool(deps);
    });
    registry.registerLazy("codegraph_trace", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphTraceTool(deps);
    });
    registry.registerLazy("codegraph_callers", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphCallersTool(deps);
    });
    registry.registerLazy("codegraph_callees", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphCalleesTool(deps);
    });
    registry.registerLazy("codegraph_impact", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphImpactTool(deps);
    });
    registry.registerLazy("codegraph_node", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphNodeTool(deps);
    });
    registry.registerLazy("codegraph_explore", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphExploreTool(deps);
    });
    registry.registerLazy("codegraph_files", async () => {
      const mod = await import("./handlers/codegraph.js");
      return new mod.CodeGraphFilesTool(deps);
    });
  }

  if (opts.lsp) {
    const lspDeps = opts.lsp;
    // Tier `auto-approve`: LSP tools are read-only (definition / references
    // queries); they never touch the working tree or the network beyond
    // the localhost stdio channel to the language server. Lazy import so
    // the JSON-RPC framing layer + child-process wiring stay out of the
    // boot path for sessions that never invoke an LSP tool.
    registry.registerLazy("lsp_definition", async () => {
      const mod = await import("./handlers/lsp.js");
      return new mod.LspDefinitionTool(lspDeps);
    });
    registry.registerLazy("lsp_references", async () => {
      const mod = await import("./handlers/lsp.js");
      return new mod.LspReferencesTool(lspDeps);
    });
  }

  registry.setConfirmationGate(gate, permissionOverrides, editMode);

  // v1.4.0 Phase 8 (gap 5.3.P2.R): install the operator `.nexus/permissions.deny`
  // denylist when provided. No-op when omitted.
  if (opts.permissionsDeny) {
    registry.setPermissionsDeny(opts.permissionsDeny);
  }

  return registry;
}

/**
 * v0.9.0 Phase 6.6 (from v0.8.0 known-gaps 10.O.Q) -- list the tool names
 * that {@link buildToolRegistry} attaches via `registerLazy`. Tests
 * verifying boot-time import counts consult this list so the assertion is
 * decoupled from the wiring details.
 */
export function listLazyToolNames(): readonly string[] {
  return [
    "write_file",
    "create_file",
    "edit_file",
    "delete_file",
    "run_terminal",
    "web_search",
    "fetch_page",
  ];
}

/**
 * v0.9.0 Phase 6.6 -- the list of tool names that stay eager. Together with
 * {@link listLazyToolNames} this exposes the wiring decision for tests.
 */
export function listEagerToolNames(): readonly string[] {
  return [
    "read_file",
    "list_directory",
    "grep_codebase",
    // compress_range / compress_message / update_todos are wired only when
    // the optional `compress` / `todos` options are passed; they are still
    // imported eagerly when present because the prompt builder needs them.
  ];
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
