import { assertIsolatedProfileDir, resolveIsolatedProfileDir } from "./profile.js";
import {
  PLAYWRIGHT_MISSING_MESSAGE,
  PLAYWRIGHT_PINNED_VERSION,
  type BrowserDriver,
  type BrowserPageState,
} from "./types.js";
import { assertNavigableUrl } from "./urlGuard.js";

interface PlaywrightPage {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, text: string): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  title(): Promise<string>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightLike {
  chromium: {
    launchPersistentContext(
      userDataDir: string,
      options: Record<string, unknown>,
    ): Promise<PlaywrightContext>;
  };
}

export type PlaywrightLoader = () => Promise<PlaywrightLike>;

async function defaultLoadPlaywright(): Promise<PlaywrightLike> {
  const specifier = "playwright";
  try {
    // Optional peer: not in package.json. Dynamic specifier so tsc does not
    // require @types/playwright. CI never installs Chromium.
    const dynamicImport = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<PlaywrightLike>;
    return await dynamicImport(specifier);
  } catch {
    throw new Error(PLAYWRIGHT_MISSING_MESSAGE);
  }
}

/**
 * Optional live Chromium driver. Playwright is not a package.json dependency;
 * CI never downloads a browser. Operators pin {@link PLAYWRIGHT_PINNED_VERSION}.
 */
export class PlaywrightBrowser implements BrowserDriver {
  readonly userDataDir: string;
  private readonly _load: PlaywrightLoader;
  private _context: PlaywrightContext | null = null;
  private _page: PlaywrightPage | null = null;
  private _closed = false;

  constructor(opts?: { readonly homeDirFn?: () => string; readonly load?: PlaywrightLoader; readonly sessionId?: string }) {
    this.userDataDir = assertIsolatedProfileDir(
      resolveIsolatedProfileDir(opts?.sessionId ?? "default", opts?.homeDirFn),
      opts?.homeDirFn,
    );
    this._load = opts?.load ?? defaultLoadPlaywright;
  }

  async navigate(url: string): Promise<BrowserPageState> {
    const checked = assertNavigableUrl(url);
    if (!checked.ok) throw new Error(checked.error);
    const page = await this._ensurePage();
    await page.goto(checked.url.href, { waitUntil: "domcontentloaded" });
    return this._state(page);
  }

  async click(selector: string): Promise<BrowserPageState> {
    const page = await this._requirePage();
    await page.click(selector);
    return this._state(page);
  }

  async type(selector: string, text: string): Promise<BrowserPageState> {
    const page = await this._requirePage();
    await page.fill(selector, text);
    return this._state(page);
  }

  async snapshot(): Promise<BrowserPageState> {
    const page = await this._requirePage();
    return this._state(page);
  }

  async close(): Promise<void> {
    this._closed = true;
    const ctx = this._context;
    this._context = null;
    this._page = null;
    if (ctx) await ctx.close();
  }

  private async _ensurePage(): Promise<PlaywrightPage> {
    if (this._closed) {
      this._closed = false;
    }
    if (this._page) return this._page;
    const pw = await this._load();
    this._context = await pw.chromium.launchPersistentContext(this.userDataDir, {
      headless: true,
      args: ["--disable-extensions", "--no-first-run"],
    });
    this._page = await this._context.newPage();
    return this._page;
  }

  private async _requirePage(): Promise<PlaywrightPage> {
    if (!this._page) {
      throw new Error("No browser page is open. Call browser_navigate first.");
    }
    return this._page;
  }

  private async _state(page: PlaywrightPage): Promise<BrowserPageState> {
    return {
      url: page.url(),
      title: await page.title(),
      html: await page.content(),
    };
  }
}

export { PLAYWRIGHT_PINNED_VERSION };
