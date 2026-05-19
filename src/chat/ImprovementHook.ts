/**
 * v0.8.0 Phase 3.4 -- User-editable improvement-hook files (item B7).
 *
 * The user can plant a markdown file under `~/.nexus/hooks/<name>.md`
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

import { getLogger } from "../../modules/coding/utils/logger.js";
import { scan as scanForInjection, summarize as summarizeFindings } from "../guardrails/PromptInjectionScanner.js";

/**
 * v0.9.0 Phase 6.5 (from v0.8.0 known-gaps 10.O.H) -- hook-file scan options.
 *
 * `scanInjection` toggles the defensive prompt-injection scan when reading
 * a hook file. When enabled (the default in production), a hook that
 * matches an injection pattern is dropped with a warning so the model
 * never sees the indirect-prompt payload. The user can disable the scan
 * via `gemma-code.hooks.scanInjection: false` if they need to authoritatively
 * include text that overlaps with the heuristic (e.g. a security-research
 * hook intentionally containing "ignore previous instructions").
 */
export interface LoadHookOptions {
  /** When true, drop the hook on any injection-pattern match. Default: true. */
  readonly scanInjection?: boolean;
}

/** Canonical hook names recognised by the runtime. Extend as new hooks land. */
export type HookName = "enterplanmode-improve";

/** Default directory for the user-editable hook files. */
export function defaultHooksDir(): string {
  return path.join(os.homedir(), ".nexus", "hooks");
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
  options: LoadHookOptions = {},
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
  if (trimmed.length === 0) return null;
  // v0.9.0 Phase 6.5: defensive injection scan. The hook file is on disk
  // under the user's home, so the threat model is shell-rc parity, but a
  // workspace-checked-in hook (future scenario, e.g. shared dotfiles) could
  // inject prompts. The scan defaults to on; logged-and-dropped on match.
  const scanEnabled = options.scanInjection ?? true;
  if (scanEnabled) {
    const result = scanForInjection(trimmed);
    if (!result.ok) {
      getLogger().warn(
        `[ImprovementHook] dropping ${filePath} -- injection pattern(s) detected: ${summarizeFindings(result.findings)}`,
      );
      return null;
    }
  }
  return trimmed;
}

/**
 * Render the hook content as a system-message body. Adds a small heading so
 * the model can distinguish the user's overlay from the built-in addendum.
 * Returns `null` when the hook is empty.
 */
export function renderHookAsSystemMessage(
  name: HookName,
  rootDir: string = defaultHooksDir(),
  options: LoadHookOptions = {},
): string | null {
  const body = loadHook(name, rootDir, options);
  if (body === null) return null;
  const heading =
    name === "enterplanmode-improve"
      ? "## User-supplied plan-mode rules"
      : `## User-supplied hook: ${name}`;
  return `${heading}\n\n${body}`;
}
