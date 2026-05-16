import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hookFilePath,
  loadHook,
  renderHookAsSystemMessage,
} from "../../../src/chat/ImprovementHook.js";

describe("ImprovementHook", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "improvement-hook-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("hookFilePath() builds the canonical path under the supplied root", () => {
    const p = hookFilePath("enterplanmode-improve", dir);
    expect(p).toBe(path.join(dir, "enterplanmode-improve.md"));
  });

  it("loadHook() returns null when the file does not exist", () => {
    expect(loadHook("enterplanmode-improve", dir)).toBeNull();
  });

  it("loadHook() returns null when the file is empty or whitespace-only", () => {
    fs.writeFileSync(hookFilePath("enterplanmode-improve", dir), "  \n  \n");
    expect(loadHook("enterplanmode-improve", dir)).toBeNull();
  });

  it("loadHook() returns trimmed content when the file is non-empty", () => {
    fs.writeFileSync(
      hookFilePath("enterplanmode-improve", dir),
      "\n  - Always include a migration step.  \n\n",
    );
    expect(loadHook("enterplanmode-improve", dir)).toBe(
      "- Always include a migration step.",
    );
  });

  it("renderHookAsSystemMessage() prefixes a heading and returns null on empty bodies", () => {
    expect(renderHookAsSystemMessage("enterplanmode-improve", dir)).toBeNull();
    fs.writeFileSync(
      hookFilePath("enterplanmode-improve", dir),
      "- Rule 1\n- Rule 2\n",
    );
    const rendered = renderHookAsSystemMessage("enterplanmode-improve", dir);
    expect(rendered).toContain("## User-supplied plan-mode rules");
    expect(rendered).toContain("- Rule 1");
    expect(rendered).toContain("- Rule 2");
  });
});
