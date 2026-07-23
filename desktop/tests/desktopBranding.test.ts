import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

const tauriConf = JSON.parse(
  readFileSync(path.resolve(root, "src-tauri/tauri.conf.json"), "utf-8"),
) as {
  productName: string;
  identifier: string;
  app: {
    windows: Array<{
      title: string;
      decorations: boolean;
      maximized?: boolean;
      resizable?: boolean;
    }>;
  };
};

const indexHtml = readFileSync(path.resolve(root, "index.html"), "utf-8");

const globalsCss = readFileSync(path.resolve(root, "src/styles/globals.css"), "utf-8");

/** Extract a single top-level CSS rule body by its selector (exact `<selector> {`). */
function cssRuleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const capability = JSON.parse(
  readFileSync(path.resolve(root, "src-tauri/capabilities/default.json"), "utf-8"),
) as { windows: string[]; permissions: string[] };

describe("v1.9.0 Phase 5 desktop branding", () => {
  it("names the product Nexus AI Studio while keeping the identifier", () => {
    expect(tauriConf.productName).toBe("Nexus AI Studio");
    expect(tauriConf.identifier).toBe("ai.nexus.shell");
  });

  it("titles the window Nexus AI Studio and drops native decorations", () => {
    const win = tauriConf.app.windows[0];
    expect(win).toBeDefined();
    expect(win?.title).toBe("Nexus AI Studio");
    expect(win?.decorations).toBe(false);
  });

  it("sets the HTML document title to Nexus AI Studio", () => {
    expect(indexHtml).toContain("<title>Nexus AI Studio</title>");
  });

  it("leaves no legacy 'Local AI Studio' window/document title", () => {
    expect(tauriConf.app.windows[0]?.title).not.toContain("Local AI Studio");
    expect(indexHtml).not.toContain("Local AI Studio");
  });
});

describe("v1.9.0 Phase 5 window-control capability", () => {
  it("grants the frameless title bar its window-control permissions", () => {
    expect(capability.windows).toContain("main");
    for (const perm of [
      "core:window:allow-start-dragging",
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-is-maximized",
      "core:window:allow-close",
    ]) {
      expect(capability.permissions).toContain(perm);
    }
  });
});

describe("v1.15.0 Phase 1 window shell (Issue 4)", () => {
  it("opens maximized while remaining resizable", () => {
    const win = tauriConf.app.windows[0];
    expect(win).toBeDefined();
    expect(win?.maximized).toBe(true);
    // Still resizable so the user can restore the window from maximized.
    expect(win?.resizable).toBe(true);
  });

  it("gives the custom title bar a stacking context above the backdrop", () => {
    // The frameless title bar carries the window controls; without its own
    // stacking context the opaque .nexus-app-backdrop (z-index: 0) paints over
    // it and hides minimize/maximize/close. Assert the bar sits above the backdrop.
    const titlebar = cssRuleBody(globalsCss, ".nexus-titlebar");
    expect(titlebar).toMatch(/position:\s*relative/);
    expect(titlebar).toMatch(/z-index:\s*1\b/);

    const backdrop = cssRuleBody(globalsCss, ".nexus-app-backdrop");
    expect(backdrop).toMatch(/z-index:\s*0\b/);
  });
});
