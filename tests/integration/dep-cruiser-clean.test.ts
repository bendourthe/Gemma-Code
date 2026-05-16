/**
 * v0.8.0 Phase 7.B regression -- `npm run deps:check` must exit 0.
 *
 * Closes v0.7.0 known-gaps 10.O.9 (4 pre-existing dep-cruiser violations).
 * The three `no-storage-from-panels` violations were resolved by whitelisting
 * `MemoryPanel` in `configs/dependency-cruiser.cjs` (the panel is the
 * canonical view-owner for memory state). The one `no-panels-from-tools`
 * violation was resolved by refactoring `ConfirmationGate` to receive its
 * permission-option builder via constructor injection, removing its direct
 * import of `src/panels/webview/render/permissionPrompt.ts`.
 *
 * The test passes when `depcruise` returns exit 0 (warnings allowed,
 * errors blocked).
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

describe("dep-cruiser baseline", () => {
  it("`npm run deps:check` (`depcruise --config configs/dependency-cruiser.cjs src tests`) exits 0", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const depcruiseBin = path.resolve(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "depcruise.cmd" : "depcruise",
    );

    const result = spawnSync(
      depcruiseBin,
      ["--config", "configs/dependency-cruiser.cjs", "src", "tests"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );

    // dep-cruiser prints results to stdout. Surface them on failure so the
    // diagnostic survives CI log truncation.
    if (result.status !== 0) {
      const tail = `stdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`;
      expect(result.status, tail).toBe(0);
    } else {
      expect(result.status).toBe(0);
    }
  }, 60_000);
});
