import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { runGoldenRun } from "../../../bin/nexus.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNNER_ARTIFACT = path.join(REPO_ROOT, "out", "modules", "coding", "evaluation", "GoldenTaskRunner.js");

// The CLI loads compiled `out/` artifacts (like `nexus trace export`); build
// once if they are missing so the suite works from a clean checkout.
beforeAll(() => {
  if (!fs.existsSync(RUNNER_ARTIFACT)) {
    const build = spawnSync("npm", ["run", "build"], {
      cwd: REPO_ROOT,
      shell: process.platform === "win32",
      stdio: "ignore",
      timeout: 300_000,
    });
    if (build.status !== 0) {
      throw new Error("golden-run-cli.test: `npm run build` failed; cannot exercise the CLI.");
    }
  }
}, 320_000);

function captureStream(): { write(chunk: string): boolean; readonly text: string } {
  let text = "";
  return {
    write(chunk: string) {
      text += chunk;
      return true;
    },
    get text() {
      return text;
    },
  };
}

describe("nexus golden run (SO001.P1.B)", () => {
  it("errors with exit 1 on an unknown task id", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runGoldenRun({ task: "no-such-task-xyz" }, stdout, stderr);
    expect(code).toBe(1);
    expect(stderr.text).toContain('no task with id "no-such-task-xyz"');
  });

  it("runs the golden corpus in dry mode and prints a summary", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runGoldenRun({ mode: "dry" }, stdout, stderr);

    // Dry mode evaluates untouched snapshots (no agent), so some tasks fail;
    // assert the run completed with a well-formed summary rather than a count.
    expect(stdout.text).toMatch(/nexus golden run: \d+\/\d+ passed \(dry mode\)/);
    expect(stdout.text).toMatch(/^(PASS|FAIL) /m);
    expect([0, 1]).toContain(code);
  }, 120_000);
});
