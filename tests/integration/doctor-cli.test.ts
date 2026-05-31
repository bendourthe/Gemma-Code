import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
// The CLI loads its inventory logic from the compiled `out/` bundle, so this
// is a genuine integration test across the CLI surface + the compiled module.
import { runDoctor } from "../../bin/nexus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOCTOR_ARTIFACT = path.join(REPO_ROOT, "out", "core", "diagnostics", "DoctorReport.js");

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

/**
 * Snapshot every file under `root` as `relpath -> sha256(size + content)`.
 * Used to prove the doctor never mutates the tree it inventories.
 */
function snapshotTree(root: string): Map<string, string> {
  const snap = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        snap.set(path.relative(root, full), `symlink:${fs.readlinkSync(full)}`);
        continue;
      }
      if (entry.isDirectory()) {
        snap.set(path.relative(root, full) + "/", "dir");
        walk(full);
        continue;
      }
      if (entry.isFile()) {
        const buf = fs.readFileSync(full);
        const h = createHash("sha256").update(buf).digest("hex");
        snap.set(path.relative(root, full), `${buf.length}:${h}`);
      }
    }
  };
  walk(root);
  return snap;
}

describe("nexus doctor CLI", () => {
  let nexusHome: string;
  let legacyHome: string;

  beforeAll(() => {
    // The CLI imports the compiled module; build it once if missing so the
    // test is self-sufficient outside the build-then-test gate.
    if (!fs.existsSync(DOCTOR_ARTIFACT)) {
      const build = spawnSync("npm", ["run", "build"], {
        cwd: REPO_ROOT,
        shell: process.platform === "win32",
        stdio: "ignore",
        timeout: 180_000,
      });
      if (build.status !== 0) {
        throw new Error("doctor-cli.test: `npm run build` failed; cannot exercise the CLI.");
      }
    }

    nexusHome = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-doctor-home-"));
    legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-doctor-legacy-"));

    // Seed stale state the doctor should surface.
    fs.writeFileSync(
      path.join(nexusHome, "migrated-from-gemma-code.txt"),
      "migrated\n",
      "utf8",
    );
    fs.mkdirSync(path.join(nexusHome, "cache"), { recursive: true });
    fs.writeFileSync(path.join(nexusHome, "cache", "blob.bin"), "x".repeat(4096), "utf8");
    fs.mkdirSync(path.join(nexusHome, "memory"), { recursive: true });
    fs.writeFileSync(path.join(nexusHome, "memory", "rows.jsonl"), '{"id":1}\n', "utf8");
    // A real legacy ~/.gemma-code/ directory (the warn-level finding).
    fs.writeFileSync(path.join(legacyHome, "old.db"), "legacy-bytes", "utf8");
  }, 200_000);

  afterAll(() => {
    if (nexusHome) fs.rmSync(nexusHome, { recursive: true, force: true });
    if (legacyHome) fs.rmSync(legacyHome, { recursive: true, force: true });
  });

  it("renders the inventory sections against the fixture home", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runDoctor(
      { home: nexusHome, "legacy-home": legacyHome, "skills-root": path.join(nexusHome, "no-skills") },
      stdout,
      stderr,
    );

    expect(code).toBe(0);
    expect(stdout.text).toContain("nexus doctor -- stale-state inventory");
    expect(stdout.text).toContain("## legacy-state");
    expect(stdout.text).toContain("Legacy ~/.gemma-code/ data root still present");
    expect(stdout.text).toContain("## migration-marker");
    expect(stdout.text).toContain("## stale-cache");
    expect(stdout.text).toContain("## memory-state");
    expect(stdout.text).toContain("Summary:");
    // Without --migration-report, the renderer hints at the fuller pass.
    expect(stdout.text).toContain("Re-run with --migration-report");
    expect(stderr.text).toBe("");
  });

  it("emits machine-readable JSON under --json with the expected shape", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runDoctor(
      { home: nexusHome, "legacy-home": legacyHome, "skills-root": path.join(nexusHome, "no-skills"), json: true },
      stdout,
      stderr,
    );

    expect(code).toBe(0);
    const report = JSON.parse(stdout.text);
    expect(report.nexusHome).toBe(nexusHome);
    expect(report.legacyGemmaHome).toBe(legacyHome);
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.total).toBeGreaterThan(0);
    const categories = new Set(report.findings.map((f: { category: string }) => f.category));
    expect(categories.has("legacy-state")).toBe(true);
    expect(categories.has("stale-cache")).toBe(true);
    expect(categories.has("memory-state")).toBe(true);
    // A real legacy dir is a warning.
    expect(report.summary.warn).toBeGreaterThan(0);
  });

  it("--migration-report widens detail to include paths and suggestions", async () => {
    const stdout = captureStream();
    const code = await runDoctor(
      {
        home: nexusHome,
        "legacy-home": legacyHome,
        "skills-root": path.join(nexusHome, "no-skills"),
        "migration-report": true,
      },
      stdout,
      captureStream(),
    );

    expect(code).toBe(0);
    expect(stdout.text).toContain("path:");
    expect(stdout.text).toContain("suggestion:");
    expect(stdout.text).not.toContain("Re-run with --migration-report");
  });

  it("never mutates the inventoried trees (read-only contract)", async () => {
    const beforeNexus = snapshotTree(nexusHome);
    const beforeLegacy = snapshotTree(legacyHome);

    await runDoctor(
      {
        home: nexusHome,
        "legacy-home": legacyHome,
        "skills-root": path.join(nexusHome, "no-skills"),
        "migration-report": true,
      },
      captureStream(),
      captureStream(),
    );

    expect(snapshotTree(nexusHome)).toEqual(beforeNexus);
    expect(snapshotTree(legacyHome)).toEqual(beforeLegacy);
  });
});
