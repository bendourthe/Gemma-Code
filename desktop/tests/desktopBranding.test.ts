import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

const tauriConf = JSON.parse(
  readFileSync(path.resolve(root, "src-tauri/tauri.conf.json"), "utf-8"),
) as {
  productName: string;
  identifier: string;
  app: { windows: Array<{ title: string; decorations: boolean }> };
};

const indexHtml = readFileSync(path.resolve(root, "index.html"), "utf-8");

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
