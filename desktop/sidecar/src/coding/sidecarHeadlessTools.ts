/**
 * v1.20.0 Phase 1 (A1) -- sidecar composition of the headless tool set.
 *
 * Every production `createHeadlessTools` call on the sidecar (ACP, scheduler,
 * coding-session runner) goes through here so `parse_document` is registered
 * only when the flag is on, and so a supplied parser is ignored when the flag
 * is off (flag wins over presence).
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createHeadlessOcrParser } from "../../../../core/documents/headlessOcrParser.js";
import {
  PARSE_DOCUMENT_SETTING_KEY,
  isParseDocumentEnabled,
} from "../../../../core/documents/parseDocumentEnabled.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import {
  evaluateDeny,
  parsePermissionsDeny,
} from "../../../../core/storage/PermissionsDeny.js";
import type { HeadlessConfirmFn } from "../../../../modules/coding/runtime/headlessGuards.js";
import {
  createHeadlessTools,
  type HeadlessDocumentParser,
  type HeadlessExec,
  type HeadlessTool,
  type HeadlessToolResult,
} from "../../../../modules/coding/runtime/headlessTools.js";
import { getSharedOcrRuntime } from "../ocr/sharedRuntime.js";

const sidecarDocumentMemory: string[] = [];

export function readSidecarDocumentMemory(): readonly string[] {
  return sidecarDocumentMemory;
}

export function clearSidecarDocumentMemory(): void {
  sidecarDocumentMemory.length = 0;
}

export interface SidecarHeadlessToolsOptions {
  readonly confirm?: HeadlessConfirmFn;
  /**
   * Explicit flag. When omitted, env `NEXUS_PARSE_DOCUMENT` then
   * `~/.nexus/settings.json` are consulted; default false.
   */
  readonly parseDocumentEnabled?: boolean;
  /** Injected parser (tests). Production builds one from the shared OCR bundle. */
  readonly documentParser?: HeadlessDocumentParser;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected settings boolean (tests). Skips the settings.json read. */
  readonly settingsValue?: boolean;
  readonly exec?: HeadlessExec;
  readonly byteCap?: number;
  readonly execSandbox?: boolean;
  readonly ingestToMemory?: (input: {
    text: string;
    sourcePath: string;
    engine: string;
    workspaceId?: string;
  }) => Promise<{ stored: boolean; reason?: string }>;
}

function readParseDocumentSettingFromDisk(): boolean | undefined {
  // Vitest must not pick up a developer `~/.nexus/settings.json` opt-in.
  if (process.env.VITEST === "true") return undefined;
  const filePath = join(nexusHome(), "settings.json");
  if (!existsSync(filePath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const value = data[PARSE_DOCUMENT_SETTING_KEY];
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSidecarParseDocumentEnabled(
  opts: Pick<SidecarHeadlessToolsOptions, "parseDocumentEnabled" | "env" | "settingsValue"> = {},
): boolean {
  if (typeof opts.parseDocumentEnabled === "boolean") return opts.parseDocumentEnabled;
  const settingsValue =
    typeof opts.settingsValue === "boolean" ? opts.settingsValue : readParseDocumentSettingFromDisk();
  return isParseDocumentEnabled({ env: opts.env, settingsValue });
}

function resolveParser(
  enabled: boolean,
  injected: HeadlessDocumentParser | undefined,
): HeadlessDocumentParser | undefined {
  if (!enabled) return undefined;
  if (injected) return injected;
  return createHeadlessOcrParser(getSharedOcrRuntime().parser);
}

function malformedDenyLine(content: string): number | null {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0 || !line.slice(colon + 1).trim()) return index + 1;
  }
  return null;
}

function denySubjects(args: Readonly<Record<string, unknown>>): readonly string[] {
  const preferred = ["command", "path", "sourcePath", "destinationPath", "url"];
  const subjects: string[] = [];
  for (const key of preferred) {
    const value = args[key];
    if (typeof value === "string") subjects.push(value);
  }
  for (const value of Object.values(args)) {
    if ((typeof value === "string" || typeof value === "number") && !subjects.includes(String(value))) {
      subjects.push(String(value));
    }
  }
  subjects.push(JSON.stringify(args));
  return subjects;
}

function permissionsDenied(message: string): HeadlessToolResult {
  return { success: false, output: message, error: message };
}

function withWorkspacePermissionsDeny(tools: readonly HeadlessTool[]): HeadlessTool[] {
  return tools.map((tool) => ({
    ...tool,
    async execute(args, ctx) {
      const roots = ctx.workspaceRoots?.length ? ctx.workspaceRoots : [ctx.workdir];
      for (const root of roots) {
        const denyPath = join(root, ".nexus", "permissions.deny");
        let content: string;
        try {
          content = await readFile(denyPath, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            continue;
          }
          return permissionsDenied(
            `Tool ${tool.name} denied: could not read .nexus/permissions.deny in root "${root}".`,
          );
        }

        const malformedLine = malformedDenyLine(content);
        if (malformedLine !== null) {
          return permissionsDenied(
            `Tool ${tool.name} denied: malformed .nexus/permissions.deny line ${malformedLine} in root "${root}".`,
          );
        }

        const denyList = parsePermissionsDeny(content);
        for (const subject of denySubjects(args)) {
          const evaluation = evaluateDeny(tool.name, subject, denyList);
          if (evaluation.denied) {
            return permissionsDenied(
              `Tool ${tool.name} denied by .nexus/permissions.deny line ${evaluation.rule?.line ?? "unknown"} in root "${root}".`,
            );
          }
        }
      }
      return tool.execute(args, ctx);
    },
  }));
}

/**
 * Build the sidecar's headless tool list. Flag off => `parse_document` absent
 * even if a parser object exists.
 */
export function createSidecarHeadlessTools(
  options: SidecarHeadlessToolsOptions = {},
): HeadlessTool[] {
  const enabled = resolveSidecarParseDocumentEnabled(options);
  const documentParser = resolveParser(enabled, options.documentParser);
  const ingestToMemory =
    options.ingestToMemory ??
    (async (input: { text: string; sourcePath: string; engine: string; workspaceId?: string }) => {
      sidecarDocumentMemory.push(
        `[ocr workspace=${input.workspaceId ?? "legacy"} engine=${input.engine} path=${input.sourcePath}]\n${input.text}`,
      );
      return { stored: true };
    });
  const tools = createHeadlessTools({
    ...(options.confirm ? { guards: { confirm: options.confirm } } : {}),
    ...(options.exec ? { exec: options.exec } : {}),
    ...(options.byteCap !== undefined ? { byteCap: options.byteCap } : {}),
    ...(options.execSandbox !== undefined ? { execSandbox: options.execSandbox } : {}),
    documentParser,
    parseDocumentEnabled: enabled,
    browserEnabled: true,
    ingestToMemory,
  });
  return withWorkspacePermissionsDeny(tools);
}
