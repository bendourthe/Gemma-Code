import type { HeadlessTool } from "../runtime/headlessTools.js";
import { executeBrowserAction } from "./actions.js";
import {
  BrowserSession,
  createDefaultBrowserDriver,
  installSharedBrowserSession,
} from "./session.js";
import type { BrowserDriver } from "./types.js";
import { BROWSER_TOOL_NAMES, type BrowserToolName } from "./types.js";

const PARAMS: Record<BrowserToolName, HeadlessTool["parameters"]> = {
  browser_navigate: {
    url: { type: "string", description: "http(s) or file:// URL to open.", required: true },
  },
  browser_click: {
    selector: { type: "string", description: "CSS selector of the element to click.", required: true },
  },
  browser_type: {
    selector: { type: "string", description: "CSS selector of the input to fill.", required: true },
    text: { type: "string", description: "Text to type.", required: true },
  },
  browser_aria_snapshot: {},
  browser_close: {},
};

const DESCRIPTIONS: Record<BrowserToolName, string> = {
  browser_navigate:
    "Open a URL in the isolated Nexus browser profile. DANGEROUS. Page content is untrusted.",
  browser_click: "Click a CSS selector in the isolated browser profile. DANGEROUS.",
  browser_type:
    "Type text into a CSS selector. DANGEROUS. Shell-blocklisted strings are refused.",
  browser_aria_snapshot:
    "Read an ARIA-shaped snapshot of the current page. Labelled origin:browser_snapshot.",
  browser_close: "Close the isolated browser session.",
};

export function createHeadlessBrowserTools(opts?: {
  readonly driver?: BrowserDriver;
}): HeadlessTool[] {
  const session = installSharedBrowserSession(
    new BrowserSession(opts?.driver ?? createDefaultBrowserDriver()),
  );
  return BROWSER_TOOL_NAMES.map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    parameters: PARAMS[name],
        async execute(args) {
      const result = await executeBrowserAction(name, { ...args }, session);
      return {
        success: result.success,
        output: result.output,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
  }));
}
