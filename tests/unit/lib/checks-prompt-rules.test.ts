/**
 * v0.8.0 Phase 5 sub-task 5.9 -- pure rule tests for the five new prompt /
 * skill markdown rules. Located under tests/unit/lib/ instead of
 * tests/unit/cli/ to side-step the vitest 1.6.1 + Windows + node:vm parse
 * bug logged as 10.O.D, which currently breaks any test file that lands in
 * tests/unit/cli/ next to gemma-check.test.ts.
 *
 * IMPORTANT: keep this file pure ASCII. Non-ASCII assertion data is built
 * via String.fromCharCode escapes so the source itself never trips the
 * upstream parser bug.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// @ts-expect-error -- mjs helper, no .d.ts by design.
import * as promptNoAscii from "../../../lib/checks/prompt-no-ascii-violation.mjs";
// @ts-expect-error -- mjs helper.
import * as promptOversized from "../../../lib/checks/prompt-oversized.mjs";
// @ts-expect-error -- mjs helper.
import * as promptTrailingWs from "../../../lib/checks/prompt-trailing-whitespace.mjs";
// @ts-expect-error -- mjs helper.
import * as promptBom from "../../../lib/checks/prompt-bom.mjs";
// @ts-expect-error -- mjs helper.
import * as skillDuplicateName from "../../../lib/checks/skill-duplicate-name.mjs";
// @ts-expect-error -- mjs helper.
import { RULE_BY_ID } from "../../../lib/checks/index.mjs";

const EM_DASH = String.fromCharCode(0x2014);
const LEFT_DQUOTE = String.fromCharCode(0x201c);
const RIGHT_DQUOTE = String.fromCharCode(0x201d);
const LEFT_SQUOTE = String.fromCharCode(0x2018);
const RIGHT_SQUOTE = String.fromCharCode(0x2019);
const BOM = String.fromCharCode(0xfeff);

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-check-prompt-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeMd(rel: string, body: string): string {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
  return full;
}

describe("prompt-no-ascii-violation", () => {
  it("appliesTo only prompts and SKILL.md under the v0.8.0 layout", () => {
    expect(promptNoAscii.appliesTo("modules/coding/chat/prompts/x.md")).toBe(true);
    expect(promptNoAscii.appliesTo("modules/coding/skills/catalog/foo/SKILL.md")).toBe(true);
    expect(promptNoAscii.appliesTo("src/util.ts")).toBe(false);
    expect(promptNoAscii.appliesTo("docs/README.md")).toBe(false);
  });

  it("flags em-dash and curly quotes", () => {
    const naughty =
      "an em-dash " +
      EM_DASH +
      " here and " +
      LEFT_DQUOTE +
      "curly" +
      RIGHT_DQUOTE +
      " " +
      LEFT_SQUOTE +
      "single" +
      RIGHT_SQUOTE;
    const filePath = writeMd("modules/coding/chat/prompts/foo.md", naughty);
    const findings = promptNoAscii.scan(filePath, fs.readFileSync(filePath, "utf-8"));
    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings[0].rule).toBe("prompt-no-ascii-violation");
  });

  it("passes on pure-ASCII markdown", () => {
    const filePath = writeMd("modules/coding/chat/prompts/good.md", "this is pure ASCII\n");
    expect(promptNoAscii.scan(filePath, fs.readFileSync(filePath, "utf-8"))).toEqual([]);
  });
});

describe("prompt-oversized", () => {
  it("flags markdown over the configured budget", () => {
    process.env["GEMMA_CHECK_PROMPT_TOKEN_BUDGET"] = "10";
    try {
      const filePath = writeMd("modules/coding/chat/prompts/big.md", "x".repeat(500));
      const findings = promptOversized.scan(filePath, fs.readFileSync(filePath, "utf-8"));
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe("prompt-oversized");
    } finally {
      delete process.env["GEMMA_CHECK_PROMPT_TOKEN_BUDGET"];
    }
  });

  it("passes for tiny markdown", () => {
    const filePath = writeMd("modules/coding/chat/prompts/small.md", "tiny");
    expect(promptOversized.scan(filePath, fs.readFileSync(filePath, "utf-8"))).toEqual([]);
  });
});

describe("prompt-trailing-whitespace", () => {
  it("flags trailing spaces and tabs", () => {
    const filePath = writeMd(
      "modules/coding/chat/prompts/ws.md",
      "line one  \nline two\nline three\t\n",
    );
    const findings = promptTrailingWs.scan(filePath, fs.readFileSync(filePath, "utf-8"));
    expect(findings.length).toBe(2);
  });

  it("passes a clean file", () => {
    const filePath = writeMd("modules/coding/chat/prompts/ok.md", "line one\nline two\n");
    expect(promptTrailingWs.scan(filePath, fs.readFileSync(filePath, "utf-8"))).toEqual([]);
  });
});

describe("prompt-bom", () => {
  it("flags a BOM at file start", () => {
    const filePath = writeMd("modules/coding/chat/prompts/bom.md", BOM + "# title");
    const findings = promptBom.scan(filePath, fs.readFileSync(filePath, "utf-8"));
    expect(findings).toHaveLength(1);
  });

  it("passes when no BOM is present", () => {
    const filePath = writeMd("modules/coding/chat/prompts/no-bom.md", "# title");
    expect(promptBom.scan(filePath, fs.readFileSync(filePath, "utf-8"))).toEqual([]);
  });
});

describe("skill-duplicate-name (cross-file)", () => {
  it("reports a finding per duplicate after flush()", () => {
    const a = writeMd(
      "modules/coding/skills/catalog/team/SKILL.md",
      "---\nname: deploy\ndescription: t\n---\n",
    );
    const b = writeMd(
      "modules/coding/skills/catalog/other-team/SKILL.md",
      "---\nname: deploy\ndescription: t\n---\n",
    );
    skillDuplicateName.scan(a, fs.readFileSync(a, "utf-8"));
    skillDuplicateName.scan(b, fs.readFileSync(b, "utf-8"));
    const findings = skillDuplicateName.flush();
    expect(findings).toHaveLength(2);
    expect(findings[0].rule).toBe("skill-duplicate-name");
  });

  it("returns no findings when names are distinct", () => {
    const a = writeMd(
      "modules/coding/skills/catalog/team/SKILL.md",
      "---\nname: deploy\ndescription: t\n---\n",
    );
    const b = writeMd(
      "modules/coding/skills/catalog/other-team/SKILL.md",
      "---\nname: build\ndescription: t\n---\n",
    );
    skillDuplicateName.scan(a, fs.readFileSync(a, "utf-8"));
    skillDuplicateName.scan(b, fs.readFileSync(b, "utf-8"));
    expect(skillDuplicateName.flush()).toEqual([]);
  });
});

describe("registry exports", () => {
  it("each new rule id resolves through RULE_BY_ID", () => {
    expect(RULE_BY_ID["prompt-no-ascii-violation"]).toBeDefined();
    expect(RULE_BY_ID["prompt-oversized"]).toBeDefined();
    expect(RULE_BY_ID["prompt-trailing-whitespace"]).toBeDefined();
    expect(RULE_BY_ID["prompt-bom"]).toBeDefined();
    expect(RULE_BY_ID["skill-duplicate-name"]).toBeDefined();
  });
});
