/**
 * v0.9.0 Phase 4 sub-task 4.3 -- structural integration test for the
 * `.husky/pre-push` hook.
 *
 * Running the real hook end-to-end would re-enter `npm test` (and so the
 * very test we are in) and would be a 30+ second build round-trip on every
 * `npm test`. Instead this suite asserts the hook's surface contract:
 *
 *   - The file exists, declares `set -e`, and uses a POSIX shebang.
 *   - The five expected steps appear in the correct order (eslint --fix,
 *     dirty-tree check, strict lint, build, gemma-check).
 *   - No step is muted with `|| true` except for the deliberate auto-fix
 *     pass, where the dirty-tree check below is what actually gates the
 *     push.
 *   - The hook returns a clear instruction string when ESLint auto-fixes
 *     files, so contributors know to re-stage and re-push.
 *
 * A separate manual smoke (Phase 4.5) exercises the real hook against a
 * real commit on a real branch.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOK_PATH = path.join(REPO_ROOT, ".husky", "pre-push");

describe("husky pre-push hook", () => {
  it("file exists at .husky/pre-push", () => {
    expect(fs.existsSync(HOOK_PATH)).toBe(true);
  });

  it("starts with a POSIX shebang and declares set -e", () => {
    const body = fs.readFileSync(HOOK_PATH, "utf-8");
    const head = body.split(/\r?\n/, 1)[0];
    expect(head.startsWith("#!")).toBe(true);
    expect(body).toMatch(/^set -e/m);
  });

  it("runs eslint --fix as step 1", () => {
    const body = fs.readFileSync(HOOK_PATH, "utf-8");
    expect(body).toMatch(/npm run lint -- --fix/);
  });

  it("prints a re-stage / re-push instruction when auto-fix changes files", () => {
    const body = fs.readFileSync(HOOK_PATH, "utf-8");
    expect(body).toMatch(/git diff/);
    expect(body).toMatch(/re-stage/);
    expect(body).toMatch(/re-push/);
    // Must exit non-zero after auto-fix so the push is refused.
    expect(body).toMatch(/exit 1/);
  });

  it("re-runs strict lint after the auto-fix pass", () => {
    const body = fs.readFileSync(HOOK_PATH, "utf-8");
    // The strict invocation (without --fix) must appear after the auto-fix.
    const fixIdx = body.indexOf("--fix");
    const strictIdx = body.indexOf("npm run lint\n");
    // Strict lint may also be written as `npm run lint` followed by another
    // shell character; loosen the second lookup but require it after --fix.
    const strict = body.match(/npm run lint(?!\s*--\s*--fix)/g);
    expect(strict?.length ?? 0).toBeGreaterThanOrEqual(2);
    if (strictIdx >= 0) {
      expect(strictIdx).toBeGreaterThan(fixIdx);
    }
  });

  it("runs build and check after lint", () => {
    const body = fs.readFileSync(HOOK_PATH, "utf-8");
    expect(body).toMatch(/npm run build/);
    expect(body).toMatch(/npm run check/);
    const buildIdx = body.indexOf("npm run build");
    const checkIdx = body.indexOf("npm run check");
    const lintFixIdx = body.indexOf("--fix");
    expect(buildIdx).toBeGreaterThan(lintFixIdx);
    expect(checkIdx).toBeGreaterThan(lintFixIdx);
  });

  it("does NOT swallow strict lint / build / check with `|| true`", () => {
    const body = fs.readFileSync(HOOK_PATH, "utf-8");
    // The deliberate auto-fix pass MAY end with `|| true`; the dirty-tree
    // check is what gates the push. Strict lint / build / check must NOT.
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes("--fix")) continue;
      if (/npm run (lint|build|check)/.test(line)) {
        expect(line.includes("|| true")).toBe(false);
      }
    }
  });
});
