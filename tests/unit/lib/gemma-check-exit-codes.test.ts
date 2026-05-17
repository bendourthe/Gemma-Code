/**
 * v0.8.0 Phase 7 (post-CI) -- gemma-check exit-code semantics.
 *
 * The CI run that exposed v0.7.0 10.O.O failed because the legacy CLI returned
 * exit 1 on any finding -- including warnings. The new contract matches
 * ESLint / ruff / dependency-cruiser: errors gate, warnings inform. `--strict`
 * restores the old "any finding fails" behaviour for callers that need it.
 *
 * Tests are exercised by spawning the CLI as a child process against a
 * temporary fixture tree, so the exit-code paths are validated end-to-end
 * rather than via mocked internals. Placed under tests/unit/lib/ to side-step
 * the 10.O.D vitest 1.6.1 + Windows + node:vm parse bug that blocks
 * tests/unit/cli/gemma-check.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let tmpRoot: string;
// v1.0.0 Phase 2.4: the canonical script is nexus-check.mjs.
const CLI = path.resolve(__dirname, "..", "..", "..", "bin", "nexus-check.mjs");

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-check-exit-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, body: string): string {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf8");
  return full;
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("nexus-check exit codes", () => {
  it("returns 0 when there are no findings", () => {
    writeFile("clean.ts", "export const x = 1;\n");
    const r = run([tmpRoot]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("nexus-check: 0 findings");
  });

  it("returns 0 when only warnings fire (default)", () => {
    writeFile("scripts/legacy.mjs", `console.log("hello world");${"\n"}`);
    writeFile(
      "src/skills/catalog/oversize/SKILL.md",
      "---\nname: t\ndescription: t\n---\n\n" + "word ".repeat(900),
    );
    const r = run([tmpRoot]);
    // both `no-committed-console-log` and `prompt-oversized` are warnings.
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/warning/);
  });

  it("returns 1 when an error-severity rule fires (no --strict needed)", () => {
    const EM_DASH = String.fromCharCode(0x2014);
    writeFile(
      "src/skills/catalog/bad/SKILL.md",
      `---\nname: t\ndescription: t\n---\n\nfoo ${EM_DASH} bar\n`,
    );
    const r = run([tmpRoot]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/prompt-no-ascii-violation/);
  });

  it("--strict flips warnings to a failing exit", () => {
    writeFile("scripts/legacy.mjs", `console.log("hello world");${"\n"}`);
    const r = run(["--strict", tmpRoot]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/no-committed-console-log/);
  });

  it("--help returns 0", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  it("invalid invocation returns 2", () => {
    const r = run(["--nope"]);
    expect(r.code).toBe(2);
  });
});
