import { getLogger } from "../utils/logger.js";

export type BuiltinCommandName =
  | "help"
  | "clear"
  | "history"
  | "plan"
  | "compact"
  | "model"
  | "memory"
  | "mcp"
  | "verify"
  | "research"
  | "cache"
  | "operation-log"
  | "trace"
  | "thinking-mode"
  | "harness"
  | "skill-metrics"
  | "curate";

export interface CommandDescriptor {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface BuiltinCommand {
  type: "builtin";
  name: BuiltinCommandName;
  args: string;
}

export interface SkillCommand {
  type: "skill";
  name: string;
  args: string;
}

/**
 * v1.5.0 Phase 7 (HUB.P3.CMD): a command sourced from the Nexus-Hub
 * `catalog/commands` catalog. Resolved + injected like a skill prompt.
 */
export interface HubCommand {
  type: "hub-command";
  name: string;
  args: string;
}

export type Command = BuiltinCommand | SkillCommand | HubCommand;

const BUILTIN_DESCRIPTORS: CommandDescriptor[] = [
  { name: "help", description: "Show all available commands and skills", argumentHint: "[command]" },
  { name: "clear", description: "Clear the current conversation" },
  { name: "history", description: "Browse past chat sessions" },
  { name: "plan", description: "Toggle plan mode on/off" },
  { name: "compact", description: "Compact the conversation context" },
  { name: "model", description: "Switch the active Ollama model", argumentHint: "[model name]" },
  { name: "memory", description: "Manage persistent memory (search, save, clear, status, lint, init, archive, edit, forget, export, import)", argumentHint: "<search|save|clear|status|lint|init|archive|edit|forget|export|import> [args]" },
  { name: "mcp", description: "Manage MCP connections (status, connect, disconnect)", argumentHint: "<status|connect|disconnect> [name]" },
  { name: "verify", description: "Manually trigger verification of recent changes" },
  { name: "research", description: "Spawn a research sub-agent to gather information", argumentHint: "<query>" },
  { name: "cache", description: "Manage the persistent tool-output cache (status, clear, prune, reembed)", argumentHint: "<status|clear|prune|reembed>" },
  { name: "operation-log", description: "Manage the opt-in append-only operation log (status, clear)", argumentHint: "<status|clear>" },
  { name: "trace", description: "Single bug-report trace file primitive (enable, dump, clear, status)", argumentHint: "<enable|dump|clear|status> [path]" },
  { name: "thinking-mode", description: "Switch sampler-preset / thinking mode for the active model", argumentHint: "<nothink|think|think-max>" },
  { name: "harness", description: "Inspect or switch the session harness scaffold profile", argumentHint: "[inspect|list|clear|<profile>]" },
  { name: "skill-metrics", description: "Show per-skill rolling 30-day invocation metrics", argumentHint: "[skill-name]" },
  { name: "curate", description: "Dual-loop curator: dry-run, apply a manifest, or roll back", argumentHint: "<--dry-run|--apply <id>|--rollback <id>|--status>" },
];

const BUILTIN_NAMES = new Set<string>(BUILTIN_DESCRIPTORS.map((d) => d.name));

export class CommandRouter {
  /**
   * @param _skillDescriptors A function that returns the current list of skill descriptors.
   *        Using a function allows the router to reflect hot-loaded skills without re-instantiation.
   */
  /**
   * @param _skillDescriptors current skill descriptors (function so hot-loaded
   *        skills are reflected without re-instantiation).
   * @param _hubCommandDescriptors v1.5.0 Phase 7 (HUB.P3.CMD): optional
   *        Nexus-Hub command descriptors. Built-ins and skills take precedence;
   *        a Hub command only matches when its name collides with neither.
   */
  constructor(
    private readonly _skillDescriptors: () => CommandDescriptor[],
    private readonly _hubCommandDescriptors: () => CommandDescriptor[] = () => [],
  ) {}

  /**
   * Parse a user input string into a Command, or return null if the input is not
   * a slash command, or if the command name is unrecognised.
   */
  route(input: string): Command | null {
    if (!input.startsWith("/")) return null;

    const body = input.slice(1);
    const spaceIdx = body.indexOf(" ");
    const name = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1).trim();

    if (!name) return null;

    if (BUILTIN_NAMES.has(name)) {
      return { type: "builtin", name: name as BuiltinCommandName, args };
    }

    const skillNames = new Set(this._skillDescriptors().map((s) => s.name));
    if (skillNames.has(name)) {
      return { type: "skill", name, args };
    }

    // v1.5.0 Phase 7 (HUB.P3.CMD): fall through to Hub commands last, so a
    // built-in or skill of the same name always wins.
    const hubNames = new Set(this._hubCommandDescriptors().map((d) => d.name));
    if (hubNames.has(name)) {
      return { type: "hub-command", name, args };
    }

    getLogger().warn(`[CommandRouter] Unknown command: /${name}`);
    return null;
  }

  /**
   * Returns the combined list of built-in, skill, and Nexus-Hub command
   * descriptors, suitable for populating the webview autocomplete.
   */
  getAllDescriptors(): CommandDescriptor[] {
    return [...BUILTIN_DESCRIPTORS, ...this._skillDescriptors(), ...this._hubCommandDescriptors()];
  }
}
