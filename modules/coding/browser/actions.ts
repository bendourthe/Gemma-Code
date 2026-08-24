import { isBlocked } from "../../../src/tools/commandBlocklist.js";
import { htmlToAriaSnapshot, screenSnapshot } from "./snapshot.js";
import type { BrowserSession } from "./session.js";
import type { BrowserToolName } from "./types.js";

export interface BrowserActionResult {
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
}

function requireString(params: Record<string, unknown>, key: string): string | BrowserActionResult {
  const value = params[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      success: false,
      output: "",
      error: `Missing required parameter: ${key}.`,
    };
  }
  return value;
}

function labelledSnapshot(sessionUrl: string, title: string, html: string): string {
  return screenSnapshot(htmlToAriaSnapshot(html, sessionUrl, title));
}

/**
 * Shared execute path for VS Code handlers and headless tools.
 * Snapshots are secret-redacted and injection-scanned before return.
 */
export async function executeBrowserAction(
  tool: BrowserToolName,
  params: Record<string, unknown>,
  session: BrowserSession,
): Promise<BrowserActionResult> {
  try {
    switch (tool) {
      case "browser_navigate": {
        const url = requireString(params, "url");
        if (typeof url !== "string") return url;
        const state = await session.navigate(url);
        return {
          success: true,
          output: labelledSnapshot(state.url, state.title, state.html),
        };
      }
      case "browser_click": {
        const selector = requireString(params, "selector");
        if (typeof selector !== "string") return selector;
        const state = await session.click(selector);
        return {
          success: true,
          output: labelledSnapshot(state.url, state.title, state.html),
        };
      }
      case "browser_type": {
        const selector = requireString(params, "selector");
        if (typeof selector !== "string") return selector;
        const text = requireString(params, "text");
        if (typeof text !== "string") return text;
        if (isBlocked(text)) {
          return {
            success: false,
            output: "",
            error:
              "Refusing to type a string that matches the shell hard-denial blocklist. " +
              "Page content cannot bypass run_terminal denials via browser_type.",
          };
        }
        const state = await session.type(selector, text);
        return {
          success: true,
          output: labelledSnapshot(state.url, state.title, state.html),
        };
      }
      case "browser_aria_snapshot": {
        const state = await session.snapshot();
        return {
          success: true,
          output: labelledSnapshot(state.url, state.title, state.html),
        };
      }
      case "browser_close": {
        await session.close();
        return { success: true, output: "Browser session closed." };
      }
      default: {
        return { success: false, output: "", error: `Unknown browser tool: ${tool}` };
      }
    }
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
