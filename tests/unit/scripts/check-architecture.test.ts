import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("scripts/check-architecture wrappers", () => {
  it("scripts/check-architecture.sh exists and starts with the bash shebang", () => {
    const file = path.join(REPO_ROOT, "scripts", "check-architecture.sh");
    expect(fs.existsSync(file)).toBe(true);
    // Split on either CRLF or LF: git's `core.autocrlf=true` (default on
    // Windows installs) checks the LF-committed file out with CRLF endings;
    // the shebang itself is unchanged but a trailing `\r` would otherwise
    // fail the exact-match assertion.
    const head = fs.readFileSync(file, "utf-8").split(/\r?\n/, 1)[0];
    expect(head).toBe("#!/usr/bin/env bash");
  });

  it("scripts/check-architecture.ps1 exists and declares CmdletBinding", () => {
    const file = path.join(REPO_ROOT, "scripts", "check-architecture.ps1");
    expect(fs.existsSync(file)).toBe(true);
    const body = fs.readFileSync(file, "utf-8");
    expect(body).toMatch(/\[CmdletBinding\(\)\]/);
  });

  it("scripts/check-architecture.sh delegates to `npm run deps:check`", () => {
    const body = fs.readFileSync(
      path.join(REPO_ROOT, "scripts", "check-architecture.sh"),
      "utf-8",
    );
    expect(body).toContain("npm run --silent deps:check");
  });

  it("scripts/check-architecture.ps1 delegates to `npm run deps:check`", () => {
    const body = fs.readFileSync(
      path.join(REPO_ROOT, "scripts", "check-architecture.ps1"),
      "utf-8",
    );
    expect(body).toContain('"deps:check"');
  });

  it("scripts/init.sh wires the architecture check in as Step 6/6", () => {
    const body = fs.readFileSync(path.join(REPO_ROOT, "scripts", "init.sh"), "utf-8");
    expect(body).toContain("Step 6/6: architecture boundaries");
    expect(body).toContain("scripts/check-architecture.sh");
  });
});
