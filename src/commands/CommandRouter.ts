export type BuiltinCommandName =
  | "help"
  | "clear"
  | "history"
  | "plan"
  | "compact"
  | "model"
  | "memory";

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

export type Command = BuiltinCommand | SkillCommand;

const BUILTIN_DESCRIPTORS: CommandDescriptor[] = [
  { name: "help", description: "Show all available commands and skills", argumentHint: "[command]" },
  { name: "clear", description: "Clear the current conversation" },
  { name: "history", description: "Browse past chat sessions" },
  { name: "plan", description: "Toggle plan mode on/off" },
  { name: "compact", description: "Compact the conversation context" },
  { name: "model", description: "Switch the active Ollama model", argumentHint: "[model name]" },
  { name: "memory", description: "Manage persistent memory (search, save, clear, status)", argumentHint: "<search|save|clear|status> [query/content]" },
];

const BUILTIN_NAMES = new Set<string>(BUILTIN_DESCRIPTORS.map((d) => d.name));

export class CommandRouter {
  /**
   * @param _skillDescriptors A function that returns the current list of skill descriptors.
   *        Using a function allows the router to reflect hot-loaded skills without re-instantiation.
   */
  constructor(
    private readonly _skillDescriptors: () => CommandDescriptor[]
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

    console.warn(`[CommandRouter] Unknown command: /${name}`);
    return null;
  }

  /**
   * Returns the combined list of built-in and skill command descriptors,
   * suitable for populating the webview autocomplete.
   */
  getAllDescriptors(): CommandDescriptor[] {
    return [...BUILTIN_DESCRIPTORS, ...this._skillDescriptors()];
  }
}
