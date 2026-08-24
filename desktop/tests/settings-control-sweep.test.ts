/**
 * v2.2.1 Phase 4 -- leftover native search/text/action controls in Settings
 * tab bodies must go through Select / SearchInput / TextField / Button / Switch.
 *
 * SettingsPage.tsx is the tab strip (navigation chrome). Security posture
 * cards keep native radios.
 */

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const SETTINGS_DIR = path.resolve(__dirname, "../src/pages/settings");
const ALLOW_FILE = new Set(["SettingsPage.tsx"]);

describe("settings control sweep", () => {
  const files = readdirSync(SETTINGS_DIR).filter(
    (name) => name.endsWith(".tsx") && !ALLOW_FILE.has(name),
  );

  it("covers every Settings tab body", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s has no leftover unstyled native search/text/action controls", (name) => {
    const src = readFileSync(path.join(SETTINGS_DIR, name), "utf8");
    expect(src, `${name} leftover type=search`).not.toMatch(/<input\b[^>]*type="search"/);
    expect(src, `${name} leftover <select>`).not.toMatch(/<select[\s>]/);
    expect(src, `${name} leftover <textarea>`).not.toMatch(/<textarea[\s>]/);
    expect(src, `${name} leftover <button>`).not.toMatch(/<button[\s>]/);
    const withoutRadios = src.replace(/<input\b[^>]*type="radio"[^>]*>/g, "");
    expect(withoutRadios, `${name} leftover <input>`).not.toMatch(/<input[\s>]/);
  });
});
