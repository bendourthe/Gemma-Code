import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse, HTMLElement } from "node-html-parser";
// v1.6.0 Phase 2 (AS004): the DOM-aware remote-asset checker that began life
// inline here is now the shared offline-integrity helper, reused by the trace
// viewer's offline test so both self-contained HTML artifacts are guarded by
// one implementation.
import { findRemoteAssetRefs } from "../../helpers/offlineIntegrity";

// v1.6.0 Phase 1 (AS003) -- offline-integrity + reduced-motion check for the
// Nexus-AI interactive guide. The guide ships as a single self-contained file
// that MUST open offline with zero outbound network requests (see the Phase 1
// Stability Gate in
// docs/versions/v1/v1.6.0/plans/adoption-aisuite-harness.md). This test is the
// CI guard for that property: it parses the real guide and asserts no remote
// asset references, that the constellation canvas is present, and that
// reduced-motion mode renders a single static frame instead of starting a
// requestAnimationFrame loop.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const GUIDE_PATH = path.join(
  REPO_ROOT,
  "guides",
  "interactive-guide",
  "nexus-ai-guide.html",
);

describe("findRemoteAssetRefs", () => {
  it("flags a remote <script src>", () => {
    expect(findRemoteAssetRefs('<script src="https://cdn.example/app.js"></script>')).toContain(
      "script[src]=https://cdn.example/app.js",
    );
  });

  it("flags a remote stylesheet <link href>", () => {
    const refs = findRemoteAssetRefs(
      '<link rel="stylesheet" href="https://fonts.example/x.css">',
    );
    expect(refs).toContain("link[href]=https://fonts.example/x.css");
  });

  it("flags a protocol-relative asset URL", () => {
    expect(findRemoteAssetRefs('<img src="//cdn.example/x.png">')).toHaveLength(1);
  });

  it("flags a remote @font-face / url() in a <style> block", () => {
    const css = "<style>@font-face{font-family:x;src:url(https://fonts.example/x.woff2)}</style>";
    expect(findRemoteAssetRefs(css)).toEqual(["style url(https://fonts.example/x.woff2)"]);
  });

  it("flags a remote srcset candidate", () => {
    const refs = findRemoteAssetRefs('<img srcset="https://cdn.example/x.png 2x">');
    expect(refs).toContain("img[srcset]=https://cdn.example/x.png");
  });

  it("does NOT flag a navigational <a href> to a remote origin", () => {
    expect(findRemoteAssetRefs('<a href="https://github.com/bendourthe/Nexus-AI">repo</a>')).toEqual([]);
  });

  it("does NOT flag an inline data: URI", () => {
    expect(findRemoteAssetRefs('<link rel="icon" href="data:image/svg+xml,%3Csvg/%3E">')).toEqual([]);
  });

  it("does NOT flag a local SVG paint fragment url(#id)", () => {
    expect(findRemoteAssetRefs('<style>.x{fill:url(#nx-grad)}</style>')).toEqual([]);
  });

  it("does NOT flag a remote URL that appears only as plain text", () => {
    expect(findRemoteAssetRefs("<pre>$ git clone https://github.com/x/y.git</pre>")).toEqual([]);
  });
});

describe("nexus-ai-guide.html offline integrity", () => {
  const html = fs.readFileSync(GUIDE_PATH, "utf-8");

  it("exists at the path the plan declares", () => {
    expect(fs.existsSync(GUIDE_PATH)).toBe(true);
  });

  it("contains no remote asset references", () => {
    expect(findRemoteAssetRefs(html)).toEqual([]);
  });

  it("embeds all CSS and JS inline (no external <script src> or <link rel=stylesheet>)", () => {
    const root = parse(html);
    const scripts = root.querySelectorAll("script") as HTMLElement[];
    expect(scripts.every((s) => !s.getAttribute("src"))).toBe(true);
    const links = root.querySelectorAll("link") as HTMLElement[];
    const stylesheets = links.filter((l) => (l.getAttribute("rel") || "").includes("stylesheet"));
    expect(stylesheets).toHaveLength(0);
  });
});

describe("nexus-ai-guide.html constellation + reduced motion", () => {
  const html = fs.readFileSync(GUIDE_PATH, "utf-8");

  it("includes the constellation canvas", () => {
    const canvas = parse(html).querySelector("#constellation");
    expect(canvas).not.toBeNull();
    expect(canvas?.rawTagName.toLowerCase()).toBe("canvas");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });

  it("declares a prefers-reduced-motion media query in CSS", () => {
    expect(html).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  });

  it("reads the reduced-motion preference into the boot script", () => {
    const script = bootScript(html);
    expect(script).toMatch(/matchMedia\(\s*["']\(prefers-reduced-motion:\s*reduce\)["']\s*\)/);
  });

  it("drives the animation loop solely through requestAnimationFrame inside loop()", () => {
    const script = bootScript(html);
    // requestAnimationFrame is reachable only from loop(); any other entry
    // point would mean reduced-motion mode could still animate.
    expect((script.match(/requestAnimationFrame\(/g) || [])).toHaveLength(1);
    expect(script).toMatch(/function\s+loop\s*\(\s*\)\s*\{[^}]*requestAnimationFrame\(\s*loop\s*\)/);
  });

  it("renders a single static frame under reduced motion instead of looping", () => {
    const script = bootScript(html);
    // start(): if (REDUCE) { frame(false); } else { loop(); }
    expect(script).toMatch(
      /if\s*\(\s*REDUCE\s*\)\s*\{\s*frame\(\s*false\s*\)\s*;?\s*\}\s*else\s*\{\s*loop\(\s*\)\s*;?\s*\}/,
    );
  });

  it("does not redraw a moving frame on resize when reduced motion is on", () => {
    const script = bootScript(html);
    // resize handler: if (!running && !REDUCE) frame(false);
    expect(script).toMatch(/!\s*running\s*&&\s*!\s*REDUCE/);
  });
});

/** Returns the inline boot <script> (the IIFE that owns the constellation). */
function bootScript(html: string): string {
  const scripts = parse(html).querySelectorAll("script") as HTMLElement[];
  const boot = scripts.find((s) => s.innerHTML.includes("constellation"));
  expect(boot, "expected an inline boot script that references the constellation").toBeDefined();
  return boot!.innerHTML;
}
