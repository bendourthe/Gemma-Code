import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { HookBus, LifecycleEvent } from "../../../../core/lifecycle/HookBus.js";
import { PromptInjectionScanner } from "../../../../core/skills/PromptInjectionScanner.js";
import { HUB_SKILL_SCAN_ALLOWLIST } from "../../../../core/skills/hubSkillScanAllowlist.js";
import {
  catalogRoot,
  hubLayoutDir,
  type HubLayoutKey,
} from "../../../../core/storage/paths.js";
import { resolveHubLayout } from "../../../../core/storage/hubVersionManifest.js";
import type {
  HeadlessAgentEvent,
  HeadlessAgentSession,
  HeadlessRunResult,
} from "../../../../modules/coding/runtime/HeadlessAgentSession.js";

const COMMAND_NAME = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s|$)/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/;
const BUILTIN_COMMAND_NAMES = new Set([
  "plan",
  "clear",
  "commit",
  "review-pr",
  "curate",
  "trace",
  "thinking-mode",
  "harness",
  "skill-metrics",
  "memory",
  "recall",
  "remember",
  "forget",
  "memory-compress",
  "verify",
  "research",
  "help",
]);

export interface HeadlessRunEnrichment {
  readonly systemInstructions?: string;
  readonly skillBody?: string;
  readonly skillId?: string;
}

export interface HeadlessRunEnrichmentOptions {
  readonly workspacePath: string;
  readonly message: string;
  readonly baseSystemInstructions?: string;
  readonly catalogDir?: string;
  readonly scanner?: PromptInjectionScanner;
  readonly log?: (message: string) => void;
}

function logFailure(options: HeadlessRunEnrichmentOptions, message: string): void {
  try {
    (options.log ?? ((line) => process.stderr.write(`[nexus-sidecar] ${line}\n`)))(message);
  } catch {
    // Logging is diagnostic only and must never abort a coding turn.
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readWorkspaceRules(workspacePath: string): Promise<readonly string[]> {
  const ruleSections: string[] = [];
  const singleRule = await readOptionalFile(path.join(workspacePath, ".nexus", "rules.md"));
  if (singleRule?.trim()) ruleSections.push(singleRule.trim());

  const rulesDir = path.join(workspacePath, ".nexus", "rules");
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(rulesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    const body = await readOptionalFile(path.join(rulesDir, entry));
    if (body?.trim()) ruleSections.push(body.trim());
  }
  return ruleSections;
}

function commandBody(content: string): string {
  const match = FRONTMATTER.exec(content);
  return (match?.[1] ?? content).trim();
}

async function resolveCommandBody(
  options: HeadlessRunEnrichmentOptions,
): Promise<{ body: string; skillId: string } | null> {
  const commandName = COMMAND_NAME.exec(options.message.trimStart())?.[1];
  if (!commandName) return null;
  if (BUILTIN_COMMAND_NAMES.has(commandName.toLowerCase())) return null;
  const root = options.catalogDir ?? catalogRoot();
  let commandsDir: string;
  try {
    commandsDir = hubLayoutDir(
      root,
      "commands" as HubLayoutKey,
      resolveHubLayout(root),
    );
  } catch {
    commandsDir = path.join(root, "commands");
  }
  const commandPath = path.join(commandsDir, `${commandName}.md`);
  const content = await readOptionalFile(commandPath);
  if (content === null) return null;
  const body = commandBody(content);
  if (!body) return null;

  const scanner =
    options.scanner ?? new PromptInjectionScanner(undefined, HUB_SKILL_SCAN_ALLOWLIST);
  const scan = scanner.scanText(body, commandPath);
  if (scan.decision === "block") {
    logFailure(
      options,
      `skipped blocked Hub command /${commandName} (${scan.findings.length} scanner finding(s))`,
    );
    return null;
  }
  return { body, skillId: `nexus-hub/${commandName}` };
}

export async function buildHeadlessRunEnrichment(
  options: HeadlessRunEnrichmentOptions,
): Promise<HeadlessRunEnrichment> {
  const instructionSections: string[] = [];
  if (options.baseSystemInstructions?.trim()) {
    instructionSections.push(options.baseSystemInstructions.trim());
  }

  try {
    const agents = await readOptionalFile(path.join(options.workspacePath, "AGENTS.md"));
    if (agents?.trim()) instructionSections.push(`# Workspace instructions\n${agents.trim()}`);
    const rules = await readWorkspaceRules(options.workspacePath);
    if (rules.length > 0) {
      instructionSections.push(`# Workspace rules\n${rules.join("\n\n")}`);
    }
  } catch (error) {
    logFailure(
      options,
      `could not read workspace instructions: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let command: { body: string; skillId: string } | null = null;
  try {
    command = await resolveCommandBody(options);
  } catch (error) {
    logFailure(
      options,
      `could not resolve Hub command: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    ...(instructionSections.length > 0
      ? { systemInstructions: instructionSections.join("\n\n") }
      : {}),
    ...(command ? { skillBody: command.body, skillId: command.skillId } : {}),
  };
}

function emitHook(
  hookBus: HookBus | undefined,
  event: LifecycleEvent,
  log?: (message: string) => void,
): void {
  if (!hookBus) return;
  try {
    hookBus.emit(event);
  } catch (error) {
    try {
      log?.(`lifecycle hook failed: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // Hook and logger failures are both non-fatal.
    }
  }
}

export interface RunEnrichedHeadlessSessionOptions extends HeadlessRunEnrichmentOptions {
  readonly session: HeadlessAgentSession;
  readonly sessionId: string;
  readonly model: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: HeadlessAgentEvent) => void;
  readonly hookBus?: HookBus;
}

export async function runEnrichedHeadlessSession(
  options: RunEnrichedHeadlessSessionOptions,
): Promise<HeadlessRunResult> {
  const startedAt = Date.now();
  const isoTime = new Date(startedAt).toISOString();
  const enrichment = await buildHeadlessRunEnrichment(options);
  emitHook(options.hookBus, {
    kind: "lifecycle.session.start",
    sessionId: options.sessionId,
    modelId: options.model,
    isoTime,
  }, options.log);
  emitHook(options.hookBus, {
    kind: "lifecycle.user.prompt",
    sessionId: options.sessionId,
    message: options.message,
    isoTime,
  }, options.log);
  if (enrichment.skillId) {
    emitHook(options.hookBus, {
      kind: "lifecycle.skill.entry",
      sessionId: options.sessionId,
      skillId: enrichment.skillId,
      namespace: "nexus-hub",
    }, options.log);
  }

  let result: HeadlessRunResult | undefined;
  let assistantTranscript = "";
  const toolTranscript: string[] = [];
  const filesWritten = new Set<string>();
  const writeTools = new Set(["write_file", "create_file", "edit_file", "delete_file"]);
  try {
    result = await options.session.run({
      task: options.message,
      workdir: options.workspacePath,
      model: options.model,
      systemInstructions: enrichment.systemInstructions,
      skillBody: enrichment.skillBody,
      signal: options.signal,
      onEvent: (event) => {
        if (event.kind === "token") assistantTranscript += event.text;
        if (event.kind === "toolCall") {
          toolTranscript.push(`Tool call ${event.name}: ${JSON.stringify(event.args)}`);
          const writtenPath = event.args["path"];
          if (writeTools.has(event.name) && typeof writtenPath === "string") {
            filesWritten.add(writtenPath);
          }
        }
        if (event.kind === "toolResult") {
          toolTranscript.push(`Tool result ${event.name}: ${event.output}`);
        }
        options.onEvent?.(event);
      },
    });
    return result;
  } finally {
    const stoppedAt = Date.now();
    emitHook(options.hookBus, {
      kind: "lifecycle.session.end",
      sessionId: options.sessionId,
      ...(result?.finalText ? { summary: result.finalText } : {}),
    }, options.log);
    emitHook(options.hookBus, {
      kind: "lifecycle.session.stop",
      sessionId: options.sessionId,
      isoTime: new Date(stoppedAt).toISOString(),
      durationMs: Math.max(0, stoppedAt - startedAt),
    }, options.log);
    emitHook(options.hookBus, {
      kind: "lifecycle.session.reflection",
      sessionId: options.sessionId,
      isoTime: new Date(stoppedAt).toISOString(),
      transcript: [
        `User: ${options.message}`,
        ...toolTranscript,
        assistantTranscript ? `Assistant: ${assistantTranscript}` : "",
      ].filter(Boolean).join("\n"),
      filesWritten: [...filesWritten],
      modelId: options.model,
    }, options.log);
  }
}
