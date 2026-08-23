/**
 * v2.2.2 Phase 1 -- Windows CREATE_NO_WINDOW must stay on the shared spawn
 * helper. DETACHED_PROCESS must not be applied as a creation flag (it breaks
 * JSON-RPC pipes). This grep runs on every OS so Ubuntu PRs catch a revert.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const SIDECAR_RS = path.resolve(__dirname, "../src-tauri/src/sidecar.rs");

describe("sidecar spawn flags", () => {
  it("applies CREATE_NO_WINDOW on the shared command builder", () => {
    const src = readFileSync(SIDECAR_RS, "utf8");
    expect(src).toContain("CREATE_NO_WINDOW");
    expect(src).toContain("0x0800_0000");
    expect(src).toContain("creation_flags(CREATE_NO_WINDOW)");
    expect(src).toContain("fn sidecar_command(");
    expect(src).not.toMatch(/creation_flags\([^)]*DETACHED_PROCESS/);
  });
});
