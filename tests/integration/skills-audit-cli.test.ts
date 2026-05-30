import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
// The CLI loads its audit logic from the compiled `out/` bundle, so this is a
// genuine integration test across the CLI surface + the compiled auditor.
import { runSkillsAudit } from "../../bin/nexus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AUDITOR_ARTIFACT = path.join(REPO_ROOT, "out", "core", "skills", "SkillAuditor.js");

/** Capture writes to a fake stream so we can assert on rendered output. */
function captureStream() {
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

function writeSkill(root: string, name: string, description: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody for ${name}.\n`,
    "utf8",
  );
}

describe("nexus skills audit CLI", () => {
  let fixtureRoot: string;

  beforeAll(() => {
    // The CLI imports the compiled auditor; build it once if missing so the
    // test is self-sufficient outside the build-then-test gate.
    if (!fs.existsSync(AUDITOR_ARTIFACT)) {
      const build = spawnSync("npm", ["run", "build"], {
        cwd: REPO_ROOT,
        shell: process.platform === "win32",
        stdio: "ignore",
        timeout: 180_000,
      });
      if (build.status !== 0) {
        throw new Error("skills-audit-cli.test: `npm run build` failed; cannot exercise the CLI.");
      }
    }
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-audit-cli-"));
    writeSkill(fixtureRoot, "alpha", "Short alpha description.");
    writeSkill(
      fixtureRoot,
      "beta",
      "A deliberately long beta description that repeats itself many times " +
        "so the rendered line clears the description-token threshold and shows up " +
        "as a Description candidate in the audit output for this fixture skill.",
    );
  }, 200_000);

  afterAll(() => {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("emits the five canonical section headings against a fixture root", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runSkillsAudit({ "skills-root": fixtureRoot }, stdout, stderr);

    expect(code).toBe(0);
    for (const heading of [
      "## Skill Budget",
      "## Description candidates",
      "## Duplicates",
      "## Unused candidates",
      "## Root summary",
    ]) {
      expect(stdout.text, `missing heading ${heading}`).toContain(heading);
    }
    expect(stdout.text).toContain("_(populated by phase 4)_");
    // Budget reports a non-zero used-token count for a non-empty catalog.
    expect(stdout.text).toMatch(/- Used: [1-9]\d* tokens/);
  });

  it("emits machine-readable JSON under --json", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runSkillsAudit({ "skills-root": fixtureRoot, json: true }, stdout, stderr);

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text);
    expect(report.budget.usedTokens).toBeGreaterThan(0);
    expect(report.duplicates.bySimilarity).toEqual([]);
    expect(report.unused).toEqual([]);
    expect(Array.isArray(report.roots)).toBe(true);
  });

  it("exits non-zero with a clear message when no skills load", async () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-audit-empty-"));
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runSkillsAudit({ "skills-root": emptyRoot }, stdout, stderr);

    expect(code).toBe(1);
    expect(stderr.text).toContain("no skills loaded");
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  });
});
