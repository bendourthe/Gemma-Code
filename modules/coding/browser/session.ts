import { InMemoryBrowser } from "./InMemoryBrowser.js";
import { PlaywrightBrowser } from "./PlaywrightBrowser.js";
import type { BrowserDriver, BrowserPageState } from "./types.js";

export interface BrowserSessionOptions {
  readonly driver?: BrowserDriver;
  readonly homeDirFn?: () => string;
  readonly sessionId?: string;
}

/**
 * Prefer InMemory under Vitest so CI never launches Chromium.
 * Production uses Playwright when the optional library is installed.
 */
export function createDefaultBrowserDriver(opts?: BrowserSessionOptions): BrowserDriver {
  if (opts?.driver) return opts.driver;
  const vitest = process.env.VITEST === "true";
  const forcePlaywright = process.env.NEXUS_BROWSER_PLAYWRIGHT === "1";
  if (vitest && !forcePlaywright) {
    return new InMemoryBrowser(opts?.homeDirFn, opts?.sessionId ?? "vitest");
  }
  return new PlaywrightBrowser({
    homeDirFn: opts?.homeDirFn,
    sessionId: opts?.sessionId,
  });
}

export class BrowserSession {
  private _driver: BrowserDriver;
  private _closed = false;

  constructor(driver: BrowserDriver) {
    this._driver = driver;
  }

  get userDataDir(): string {
    return this._driver.userDataDir;
  }

  get closed(): boolean {
    return this._closed;
  }

  async navigate(url: string): Promise<BrowserPageState> {
    this._closed = false;
    return this._driver.navigate(url);
  }

  async click(selector: string): Promise<BrowserPageState> {
    return this._driver.click(selector);
  }

  async type(selector: string, text: string): Promise<BrowserPageState> {
    return this._driver.type(selector, text);
  }

  async snapshot(): Promise<BrowserPageState> {
    return this._driver.snapshot();
  }

  async close(): Promise<void> {
    this._closed = true;
    await this._driver.close();
  }
}

let _shared: BrowserSession | null = null;

export function installSharedBrowserSession(session: BrowserSession): BrowserSession {
  _shared = session;
  return session;
}

export function getSharedBrowserSession(opts?: BrowserSessionOptions): BrowserSession {
  if (!_shared || _shared.closed) {
    _shared = new BrowserSession(createDefaultBrowserDriver(opts));
  }
  return _shared;
}

export async function closeSharedBrowserSession(): Promise<void> {
  if (!_shared) return;
  try {
    await _shared.close();
  } catch {
    // Closing a missing Chromium context must not fail the agent-loop teardown.
  }
  _shared = null;
}

/** Test-only: drop the process-wide session so the next get() rebuilds. */
export async function resetSharedBrowserSessionForTests(): Promise<void> {
  await closeSharedBrowserSession();
}
