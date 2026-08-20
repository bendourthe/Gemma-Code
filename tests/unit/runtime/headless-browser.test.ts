import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";

import { createHeadlessTools } from "../../../modules/coding/runtime/headlessTools.js";
import { InMemoryBrowser } from "../../../modules/coding/browser/InMemoryBrowser.js";
import { resetSharedBrowserSessionForTests } from "../../../modules/coding/browser/session.js";
import { BROWSER_SNAPSHOT_ORIGIN_LABEL } from "../../../modules/coding/browser/snapshot.js";
import { screenHeadlessCall } from "../../../modules/coding/runtime/headlessGuards.js";

afterEach(async () => {
  await resetSharedBrowserSessionForTests();
});

describe("createHeadlessTools -- browser family", () => {
  it("omits browser tools unless browserEnabled is set", () => {
    const names = createHeadlessTools().map((t) => t.name);
    expect(names).not.toContain("browser_navigate");
  });

  it("registers all five tools when enabled and screens a local fixture", async () => {
    const driver = new InMemoryBrowser(() => path.join(os.tmpdir(), "nexus-hl-br"), "hl");
    const tools = createHeadlessTools({ browserEnabled: true, browserDriver: driver });
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining([
      "browser_navigate",
      "browser_click",
      "browser_type",
      "browser_aria_snapshot",
      "browser_close",
    ]));
    const nav = tools.find((t) => t.name === "browser_navigate");
    if (!nav) throw new Error("missing navigate");
    const url = pathToFileURL(
      path.join(process.cwd(), "tests/fixtures/browser-adversarial/long-flow-a.html"),
    ).href;
    const result = await nav.execute({ url }, { workdir: process.cwd() });
    expect(result.success).toBe(true);
    expect(result.output).toContain(BROWSER_SNAPSHOT_ORIGIN_LABEL);
  });

  it("allows browser_navigate without confirm (legacy headless) and prompts when confirm is wired", async () => {
    const open = await screenHeadlessCall("browser_navigate", { url: "https://example.com" });
    expect(open.allowed).toBe(true);
    const denied = await screenHeadlessCall(
      "browser_click",
      { selector: "#x" },
      { confirm: async () => false },
    );
    expect(denied.allowed).toBe(false);
    const ok = await screenHeadlessCall(
      "browser_navigate",
      { url: "https://example.com" },
      { confirm: async () => true },
    );
    expect(ok.allowed).toBe(true);
  });
});
