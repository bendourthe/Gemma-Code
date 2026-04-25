// Privacy note: DuckDuckGo does not track users, which aligns with Gemma Code's
// privacy-first goal. No API key is required for the HTML endpoint.

import { parse as parseHtml } from "node-html-parser";
import { formatForUser } from "../../utils/errors.js";
import type {
  ToolHandler,
  ToolResult,
  WebSearchParams,
  FetchPageParams,
} from "../types.js";
import { fetchWithSsrfGuard } from "../../utils/ssrf.js";

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 2_000;
const MAX_SNIPPET_CHARS = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function failResult(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

export class WebSearchTool implements ToolHandler {
  private _requestTimestamps: number[] = [];

  /** Reset per-session rate-limit counter. Called by session boundary wiring. */
  resetSession(): void {
    this._requestTimestamps = [];
  }

  /** Returns remaining-seconds until next request slot opens, or 0 if under limit. */
  private _rateLimitWait(nowMs: number): number {
    const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
    this._requestTimestamps = this._requestTimestamps.filter((t) => t >= cutoff);
    if (this._requestTimestamps.length < RATE_LIMIT_MAX_REQUESTS) return 0;
    const first = this._requestTimestamps[0]!;
    return Math.max(0, Math.ceil((first + RATE_LIMIT_WINDOW_MS - nowMs) / 1000));
  }

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as WebSearchParams;

    if (!p.query || typeof p.query !== "string") {
      return failResult(id, "Missing required parameter: query");
    }

    const now = Date.now();
    const wait = this._rateLimitWait(now);
    if (wait > 0) {
      return failResult(
        id,
        `Rate limit exceeded (${RATE_LIMIT_MAX_REQUESTS} searches per minute). Retry in ${wait}s.`,
      );
    }
    this._requestTimestamps.push(now);

    const maxResults =
      typeof p.max_results === "number" ? Math.min(p.max_results, 10) : MAX_RESULTS;

    const searchUrl =
      `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(p.query)}&kl=us-en`;

    let html: string;
    try {
      const response = await fetchWithSsrfGuard(searchUrl, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: {
          // Mimic a browser so DuckDuckGo returns proper HTML results.
          "User-Agent":
            "Mozilla/5.0 (compatible; GemmaCode/0.1; +https://github.com/gemma-code)",
          Accept: "text/html",
        },
      });
      if (!response.ok) {
        return failResult(id, `DuckDuckGo returned HTTP ${response.status}`);
      }
      html = await response.text();
    } catch (err) {
      return failResult(id, `Network error: ${formatForUser(err)}`);
    }

    const results: SearchResult[] = [];
    try {
      const root = parseHtml(html);
      const resultNodes = root.querySelectorAll(".result");

      for (const node of resultNodes.slice(0, maxResults)) {
        const titleEl = node.querySelector(".result__title");
        const snippetEl = node.querySelector(".result__snippet");
        const linkEl = node.querySelector(".result__url");

        const title = truncate(stripHtmlTags(titleEl ? titleEl.text : ""), MAX_SNIPPET_CHARS);
        const snippet = truncate(stripHtmlTags(snippetEl ? snippetEl.text : ""), MAX_SNIPPET_CHARS);
        const url = linkEl ? linkEl.text.trim() : "";

        if (title) {
          results.push({ title, url, snippet });
        }
      }
    } catch (err) {
      return failResult(id, `Failed to parse search results: ${String(err)}`);
    }

    return {
      id,
      success: true,
      output: JSON.stringify({ results, count: results.length }),
    };
  }
}

// ---------------------------------------------------------------------------
// FetchPageTool
// ---------------------------------------------------------------------------

export class FetchPageTool implements ToolHandler {
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as FetchPageParams;

    if (!p.url || typeof p.url !== "string") {
      return failResult(id, "Missing required parameter: url");
    }

    let html: string;
    try {
      const response = await fetchWithSsrfGuard(p.url, { timeoutMs: FETCH_TIMEOUT_MS });
      if (!response.ok) {
        return failResult(id, `HTTP ${response.status} fetching "${p.url}"`);
      }
      html = await response.text();
    } catch (err) {
      const msg = formatForUser(err);
      if (msg.includes("blocked by SSRF check")) {
        return failResult(
          id,
          `URL is not allowed: "${p.url}". Only public HTTP/HTTPS URLs are permitted.`,
        );
      }
      return failResult(id, `Network error: ${msg}`);
    }

    let text = stripHtmlTags(html);
    let truncated = false;

    if (text.length > MAX_PAGE_CHARS) {
      text = text.slice(0, MAX_PAGE_CHARS) + "... (truncated)";
      truncated = true;
    }

    return {
      id,
      success: true,
      output: JSON.stringify({ text, truncated }),
    };
  }
}
