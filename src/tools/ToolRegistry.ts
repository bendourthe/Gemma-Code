import type { DynamicToolMetadata } from "./ToolCatalog.js";
import type { ToolCall, ToolHandler, ToolName, ToolResult, EditMode } from "./types.js";
import type { OutputRedirector } from "./OutputRedirector.js";
import { applyByteCap, resolveMaxBytes } from "./OutputRedirector.js";
import type { ConfirmationGate } from "./ConfirmationGate.js";
import { getPermissionTier, shouldRequireConfirmation, getDangerousWarning, PermissionTier } from "../../modules/coding/guardrails/PermissionTiers.js";
import {
  introspectShellCommand,
  detectShellDialect,
  normalizeTouchedPath,
  type PathOperation,
} from "../../modules/coding/guardrails/shellIntrospection.js";
import { formatForUser } from "../../modules/coding/utils/errors.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import { matchesSecretPath } from "../../modules/coding/utils/secretPaths.js";
import { evaluateDeny, parsePermissionsDeny, type DenyList, type DenyRule } from "../../core/storage/PermissionsDeny.js";
import {
  describeSandbox,
  isExecSandboxEnabled,
} from "../../modules/coding/sandbox/index.js";
import { originForTool } from "../../modules/coding/guardrails/toolResultOrigin.js";
import { getSettings } from "../../modules/coding/config/settings.js";

// Tools that fire their own diff-bearing confirmation in `ask` mode and a
// diff-preview in `plan` mode. The centralized gate is skipped for these
// tools when the edit mode is ask/plan to avoid a double confirmation card.
const TOOLS_WITH_PER_TOOL_DIFF_CONFIRMATION: ReadonlySet<ToolName> = new Set([
  "write_file",
  "edit_file",
  "create_file",
]);

/**
 * v1.4.0 Phase 8 (gap 5.3.P2.R): the call parameter that supplies the
 * `subject` matched against a `.nexus/permissions.deny` rule, per write-capable
 * tool. `run_terminal` matches the shell command; the file-mutating tools match
 * the target path. Tools absent from this map are never deny-gated (read-only
 * tools carry no destructive subject worth denying by pattern).
 */
const DENY_SUBJECT_PARAM: Readonly<Record<string, string>> = {
  run_terminal: "command",
  write_file: "path",
  edit_file: "path",
  create_file: "path",
  delete_file: "path",
  browser_navigate: "url",
};

/**
 * v0.9.0 Phase 6.6 (from v0.8.0 known-gaps 10.O.Q) -- lazy handler factory.
 *
 * Returns a fully-constructed `ToolHandler`. The factory is invoked once on
 * first use; the resolved handler is cached for subsequent calls. The
 * factory's body is where the heavy `import()` lives, so a handler whose
 * module would otherwise be imported eagerly at boot is only loaded when
 * the tool is actually invoked. Use {@link ToolRegistry.registerLazy} to
 * wire one in.
 */
export type LazyToolFactory = () => Promise<ToolHandler> | ToolHandler;

export class ToolRegistry {
  private readonly _handlers = new Map<ToolName, ToolHandler>();
  private readonly _lazyFactories = new Map<ToolName, LazyToolFactory>();
  private readonly _enabled = new Map<ToolName, boolean>();
  private _redirector?: OutputRedirector;
  private _confirmationGate?: ConfirmationGate;
  private _permissionOverrides?: Record<string, number>;
  private _editMode: EditMode = "auto";
  private _denyList: DenyList = parsePermissionsDeny(null);
  private _secretPathDenyExtra: readonly string[] = [];

  register(name: ToolName, handler: ToolHandler): void {
    this._handlers.set(name, handler);
    this._lazyFactories.delete(name);
    if (!this._enabled.has(name)) {
      this._enabled.set(name, true);
    }
  }

  /**
   * v0.9.0 Phase 6.6 -- register a tool whose handler module should not be
   * imported until the tool is first invoked. The factory is awaited on
   * the first {@link execute} or {@link resolveLazy} call and the result
   * is cached. Marks the tool as registered + enabled for `has` /
   * `isEnabled` queries before the factory has resolved.
   */
  registerLazy(name: ToolName, factory: LazyToolFactory): void {
    this._lazyFactories.set(name, factory);
    // Do NOT seed `_handlers` -- the factory has not run yet, but `has`
    // must still report `true` so the AgentLoop's activation rules and
    // catalog filters see the tool as registered.
    if (!this._enabled.has(name)) {
      this._enabled.set(name, true);
    }
  }

  has(name: ToolName): boolean {
    return this._handlers.has(name) || this._lazyFactories.has(name);
  }

  /** Return the registered handler for a tool, or undefined if none. */
  get(name: ToolName): ToolHandler | undefined {
    return this._handlers.get(name);
  }

  /**
   * v0.9.0 Phase 6.6 -- resolve a lazy handler, importing its module if
   * needed. Returns undefined when neither an eager nor lazy registration
   * exists. Resolved handlers are cached so subsequent calls do not
   * re-run the factory.
   */
  async resolveLazy(name: ToolName): Promise<ToolHandler | undefined> {
    const eager = this._handlers.get(name);
    if (eager) return eager;
    const factory = this._lazyFactories.get(name);
    if (!factory) return undefined;
    const handler = await factory();
    this._handlers.set(name, handler);
    return handler;
  }

  /** Set the enabled state for a tool. No-op if the tool is not registered. */
  setEnabled(name: ToolName, enabled: boolean): void {
    if (this._handlers.has(name)) {
      this._enabled.set(name, enabled);
    }
  }

  /** Returns true only if the tool is registered (eager or lazy) AND enabled. */
  isEnabled(name: ToolName): boolean {
    return this.has(name) && (this._enabled.get(name) ?? false);
  }

  /** Returns names of all registered (eager or lazy) and enabled tools. */
  getEnabledNames(): ToolName[] {
    const names = new Set<ToolName>([
      ...this._handlers.keys(),
      ...this._lazyFactories.keys(),
    ]);
    return [...names].filter((n) => this._enabled.get(n) === true);
  }

  /** Filter a tool metadata catalog to only the tools that are registered and enabled. */
  getEnabledToolMetadata(catalog: readonly DynamicToolMetadata[]): DynamicToolMetadata[] {
    return catalog.filter((t) => this.isEnabled(t.name));
  }

  /**
   * Enable output redirection for large tool results. When set, execute()
   * will redirect results exceeding the character threshold to temp files.
   */
  setOutputRedirector(redirector: OutputRedirector): void {
    this._redirector = redirector;
  }

  /**
   * Set the centralized confirmation gate and permission overrides.
   * When configured, execute() checks the permission tier of each tool
   * and requests user confirmation for CONFIRM and DANGEROUS tiers.
   */
  setConfirmationGate(
    gate: ConfirmationGate,
    overrides?: Record<string, number>,
    editMode?: EditMode,
  ): void {
    this._confirmationGate = gate;
    this._permissionOverrides = overrides;
    if (editMode !== undefined) {
      this._editMode = editMode;
    }
  }

  /** Update the edit mode used to suppress duplicate confirmation prompts. */
  setEditMode(editMode: EditMode): void {
    this._editMode = editMode;
  }

  /**
   * v1.4.0 Phase 8 (gap 5.3.P2.R): install the parsed `.nexus/permissions.deny`
   * denylist. Once set, {@link execute} refuses any write-capable tool call
   * whose subject (command for `run_terminal`, path for the file tools) matches
   * a deny rule -- before the confirmation gate, so a denied call never even
   * prompts the user. The default (no rules) is a no-op, preserving behavior
   * for every caller that does not supply a denylist.
   */
  setPermissionsDeny(list: DenyList): void {
    this._denyList = list;
  }

  /**
   * v1.12.0 Phase 5 (H3): install the operator's extra secret-path patterns so
   * the built-in secret-path denylist that gates `run_terminal` (see
   * {@link _denyBySecretPath}) honors `nexus.secretPathDenyExtra`, matching the
   * file-read tools. The built-in patterns apply regardless; this only extends them.
   */
  setSecretPathDenyExtra(patterns: readonly string[]): void {
    this._secretPathDenyExtra = patterns;
  }

  /**
   * v1.7.0 Phase 5 (O-A): introspect a shell command and match each enumerated
   * touched path against the file-tool deny rules. A write path is matched as if
   * it were a `write_file` subject, a delete path as `delete_file`, a read path
   * as `read_file` (`evaluateDeny` also honors `*:` blanket rules); `cwd` changes
   * are not file operations and are skipped. Fails closed: when the command is
   * not statically parseable the fallback is logged and no path rule is applied.
   */
  private _denyByTouchedPath(command: string): {
    denied: boolean;
    rule?: DenyRule;
    path?: string;
    operation?: PathOperation;
  } {
    const introspection = introspectShellCommand(command, detectShellDialect());
    if (!introspection.parsed) {
      getLogger().debug(
        `[ToolRegistry] shell introspection fell back ` +
          `(${introspection.unsupportedReason ?? "unparseable"}); relying on the ` +
          `command-string denylist + tier gate for: ${command}`,
      );
      return { denied: false };
    }

    const OP_TO_TOOL: Readonly<Record<PathOperation, string | null>> = {
      write: "write_file",
      delete: "delete_file",
      read: "read_file",
      cwd: null,
    };
    for (const touched of introspection.paths) {
      const fileTool = OP_TO_TOOL[touched.operation];
      if (fileTool === null) continue;
      const deny = evaluateDeny(
        fileTool,
        normalizeTouchedPath(touched.raw),
        this._denyList,
      );
      if (deny.denied && deny.rule) {
        return {
          denied: true,
          rule: deny.rule,
          path: touched.raw,
          operation: touched.operation,
        };
      }
    }
    return { denied: false };
  }

  /**
   * v1.12.0 Phase 5 (H3): apply the BUILT-IN secret-path denylist to a
   * `run_terminal` command's statically-enumerated touched paths, so `cat .env`
   * (or `~/.ssh/id_rsa`, `*.pem`, `.aws/**`, ...) is refused the same way
   * `read_file(".env")` already is -- closing the tool/terminal parity gap the H3
   * exec-sandbox audit found. Unlike {@link _denyByTouchedPath} (operator
   * `.nexus/permissions.deny`, dormant by default) this uses the always-on
   * `matchesSecretPath` policy. Fail-closed: a dynamic / unparseable command
   * enumerates no paths and falls through to the DANGEROUS-tier confirmation --
   * this filters the command string, it does NOT confine the process (the
   * OS-sandbox gap is recorded as EM.P5.A).
   */
  private _denyBySecretPath(command: string): {
    denied: boolean;
    path?: string;
    operation?: PathOperation;
  } {
    const introspection = introspectShellCommand(command, detectShellDialect());
    if (!introspection.parsed) return { denied: false };
    for (const touched of introspection.paths) {
      if (touched.operation === "cwd") continue;
      if (matchesSecretPath(normalizeTouchedPath(touched.raw), this._secretPathDenyExtra)) {
        return { denied: true, path: touched.raw, operation: touched.operation };
      }
    }
    return { denied: false };
  }

  /**
   * Execute a tool call. Validates the tool exists and is enabled, delegates
   * to its handler, and wraps any thrown exception as a failure ToolResult so
   * the agent loop can continue rather than crash.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    // v0.9.0 Phase 6.6 -- resolve lazy handlers on first invocation so the
    // handler module is only loaded when the tool is actually used.
    const handler = await this.resolveLazy(call.tool);

    if (handler === undefined) {
      return {
        id: call.id,
        success: false,
        output: "",
        error:
          `Unknown tool name: "${call.tool}". ` +
          `Usage: call get_tool_schema or pick a registered tool from the catalog.`,
      };
    }

    if (!this.isEnabled(call.tool)) {
      return {
        id: call.id,
        success: false,
        output: "",
        error:
          `Tool "${call.tool}" is currently disabled. ` +
          `Usage: pick another registered tool, or ask the user to enable "${call.tool}" in settings.`,
      };
    }

    // v1.4.0 Phase 8 (gap 5.3.P2.R): operator denylist. Refuse a write-capable
    // tool call whose subject matches a `.nexus/permissions.deny` rule. Checked
    // before the confirmation gate (deny-first) and before the handler's own
    // path-guard / ALLOWED_COMMANDS checks, which still apply to anything that
    // is not denied. A no-op when no denylist has been installed.
    if (this._denyList.rules.length > 0) {
      const subjectKey = DENY_SUBJECT_PARAM[call.tool];
      const subject = subjectKey === undefined ? undefined : call.parameters[subjectKey];
      if (typeof subject === "string") {
        const deny = evaluateDeny(call.tool, subject, this._denyList);
        if (deny.denied && deny.rule) {
          return {
            id: call.id,
            success: false,
            output: "",
            error:
              `Tool "${call.tool}" is denied by .nexus/permissions.deny ` +
              `(line ${deny.rule.line}: "${deny.rule.toolName}: ${deny.rule.pattern}"). ` +
              `Usage: edit or remove the matching rule in .nexus/permissions.deny, ` +
              `or invoke ${call.tool} with a subject that does not match it.`,
          };
        }

        // v1.7.0 Phase 5 (O-A): shell-command introspection. Enumerate the paths
        // a `run_terminal` command actually touches and gate each write/delete/read
        // path against the file-tool deny rules -- so `write_file: secrets/**` now
        // also blocks `echo x > secrets/prod.env`, not just a `write_file` call.
        // Fail closed: an un-parseable command (dynamic construct, unbalanced
        // quote) skips path-gating and relies on the command-string deny above +
        // the DANGEROUS-tier confirmation below, never auto-allowing.
        if (call.tool === "run_terminal") {
          const pathDeny = this._denyByTouchedPath(subject);
          if (pathDeny.denied && pathDeny.rule) {
            return {
              id: call.id,
              success: false,
              output: "",
              error:
                `Tool "run_terminal" touches path "${pathDeny.path}" (${pathDeny.operation}), ` +
                `which is denied by .nexus/permissions.deny ` +
                `(line ${pathDeny.rule.line}: "${pathDeny.rule.toolName}: ${pathDeny.rule.pattern}"). ` +
                `Usage: edit or remove the matching rule in .nexus/permissions.deny, ` +
                `or run a command that does not touch that path.`,
            };
          }
        }
      }
    }

    // v1.12.0 Phase 5 (H3): the BUILT-IN secret-path denylist applies to
    // run_terminal too, not only the file-read tools -- closing the parity gap
    // the exec-sandbox audit found (`read_file(".env")` was blocked; `cat .env`
    // / `echo x > .env` was not). Runs AFTER the operator denylist (so an
    // operator rule keeps precedence + its specific error) and is always-on
    // (independent of any .nexus/permissions.deny). Fail-closed: a dynamic /
    // unparseable command enumerates no paths and relies on the DANGEROUS-tier
    // confirmation below. This filters the command STRING; it does NOT confine
    // the process -- the OS-sandbox gap is recorded as EM.P5.A.
    if (call.tool === "run_terminal") {
      const cmd = call.parameters["command"];
      if (typeof cmd === "string") {
        const secretDeny = this._denyBySecretPath(cmd);
        if (secretDeny.denied) {
          return {
            id: call.id,
            success: false,
            output: "",
            error:
              `Tool "run_terminal" touches secret path "${secretDeny.path}" (${secretDeny.operation}), ` +
              `which is protected by the built-in secret-path denylist (same policy as read_file). ` +
              `Usage: read the file via read_file with allow_secrets:true if you genuinely need it, ` +
              `or run a command that does not touch that path.`,
          };
        }
      }
    }

    // Centralized permission check: request user confirmation for CONFIRM/DANGEROUS tools.
    // Tools that fire their own diff-bearing confirmation in ask/plan mode are skipped
    // here so the user only sees one prompt per file edit.
    const handlesOwnConfirmation =
      TOOLS_WITH_PER_TOOL_DIFF_CONFIRMATION.has(call.tool) &&
      (this._editMode === "ask" || this._editMode === "plan");

    if (
      this._confirmationGate &&
      shouldRequireConfirmation(
        call.tool,
        this._permissionOverrides,
        getSettings().securityPosture,
      ) &&
      !handlesOwnConfirmation
    ) {
      const tier = getPermissionTier(call.tool, this._permissionOverrides);
      const warning = tier === PermissionTier.DANGEROUS
        ? getDangerousWarning(
            call.tool,
            call.parameters,
            call.tool === "run_terminal"
              ? describeSandbox({
                  enabled: isExecSandboxEnabled(getSettings().execSandbox),
                }).summary
              : undefined,
          )
        : `Tool "${call.tool}" requires confirmation.`;
      const approved = await this._confirmationGate.request(
        call.id,
        warning,
        undefined,
        call.source,
      );
      if (!approved) {
        return {
          id: call.id,
          success: false,
          output: "",
          error:
            `Tool "${call.tool}" was rejected by user (parameter: confirmation). ` +
            `Usage: re-issue ${call.tool}(...) only after the user explicitly approves.`,
        };
      }
    }

    // Resolve and validate per-call max_bytes override before invoking the handler
    // so an invalid override yields an actionable error without burning work.
    let maxBytes: number;
    try {
      maxBytes = resolveMaxBytes(call.parameters["max_bytes"]);
    } catch (err) {
      return {
        id: call.id,
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }

    try {
      const result = await handler.execute(call.parameters);
      const stamped = { ...result, origin: result.origin ?? originForTool(call.tool) };

      // Apply universal byte-cap to successful outputs so the conversation
      // transcript can never receive an oversized payload, even if downstream
      // compression or redirection is disabled.
      let bounded = stamped;
      if (result.success && result.output.length > 0) {
        const capped = applyByteCap(result.output, call.tool, maxBytes);
        if (capped.truncated) {
          bounded = { ...stamped, output: capped.output };
        }
      }

      // Redirect large successful outputs to temp files.
      if (bounded.success && this._redirector?.shouldRedirect(bounded.output)) {
        const redirected = this._redirector.redirect(call.tool, call.id, bounded.output);
        if (redirected) {
          return { ...bounded, output: redirected.summary };
        }
      }

      return bounded;
    } catch (err) {
      return {
        id: call.id,
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }
  }
}
