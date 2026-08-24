/**
 * v2.2.2 Phase 4 -- Image/Video Advanced must use Select / TextField / Button / Switch.
 * Transcripts must use MessageList, not a custom <ul>.
 */

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const MODULES = path.resolve(__dirname, "../src/modules");

const FORM_FILES = [
  path.join(MODULES, "image", "ImagePromptForm.tsx"),
  path.join(MODULES, "video", "VideoPromptForm.tsx"),
];

const PAGE_FILES = [
  path.join(MODULES, "image", "ImageStudioPage.tsx"),
  path.join(MODULES, "video", "VideoLabPage.tsx"),
];

describe("studio control sweep", () => {
  it("covers the Image and Video prompt forms", () => {
    expect(FORM_FILES.every((file) => readdirSync(path.dirname(file)).includes(path.basename(file)))).toBe(
      true,
    );
  });

  it.each(FORM_FILES.map((file) => [path.basename(file), file] as const))(
    "%s has no leftover unstyled native Advanced controls",
    (_name, file) => {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} leftover <details>`).not.toMatch(/<details[\s>]/);
      expect(src, `${file} leftover <select>`).not.toMatch(/<select[\s>]/);
      expect(src, `${file} leftover <textarea>`).not.toMatch(/<textarea[\s>]/);
      expect(src, `${file} leftover <button>`).not.toMatch(/<button[\s>]/);
      expect(src, `${file} leftover <input>`).not.toMatch(/<input[\s>]/);
    },
  );

  it.each(PAGE_FILES.map((file) => [path.basename(file), file] as const))(
    "%s uses MessageList and no native <details> Advanced chrome",
    (_name, file) => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("MessageList");
      expect(src, `${file} leftover <details>`).not.toMatch(/<details[\s>]/);
    },
  );
});
