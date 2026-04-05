// Privacy note: DuckDuckGo does not track users, which aligns with Gemma Code's
// privacy-first goal. No API key is required for the HTML endpoint.

import { parse as parseHtml } from "node-html-parser";
import type {
  ToolHandler,
  ToolResult,
  WebSearchParams,
  FetchPageParams,
} from "../types.js";

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 2_000;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function failResult(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

export class WebSearchTool implements ToolHandler {
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as WebSearchParams;

    if (!p.query || typeof p.query !== "string") {
      return failResult(id, "Missing required parameter: query");
    }

    const maxResults =
      typeof p.max_results === "number" ? Math.min(p.max_results, 10) : MAX_RESULTS;

    const searchUrl =
      `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(p.query)}&kl=us-en`;

    let html: string;
    try {
      const response = await fetchWithTimeout(searchUrl, {
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
      return failResult(
        id,
        `Network error: ${err instanceof Error ? err.message : String(err)}`
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

        const title = titleEl ? titleEl.text.trim() : "";
        const snippet = snippetEl ? snippetEl.text.trim() : "";
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
      const response = await fetchWithTimeout(p.url);
      if (!response.ok) {
        return failResult(id, `HTTP ${response.status} fetching "${p.url}"`);
      }
      html = await response.text();
    } catch (err) {
      return failResult(
        id,
        `Network error: ${err instanceof Error ? err.message : String(err)}`
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
