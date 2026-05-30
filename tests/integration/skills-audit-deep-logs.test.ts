import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
// Exercises the `--deep-logs` flag end-to-end across the CLI surface + the
// compiled auditor + the usage scanner.
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

function writeSkill(root: string, name: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Skill ${name}.\n---\n\n# ${name}\n\nBody for ${name}.\n`,
    "utf8",
  );
}

/**
 * Integration test for `--deep-logs` (T018). The only usage evidence for the
 * two fixture skills lives inside the sessions `archive/` subtree:
 *   - alpha -> a gzip-compressed `*.jsonl.gz` HookBus event
 *   - beta  -> a plain `*.jsonl` slug mention
 * Both are invisible to a default scan (archive is skipped, gz is not read) and
 * both become visible with `--deep-logs`, so the Unused report flips.
 */
describe("nexus skills audit --deep-logs CLI", () => {
  let fixtureRoot: string;
  let sessionsRoot: string;

  beforeAll(() => {
    if (!fs.existsSync(AUDITOR_ARTIFACT)) {
      const build = spawnSync("npm", ["run", "build"], {
        cwd: REPO_ROOT,
        shell: process.platform === "win32",
        stdio: "ignore",
        timeout: 180_000,
      });
      if (build.status !== 0) {
        throw new Error("skills-audit-deep-logs.test: `npm run build` failed; cannot exercise the CLI.");
      }
    }
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-deeplogs-skills-"));
    sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-deeplogs-sessions-"));
    writeSkill(fixtureRoot, "alpha");
    writeSkill(fixtureRoot, "beta");

    const archiveDir = path.join(sessionsRoot, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });

    // alpha -> compressed HookBus event inside the archive subtree.
    const event =
      JSON.stringify({
        kind: "lifecycle.skill.loaded",
        skillId: "alpha",
        timestamp: "2026-05-20T10:00:00Z",
      }) + "\n";
    fs.writeFileSync(path.join(archiveDir, "old.jsonl.gz"), zlib.gzipSync(Buffer.from(event, "utf8")));

    // beta -> plain-text slug mention in a non-compressed archived log.
    fs.writeFileSync(
      path.join(archiveDir, "old.jsonl"),
      JSON.stringify({ kind: "message", text: "Reach for the beta skill here." }) + "\n",
      "utf8",
    );
  }, 200_000);

  afterAll(() => {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
    if (sessionsRoot) fs.rmSync(sessionsRoot, { recursive: true, force: true });
  });

  it("ignores archived and gz logs by default (both skills are Unused candidates)", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runSkillsAudit(
      { "skills-root": fixtureRoot, "sessions-root": sessionsRoot, months: "12", json: true },
      stdout,
      stderr,
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text);
    const unused = report.unused.map((u: { id: string }) => u.id).sort();
    expect(unused).toEqual(["alpha", "beta"]);
  });

  it("reads the archive subtree and gz logs under --deep-logs (evidence surfaces)", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runSkillsAudit(
      {
        "skills-root": fixtureRoot,
        "sessions-root": sessionsRoot,
        months: "12",
        "deep-logs": true,
        json: true,
      },
      stdout,
      stderr,
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text);
    const unused = report.unused.map((u: { id: string }) => u.id);
    // Both skills now have usage evidence, so neither is an Unused candidate.
    expect(unused).not.toContain("alpha");
    expect(unused).not.toContain("beta");
  });
});
