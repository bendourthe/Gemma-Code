// Shared offline-integrity checker for Nexus's self-contained HTML artifacts.
//
// v1.6.0 Phase 1 (AS003) introduced this DOM-aware checker inline in
// tests/unit/guides/nexus-ai-guide.offline.test.ts to guard the interactive
// guide. Phase 2 (AS004) ships a second self-contained HTML artifact -- the
// standalone session/trace viewer -- which MUST satisfy the same zero-outbound
// guarantee. The checker is extracted here so both artifacts are validated by a
// single implementation rather than two drifting copies.
//
// Why DOM-aware (not a flat regex): a trace export embeds arbitrary span names
// and attribute values, which routinely contain `https://` URLs as PLAIN TEXT
// (e.g. a fetched page URL). A naive regex would false-positive on those and on
// navigational <a href> links. This checker only flags positions the browser
// actually fetches on load (src, <link href>, srcset, poster, object[data], CSS
// url()/@import), so plain-text URLs, data: URIs, anchor hrefs, and local SVG
// paint fragments are correctly ignored.

import { parse, HTMLElement } from "node-html-parser";

// http://, https://, or protocol-relative // -- anything that resolves to an
// origin the browser would fetch on load. `data:` URIs are inline and never
// fetched, so they are explicitly allowed.
const REMOTE = /^(?:https?:)?\/\//i;

export function isRemoteAssetUrl(url: string): boolean {
  const v = url.trim();
  if (v === "" || v.startsWith("data:")) return false;
  return REMOTE.test(v);
}

// Attributes that cause the browser to fetch a resource on page load, keyed by
// the tag they apply to. `href` is asset-loading ONLY on <link> -- on <a> and
// <area> it is navigational (followed on click, never fetched on load).
const ASSET_ATTRS: ReadonlyArray<{ tags: string[]; attr: string }> = [
  { tags: ["script", "img", "iframe", "embed", "audio", "video", "source", "track", "input"], attr: "src" },
  { tags: ["link"], attr: "href" },
  { tags: ["img", "source"], attr: "srcset" },
  { tags: ["video"], attr: "poster" },
  { tags: ["object"], attr: "data" },
];

// CSS url(...) reference, e.g. background:url(https://cdn/x.png) or an
// @font-face src. SVG paint refs like url(#nx-grad) are local fragments and
// never match the remote pattern.
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
// A bare @import without url(), e.g. @import "https://cdn/x.css".
const CSS_IMPORT = /@import\s+(['"])([^'"]+)\1/gi;

/**
 * Returns every remote (network-fetched-on-load) asset reference found in the
 * given HTML. An empty array means the document is offline-self-contained.
 */
export function findRemoteAssetRefs(html: string): string[] {
  const root = parse(html, { comment: false });
  const offenders: string[] = [];

  const elements = root.querySelectorAll("*") as HTMLElement[];
  for (const el of elements) {
    const tag = (el.rawTagName || "").toLowerCase();

    for (const { tags, attr } of ASSET_ATTRS) {
      if (!tags.includes(tag)) continue;
      const value = el.getAttribute(attr);
      if (!value) continue;
      if (attr === "srcset") {
        // srcset is a comma-separated list of "<url> [descriptor]" candidates.
        for (const candidate of value.split(",")) {
          const url = candidate.trim().split(/\s+/)[0] ?? "";
          if (isRemoteAssetUrl(url)) offenders.push(`${tag}[srcset]=${url}`);
        }
      } else if (isRemoteAssetUrl(value)) {
        offenders.push(`${tag}[${attr}]=${value}`);
      }
    }

    // Inline style="..." attribute (url() / @import).
    const inlineStyle = el.getAttribute("style");
    if (inlineStyle) offenders.push(...findRemoteCssRefs(inlineStyle, `${tag}[style]`));
  }

  // <style> element bodies.
  const styles = root.querySelectorAll("style") as HTMLElement[];
  for (const styleEl of styles) {
    offenders.push(...findRemoteCssRefs(styleEl.innerHTML, "style"));
  }

  return offenders;
}

export function findRemoteCssRefs(css: string, label: string): string[] {
  const offenders: string[] = [];
  for (const m of css.matchAll(CSS_URL)) {
    if (isRemoteAssetUrl(m[2])) offenders.push(`${label} url(${m[2]})`);
  }
  for (const m of css.matchAll(CSS_IMPORT)) {
    if (isRemoteAssetUrl(m[2])) offenders.push(`${label} @import ${m[2]}`);
  }
  return offenders;
}
