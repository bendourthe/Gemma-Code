/**
 * v1.4.0 Phase 3 sub-task 3.3 (T011) -- tests for the A2 test-tampering rule
 * family (the deterministic, LLM-free reimplementation of the harness "Beagle"
 * T01-T12 behaviours): no-focused-tests, no-skipped-tests-without-reason,
 * no-tautological-assertion, no-commented-out-assertion, no-disabled-ci-check.
 *
 * Located under tests/unit/lib/ (next to checks-prompt-rules.test.ts) rather
 * than tests/unit/cli/, to side-step the historical vitest + Windows + node:vm
 * parse bug (10.O.D) that affected new files beside gemma-check.test.ts.
 *
 * IMPORTANT: this file is itself scanned by `npm run check:tampering` (which
 * walks tests/). To avoid the rules flagging their own test fixtures, every
 * trigger substring is ASSEMBLED at runtime from fragments (the `.only`,
 * `expect`, `toBe`, ... constants below), so the literal call-site / assertion
 * text never appears verbatim in this source. This mirrors the
 * String.fromCharCode tactic in checks-prompt-rules.test.ts. The YAML rule
 * (no-disabled-ci-check) only applies to .github/workflows/*.yml, so its
 * fixtures may use verbatim `continue-on-error: true` text safely.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// @ts-expect-error -- mjs helper, no .d.ts by design.
import * as noFocusedTests from "../../../lib/checks/no-focused-tests.mjs";
// @ts-expect-error -- mjs helper.
import * as noSkipped from "../../../lib/checks/no-skipped-tests-without-reason.mjs";
// @ts-expect-error -- mjs helper.
import * as noTautological from "../../../lib/checks/no-tautological-assertion.mjs";
// @ts-expect-error -- mjs helper.
import * as noCommentedOut from "../../../lib/checks/no-commented-out-assertion.mjs";
// @ts-expect-error -- mjs helper.
import * as noDisabledCi from "../../../lib/checks/no-disabled-ci-check.mjs";
// @ts-expect-error -- mjs helper.
import { isQuoted, hasJustification, isAllowed } from "../../../lib/checks/helpers.mjs";
// @ts-expect-error -- mjs helper.
import { RULE_BY_ID } from "../../../lib/checks/index.mjs";

const CLI = path.resolve(__dirname, "..", "..", "..", "bin", "nexus-check.mjs");

// --- assembled trigger fragments (see header) ------------------------------
const ONLY = "." + "only";
const SKIP = "." + "skip";
const TODO_M = "." + "todo";
const FD = "f" + "describe";
const FIT = "f" + "it";
const EXPECT = "exp" + "ect";
const ASSERT = "ass" + "ert";
const TO_BE = "toB" + "e";
const TO_EQUAL = "toE" + "qual";
const TO_BE_TRUTHY = "toBeTr" + "uthy";

const TEST_PATH = "tests/sample.test.ts";

// ---------------------------------------------------------------------------
// helpers (isQuoted / hasJustification / nexus-check-allow marker)
// ---------------------------------------------------------------------------

describe("helpers (A2 additions)", () => {
  it("isQuoted detects a string/template delimiter immediately before the offset", () => {
    const text = `x"abc`;
    expect(isQuoted(text, 2)).toBe(true); // char before index 2 is a double-quote
    expect(isQuoted("`abc", 1)).toBe(true);
    expect(isQuoted("'abc", 1)).toBe(true);
    expect(isQuoted(" abc", 1)).toBe(false);
    expect(isQuoted("abc", 0)).toBe(false);
  });

  it("hasJustification recognises TODO(...), reason:, issue refs and URLs near the offset", () => {
    expect(hasJustification("TODO(harness-bug)\nline", 18)).toBe(true);
    expect(hasJustification("// reason: flaky\nline", 17)).toBe(true);
    expect(hasJustification("see (#1234)\nline", 12)).toBe(true);
    expect(hasJustification("https://example.test/x\nline", 23)).toBe(true);
    expect(hasJustification("just some code\nmore code", 16)).toBe(false);
  });

  it("isAllowed honours both the nexus-check-allow and legacy gemma-check-allow markers", () => {
    expect(isAllowed("code here // nexus-check-allow: some-rule", 0, "some-rule")).toBe(true);
    expect(isAllowed("code here // gemma-check-allow: some-rule", 0, "some-rule")).toBe(true);
    expect(isAllowed("code here // nexus-check-allow: other-rule", 0, "some-rule")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// no-focused-tests (error)
// ---------------------------------------------------------------------------

describe("no-focused-tests", () => {
  it("flags .only on a suite/test function", () => {
    const findings = noFocusedTests.scan(TEST_PATH, `it${ONLY}("x", () => {});\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("no-focused-tests");
    expect(findings[0].severity).toBe("error");
  });

  it("flags the Jasmine fdescribe / fit shorthands", () => {
    expect(noFocusedTests.scan(TEST_PATH, `${FD}("x", () => {});\n`)).toHaveLength(1);
    expect(noFocusedTests.scan(TEST_PATH, `${FIT}("x", () => {});\n`)).toHaveLength(1);
  });

  it("does not flag a normal it()/describe() call", () => {
    expect(noFocusedTests.scan(TEST_PATH, `it("x", () => {});\n`)).toEqual([]);
    expect(noFocusedTests.scan(TEST_PATH, `describe("x", () => {});\n`)).toEqual([]);
  });

  it("does not flag .only inside a comment or string literal", () => {
    expect(noFocusedTests.scan(TEST_PATH, `// it${ONLY}("x");\n`)).toEqual([]);
    expect(noFocusedTests.scan(TEST_PATH, `const s = "it${ONLY}(";\n`)).toEqual([]);
  });

  it("does not flag production (non-test) files", () => {
    expect(noFocusedTests.scan("src/foo.ts", `it${ONLY}("x", () => {});\n`)).toEqual([]);
  });

  it("respects a nexus-check-allow marker", () => {
    const code = `it${ONLY}("x", () => {}); // nexus-check-allow: no-focused-tests\n`;
    expect(noFocusedTests.scan(TEST_PATH, code)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// no-skipped-tests-without-reason (warning)
// ---------------------------------------------------------------------------

describe("no-skipped-tests-without-reason", () => {
  it("flags an unjustified .skip", () => {
    const findings = noSkipped.scan(TEST_PATH, `it${SKIP}("x", () => {});\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("flags the Jasmine xit / xdescribe pending shorthands and .todo", () => {
    expect(noSkipped.scan(TEST_PATH, `xit("x", () => {});\n`)).toHaveLength(1);
    expect(noSkipped.scan(TEST_PATH, `xdescribe("x", () => {});\n`)).toHaveLength(1);
    expect(noSkipped.scan(TEST_PATH, `it${TODO_M}("x");\n`)).toHaveLength(1);
  });

  it("passes when a justification is on the line above (repo TODO convention)", () => {
    const code = `// TODO(harness-bug): blocked on upstream\nit${SKIP}("x", () => {});\n`;
    expect(noSkipped.scan(TEST_PATH, code)).toEqual([]);
  });

  it("passes when a reason: phrase is adjacent", () => {
    const code = `it${SKIP}("x", () => {}); // reason: flaky on shared CI runners\n`;
    expect(noSkipped.scan(TEST_PATH, code)).toEqual([]);
  });

  it("does not flag the conditional .skipIf(...) form", () => {
    expect(noSkipped.scan(TEST_PATH, `describe.skipIf(cond)("x", () => {});\n`)).toEqual([]);
  });

  it("respects a nexus-check-allow marker", () => {
    const code = `it${SKIP}("x", () => {}); // nexus-check-allow: no-skipped-tests-without-reason\n`;
    expect(noSkipped.scan(TEST_PATH, code)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// no-tautological-assertion (error)
// ---------------------------------------------------------------------------

describe("no-tautological-assertion", () => {
  it("flags always-true equality and identical-literal comparisons", () => {
    expect(noTautological.scan(TEST_PATH, `${EXPECT}(true).${TO_BE}(true);\n`)).toHaveLength(1);
    expect(noTautological.scan(TEST_PATH, `${EXPECT}(1).${TO_BE}(1);\n`)).toHaveLength(1);
    expect(noTautological.scan(TEST_PATH, `${EXPECT}("x").${TO_EQUAL}("x");\n`)).toHaveLength(1);
  });

  it("flags truthy-on-literal and assert-true / assert-ok forms", () => {
    expect(noTautological.scan(TEST_PATH, `${EXPECT}(true).${TO_BE_TRUTHY}();\n`)).toHaveLength(1);
    expect(noTautological.scan(TEST_PATH, `${ASSERT}(true);\n`)).toHaveLength(1);
    expect(noTautological.scan(TEST_PATH, `${ASSERT}.ok(1);\n`)).toHaveLength(1);
  });

  it("does NOT flag a real assertion with different literals", () => {
    expect(noTautological.scan(TEST_PATH, `${EXPECT}(1).${TO_BE}(2);\n`)).toEqual([]);
  });

  it("does NOT flag a real assertion with a non-literal operand", () => {
    expect(noTautological.scan(TEST_PATH, `${EXPECT}(arr.length).${TO_BE}(0);\n`)).toEqual([]);
  });

  it("does not flag production (non-test) files", () => {
    expect(noTautological.scan("src/foo.ts", `${EXPECT}(true).${TO_BE}(true);\n`)).toEqual([]);
  });

  it("respects a nexus-check-allow marker", () => {
    const code = `${EXPECT}(true).${TO_BE}(true); // nexus-check-allow: no-tautological-assertion\n`;
    expect(noTautological.scan(TEST_PATH, code)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// no-commented-out-assertion (warning)
// ---------------------------------------------------------------------------

describe("no-commented-out-assertion", () => {
  it("flags a line-commented assertion", () => {
    const findings = noCommentedOut.scan(TEST_PATH, `  // ${EXPECT}(x).${TO_BE}(y);\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("flags a JSDoc-continuation commented assertion and an await form", () => {
    expect(noCommentedOut.scan(TEST_PATH, ` * ${ASSERT}.equal(a, b);\n`)).toHaveLength(1);
    expect(noCommentedOut.scan(TEST_PATH, `  // await ${EXPECT}(p).rejects.toThrow();\n`)).toHaveLength(1);
  });

  it("does not flag prose that merely mentions expect", () => {
    expect(noCommentedOut.scan(TEST_PATH, `  // we ${EXPECT} this to throw later\n`)).toEqual([]);
  });

  it("does not flag a live (uncommented) assertion", () => {
    expect(noCommentedOut.scan(TEST_PATH, `  ${EXPECT}(x).${TO_BE}(y);\n`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// no-disabled-ci-check (warning, workflow YAML only)
// ---------------------------------------------------------------------------

const WF_PATH = ".github/workflows/sample.yml";

describe("no-disabled-ci-check", () => {
  it("appliesTo only matches workflow YAML", () => {
    expect(noDisabledCi.appliesTo(".github/workflows/ci.yml")).toBe(true);
    expect(noDisabledCi.appliesTo(".github/workflows/ci.yaml")).toBe(true);
    expect(noDisabledCi.appliesTo("src/foo.ts")).toBe(false);
    expect(noDisabledCi.appliesTo("configs/other.yml")).toBe(false);
  });

  it("declares the .yml/.yaml extensions for the walker", () => {
    expect(noDisabledCi.scannedExtensions).toEqual([".yml", ".yaml"]);
  });

  it("flags an unjustified continue-on-error: true", () => {
    const yaml = "jobs:\n  a:\n    continue-on-error: true\n    steps: []\n";
    const findings = noDisabledCi.scan(WF_PATH, yaml);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("no-disabled-ci-check");
  });

  it("flags an `if: false` guard", () => {
    const yaml = "jobs:\n  a:\n    if: false\n    steps: []\n";
    expect(noDisabledCi.scan(WF_PATH, yaml)).toHaveLength(1);
  });

  it("passes a continue-on-error with an adjacent justification comment", () => {
    const yaml =
      "jobs:\n  a:\n    # reason: visibility-only job, never gates\n    continue-on-error: true\n";
    expect(noDisabledCi.scan(WF_PATH, yaml)).toEqual([]);
  });

  it("passes a continue-on-error carrying a nexus-check-allow marker", () => {
    const yaml = "jobs:\n  a:\n    continue-on-error: true # nexus-check-allow: no-disabled-ci-check -- advisory\n";
    expect(noDisabledCi.scan(WF_PATH, yaml)).toEqual([]);
  });

  it("does not scan non-workflow files", () => {
    expect(noDisabledCi.scan("configs/x.yml", "continue-on-error: true\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

describe("registry exports (A2 rules)", () => {
  it("resolves every new tampering rule id through RULE_BY_ID", () => {
    expect(RULE_BY_ID["no-focused-tests"]).toBeDefined();
    expect(RULE_BY_ID["no-skipped-tests-without-reason"]).toBeDefined();
    expect(RULE_BY_ID["no-tautological-assertion"]).toBeDefined();
    expect(RULE_BY_ID["no-commented-out-assertion"]).toBeDefined();
    expect(RULE_BY_ID["no-disabled-ci-check"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CLI integration: the walker now reaches workflow YAML via scannedExtensions
// ---------------------------------------------------------------------------

describe("nexus-check CLI: YAML walking for no-disabled-ci-check", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-tamper-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeFile(rel: string, body: string): void {
    const full = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }

  function run(args: string[]): { code: number; stdout: string } {
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    return { code: result.status ?? -1, stdout: result.stdout ?? "" };
  }

  it("discovers and flags a tampered workflow file (proves YAML is walked)", () => {
    writeFile(
      ".github/workflows/x.yml",
      "jobs:\n  a:\n    continue-on-error: true\n    steps: []\n",
    );
    const r = run(["--rule", "no-disabled-ci-check", tmpRoot]);
    // warning severity -> exit 0, but the finding must appear on stdout.
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no-disabled-ci-check");
  });

  it("reports 0 findings on a clean (justified) workflow file", () => {
    writeFile(
      ".github/workflows/x.yml",
      "jobs:\n  a:\n    continue-on-error: true # nexus-check-allow: no-disabled-ci-check -- advisory\n",
    );
    const r = run(["--rule", "no-disabled-ci-check", tmpRoot]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("0 findings");
  });
});
