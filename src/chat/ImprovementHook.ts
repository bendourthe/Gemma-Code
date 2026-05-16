/**
 * v0.8.0 Phase 3.4 -- User-editable improvement-hook files (item B7).
 *
 * The user can plant a markdown file under `~/.gemma-code/hooks/<name>.md`
 * to inject ambient rules into the prompt at specific lifecycle moments.
 * Phase 3.4 ships the first hook: `enterplanmode-improve.md`, read on every
 * plan-mode activation and injected as a system message after the standard
 * plan-mode addendum and the PFM reminder.
 *
 * Hooks are *additive*, not authoritative -- they cannot override the
 * built-in system prompt. They have no schema; the file body is read as-is.
 * A missing or empty file is treated as a no-op.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getLogger } from "../utils/logger.js";

/** Canonical hook names recognised by the runtime. Extend as new hooks land. */
export type HookName = "enterplanmode-improve";

/** Default directory for the user-editable hook files. */
export function defaultHooksDir(): string {
  return path.join(os.homedir(), ".gemma-code", "hooks");
}

/**
 * Compute the absolute path for a named hook file. Pure -- does not touch
 * the filesystem.
 */
export function hookFilePath(
  name: HookName,
  rootDir: string = defaultHooksDir(),
): string {
  return path.join(rootDir, `${name}.md`);
}

/**
 * Read the content of a named hook. Returns the trimmed body when the file
 * exists and is non-empty; returns `null` when missing, empty, or unreadable.
 * Read errors other than `ENOENT` are logged via {@link getLogger} so the
 * user sees the diagnostic but the plan-mode entry path keeps flowing.
 */
export function loadHook(
  name: HookName,
  rootDir: string = defaultHooksDir(),
): string | null {
  const filePath = hookFilePath(name, rootDir);
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      getLogger().warn(`[ImprovementHook] Failed to read ${filePath}:`, err);
    }
    return null;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Render the hook content as a system-message body. Adds a small heading so
 * the model can distinguish the user's overlay from the built-in addendum.
 * Returns `null` when the hook is empty.
 */
export function renderHookAsSystemMessage(
  name: HookName,
  rootDir: string = defaultHooksDir(),
): string | null {
  const body = loadHook(name, rootDir);
  if (body === null) return null;
  const heading =
    name === "enterplanmode-improve"
      ? "## User-supplied plan-mode rules"
      : `## User-supplied hook: ${name}`;
  return `${heading}\n\n${body}`;
}
