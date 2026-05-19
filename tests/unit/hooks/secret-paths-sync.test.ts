/**
 * Synchronization gate: assert the harness-side secret-path patterns
 * (`scripts/hooks/lib/secret-paths.mjs`) and the in-process runtime patterns
 * (`src/utils/secretPaths.ts`) remain identical. The .mjs file is
 * the documented canonical source; the duplication exists only because the
 * `scripts/` directory is excluded from the packaged VS Code extension.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { SECRET_PATH_PATTERNS as TS_PATTERNS } from "../../../modules/coding/utils/secretPaths.js";

const MJS_PATH = path.resolve(__dirname, "../../../scripts/hooks/lib/secret-paths.mjs");

describe("secret-paths cross-file synchronization", () => {
  it("the .mjs and .ts pattern lists are byte-identical", async () => {
    const mod = (await import(MJS_PATH)) as { SECRET_PATH_PATTERNS: readonly string[] };
    expect([...mod.SECRET_PATH_PATTERNS]).toEqual([...TS_PATTERNS]);
  });
});
