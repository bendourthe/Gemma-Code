import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const RUNNER = path.resolve(__dirname, "../../../scripts/test.mjs");

describe("scripts/test.mjs", () => {
  it("prints --help text and exits 0", () => {
    const result = spawnSync(process.execPath, [RUNNER, "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("--mode=");
    expect(result.stdout).toContain("integration");
  });

  it("rejects an unknown --mode with exit code 2", () => {
    const result = spawnSync(
      process.execPath,
      [RUNNER, "--mode=does-not-exist"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown mode");
  });
});
