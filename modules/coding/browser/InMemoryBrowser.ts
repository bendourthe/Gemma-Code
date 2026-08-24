import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { assertIsolatedProfileDir, resolveIsolatedProfileDir } from "./profile.js";
import type { BrowserDriver, BrowserPageState } from "./types.js";
import { assertNavigableUrl } from "./urlGuard.js";

function fileUrlToPath(fileUrl: URL): string {
  let pathname = decodeURIComponent(fileUrl.pathname);
  if (os.platform() === "win32" && /^\/[A-Za-z]:\//.test(pathname)) {
    pathname = pathname.slice(1);
  }
  return path.normalize(pathname);
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractId(selector: string): string | null {
  const m = selector.match(/^#([A-Za-z][\w:-]*)$/);
  return m?.[1] ?? null;
}

/**
 * Deterministic HTML driver for tests and CI. No network. `http(s)` URLs are
 * refused; `file://` and `about:blank` work. Buttons may carry
 * `data-next-file` to swap the document on click (multi-page adversarial flow).
 */
export class InMemoryBrowser implements BrowserDriver {
  readonly userDataDir: string;
  private _url = "about:blank";
  private _html = "";
  private _closed = false;

  constructor(homeDirFn?: () => string, sessionId = "inmemory") {
    this.userDataDir = assertIsolatedProfileDir(
      resolveIsolatedProfileDir(sessionId, homeDirFn),
      homeDirFn,
    );
  }

  /** Test helper: load an HTML document without a file URL. */
  loadHtml(html: string, url = "about:blank"): BrowserPageState {
    this._assertOpen();
    this._html = html;
    this._url = url;
    return this._state();
  }

  async navigate(url: string): Promise<BrowserPageState> {
    this._closed = false;
    const checked = assertNavigableUrl(url);
    if (!checked.ok) throw new Error(checked.error);
    if (checked.url.protocol === "about:") {
      this._url = "about:blank";
      this._html = "";
      return this._state();
    }
    if (checked.url.protocol === "file:") {
      const filePath = fileUrlToPath(checked.url);
      this._html = fs.readFileSync(filePath, "utf8");
      this._url = checked.url.href;
      return this._state();
    }
    throw new Error(
      "InMemoryBrowser cannot fetch remote http(s) URLs. Use file:// fixtures in tests, " +
        "or install Playwright for a live Chromium session.",
    );
  }

  async click(selector: string): Promise<BrowserPageState> {
    this._assertOpen();
    const id = extractId(selector);
    if (!id) {
      throw new Error(`InMemoryBrowser only supports simple #id click selectors (got "${selector}").`);
    }
    const tagRe = new RegExp(`<([a-zA-Z]+)([^>]*\\bid=["']${id}["'][^>]*)>`, "i");
    const tag = this._html.match(tagRe);
    if (!tag) throw new Error(`No element matching ${selector}`);
    const attrs = tag[2] ?? "";
    const nextRel = attrs.match(/data-next-file=["']([^"']+)["']/i)?.[1];
    if (nextRel) {
      const current = this._url.startsWith("file:") ? fileUrlToPath(new URL(this._url)) : "";
      const nextPath = current ? path.resolve(path.dirname(current), nextRel) : nextRel;
      if (fs.existsSync(nextPath)) {
        this._html = fs.readFileSync(nextPath, "utf8");
        this._url = `file://${nextPath.replace(/\\/g, "/")}`;
      }
    }
    return this._state();
  }

  async type(selector: string, text: string): Promise<BrowserPageState> {
    this._assertOpen();
    const id = extractId(selector);
    if (!id) {
      throw new Error(`InMemoryBrowser only supports simple #id type selectors (got "${selector}").`);
    }
    if (!this._html.includes(`id="${id}"`) && !this._html.includes(`id='${id}'`)) {
      throw new Error(`No element matching ${selector}`);
    }
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    this._html += `\n<!-- typed into ${id}: ${escaped} -->`;
    return this._state();
  }

  async snapshot(): Promise<BrowserPageState> {
    this._assertOpen();
    return this._state();
  }

  async close(): Promise<void> {
    this._closed = true;
    this._html = "";
    this._url = "about:blank";
  }

  get closed(): boolean {
    return this._closed;
  }

  private _assertOpen(): void {
    if (this._closed) throw new Error("Browser session is closed. Call browser_navigate to start a new one.");
  }

  private _state(): BrowserPageState {
    return { url: this._url, title: extractTitle(this._html), html: this._html };
  }
}
