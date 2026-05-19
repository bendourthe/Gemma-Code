// Privacy note: DuckDuckGo does not track users, which aligns with Gemma Code's
// privacy-first goal. No API key is required for the HTML endpoint.

import { parse as parseHtml } from "node-html-parser";
import { formatForUser } from "../../../modules/coding/utils/errors.js";
import type {
  ToolHandler,
  ToolResult,
  WebSearchParams,
  FetchPageParams,
} from "../types.js";
import { fetchWithSsrfGuard } from "../../../modules/coding/utils/ssrf.js";
import type { WebResponseCache } from "./webCache.js";

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
  private readonly _cache: WebResponseCache | null;

  constructor(cache: WebResponseCache | null = null) {
    this._cache = cache;
  }

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
      return failResult(
        id,
        "Missing required parameter: query. " +
          "Usage: web_search(query=<search terms>, max_results=<optional 1-10>).",
      );
    }

    const now = Date.now();
    const wait = this._rateLimitWait(now);
    if (wait > 0) {
      return failResult(
        id,
        `Rate limit exceeded for parameter query: ${RATE_LIMIT_MAX_REQUESTS} searches per minute. Retry in ${wait}s. ` +
          `Usage: throttle web_search calls or use cached results.`,
      );
    }
    this._requestTimestamps.push(now);

    const maxResults =
      typeof p.max_results === "number" ? Math.min(p.max_results, 10) : MAX_RESULTS;

    const searchUrl =
      `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(p.query)}&kl=us-en`;

    if (this._cache) {
      try {
        const cached = await this._cache.lookup(searchUrl);
        if (cached) {
          return { id, success: true, output: cached.response };
        }
      } catch {
        // Cache lookup must not break the search path; fall through to fetch.
      }
    }

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
        return failResult(
          id,
          `DuckDuckGo returned HTTP ${response.status} for query "${p.query}". ` +
            `Usage: retry web_search(query=<terms>) shortly, or rephrase the query.`,
        );
      }
      html = await response.text();
    } catch (err) {
      return failResult(
        id,
        `Network error fetching search results for query "${p.query}": ${formatForUser(err)}. ` +
          `Usage: verify internet connectivity and retry web_search(query=<...>).`,
      );
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
      return failResult(
        id,
        `Failed to parse search results for query "${p.query}": ${String(err)}. ` +
          `Usage: retry web_search(query=<...>) — the upstream HTML format may have changed.`,
      );
    }

    const output = JSON.stringify({ results, count: results.length });
    if (this._cache) {
      try {
        this._cache.store(searchUrl, output, "application/json");
      } catch {
        // Cache write failures must not break the response path.
      }
    }
    return { id, success: true, output };
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
      return failResult(
        id,
        "Missing required parameter: url. " +
          "Usage: fetch_page(url=<absolute https:// URL>). " +
          "Example: fetch_page(url='https://example.com/article').",
      );
    }

    let html: string;
    try {
      const response = await fetchWithSsrfGuard(p.url, { timeoutMs: FETCH_TIMEOUT_MS });
      if (!response.ok) {
        return failResult(
          id,
          `HTTP ${response.status} fetching parameter url="${p.url}". ` +
            `Usage: fetch_page(url=<a publicly reachable URL>).`,
        );
      }
      html = await response.text();
    } catch (err) {
      const msg = formatForUser(err);
      if (msg.includes("blocked by SSRF check")) {
        return failResult(
          id,
          `URL "${p.url}" is not allowed (SSRF guard rejected the host). ` +
            `Usage: fetch_page(url=<public http:// or https:// URL>) — internal/private addresses are blocked.`,
        );
      }
      return failResult(
        id,
        `Network error fetching parameter url="${p.url}": ${msg}. ` +
          `Usage: verify connectivity and retry fetch_page(url=<...>).`,
      );
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
