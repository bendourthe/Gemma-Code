/**
 * v1.20.0 Phase 1 (A1) -- sidecar composition of the headless tool set.
 *
 * Every production `createHeadlessTools` call on the sidecar (ACP, scheduler,
 * coding-session runner) goes through here so `parse_document` is registered
 * only when the flag is on, and so a supplied parser is ignored when the flag
 * is off (flag wins over presence).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createHeadlessOcrParser } from "../../../../core/documents/headlessOcrParser.js";
import {
  PARSE_DOCUMENT_SETTING_KEY,
  isParseDocumentEnabled,
} from "../../../../core/documents/parseDocumentEnabled.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import type { HeadlessConfirmFn } from "../../../../modules/coding/runtime/headlessGuards.js";
import {
  createHeadlessTools,
  type HeadlessDocumentParser,
  type HeadlessExec,
  type HeadlessTool,
} from "../../../../modules/coding/runtime/headlessTools.js";
import { getSharedOcrRuntime } from "../ocr/sharedRuntime.js";

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

/**
 * Build the sidecar's headless tool list. Flag off => `parse_document` absent
 * even if a parser object exists.
 */
export function createSidecarHeadlessTools(
  options: SidecarHeadlessToolsOptions = {},
): HeadlessTool[] {
  const enabled = resolveSidecarParseDocumentEnabled(options);
  const documentParser = resolveParser(enabled, options.documentParser);
  return createHeadlessTools({
    ...(options.confirm ? { guards: { confirm: options.confirm } } : {}),
    ...(options.exec ? { exec: options.exec } : {}),
    ...(options.byteCap !== undefined ? { byteCap: options.byteCap } : {}),
    ...(options.execSandbox !== undefined ? { execSandbox: options.execSandbox } : {}),
    documentParser,
    parseDocumentEnabled: enabled,
  });
}
