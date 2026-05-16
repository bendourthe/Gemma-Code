/**
 * v0.8.0 Phase 7.A unit tests -- no-bare-promise-rejection.
 *
 * Closes v0.7.0 known-gaps 10.O.8. Three cases verify the rule's positive
 * and negative behaviour:
 *
 *   1. Bare `.catch()` outside a test file produces one finding.
 *   2. Bare `.catch()` inside a test file produces zero findings (allow-listed).
 *   3. `.catch(handler)` and `.catch(() => ...)` produce zero findings.
 *
 * Located under tests/unit/lib/ to side-step the vitest 1.6.1 + Windows +
 * node:vm parse bug logged as 10.O.D (which currently breaks any test file
 * that lands in tests/unit/cli/ next to gemma-check.test.ts).
 */

import { describe, it, expect } from "vitest";

// @ts-expect-error -- mjs helper, no .d.ts by design.
import * as noBare from "../../../lib/checks/no-bare-promise-rejection.mjs";
// @ts-expect-error -- mjs helper.
import { RULE_BY_ID } from "../../../lib/checks/index.mjs";

describe("no-bare-promise-rejection", () => {
  it("flags a bare `.catch()` in production source", () => {
    const filePath = "src/services/Worker.ts";
    const contents = [
      "export async function run() {",
      "  doAsyncThing().catch();",
      "}",
      "",
    ].join("\n");

    const findings = noBare.scan(filePath, contents);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "no-bare-promise-rejection",
      severity: "warning",
      file: filePath,
      line: 2,
    });
    expect(findings[0].message).toMatch(/bare \.catch\(\)/);
  });

  it("does not flag `.catch()` in test files", () => {
    const filePath = "tests/unit/services/Worker.test.ts";
    const contents = [
      "it('swallows', () => {",
      "  doAsyncThing().catch();",
      "});",
      "",
    ].join("\n");

    const findings = noBare.scan(filePath, contents);
    expect(findings).toEqual([]);
  });

  it("does not flag `.catch(handler)` or `.catch(() => ...)`", () => {
    const filePath = "src/services/Worker.ts";
    const contents = [
      "doAsyncThing().catch(logger.error);",
      "doAsyncThing().catch(() => undefined);",
      "doAsyncThing().catch((err) => logger.warn(err));",
      "",
    ].join("\n");

    const findings = noBare.scan(filePath, contents);
    expect(findings).toEqual([]);
  });

  it("is registered in the rule index under its canonical id", () => {
    expect(RULE_BY_ID["no-bare-promise-rejection"]).toBe(noBare);
  });
});
