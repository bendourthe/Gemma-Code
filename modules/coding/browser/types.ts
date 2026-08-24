/**
 * v2.0.0 Phase 2 -- vscode-free browser session types.
 *
 * Handlers in `src/tools/` and the headless sidecar both drive this surface.
 * Playwright is an optional local library; tests inject {@link InMemoryBrowser}.
 */

export const BROWSER_TOOL_NAMES = [
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_aria_snapshot",
  "browser_close",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

/** Pinned Playwright major.minor for operators who install the optional library. */
export const PLAYWRIGHT_PINNED_VERSION = "1.55.0";

export const PLAYWRIGHT_MISSING_MESSAGE =
  `Playwright is not installed. The coding agent browser tools need a local ` +
  `Chromium, not a cloud browser. Install the pinned library and browser: ` +
  `npx playwright@${PLAYWRIGHT_PINNED_VERSION} install chromium`;

export interface BrowserPageState {
  readonly url: string;
  readonly title: string;
  readonly html: string;
}

export interface BrowserDriver {
  readonly userDataDir: string;
  navigate(url: string): Promise<BrowserPageState>;
  click(selector: string): Promise<BrowserPageState>;
  type(selector: string, text: string): Promise<BrowserPageState>;
  snapshot(): Promise<BrowserPageState>;
  close(): Promise<void>;
}
