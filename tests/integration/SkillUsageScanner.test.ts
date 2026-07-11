import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanUsage } from "../../core/skills/SkillUsageScanner.js";

/**
 * Integration test for the session-log usage scanner (T012). Builds a temp
 * skills root + sessions root and exercises all three signal tiers:
 *   - alpha  -> structured HookBus `skill.loaded` event (high fidelity)
 *   - beta   -> plain-text slug mention (medium fidelity)
 *   - gamma  -> absolute SKILL.md path mention (low fidelity)
 *   - delta  -> never referenced (matchCount 0)
 *   - omega  -> referenced only in an out-of-window log (excluded)
 */
describe("scanUsage", () => {
  let root: string;
  let skillsRoot: string;
  let sessionsRoot: string;
  const skillPaths: Record<string, string> = {};

  function writeSkill(name: string): void {
    const dir = path.join(skillsRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    fs.writeFileSync(
      file,
      `---\nname: ${name}\ndescription: Skill ${name}.\n---\n\n# ${name}\n`,
      "utf8",
    );
    skillPaths[name] = file;
  }

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-usage-"));
    skillsRoot = path.join(root, "skills");
    sessionsRoot = path.join(root, "sessions");
    fs.mkdirSync(sessionsRoot, { recursive: true });
    for (const name of ["alpha", "beta", "gamma", "delta", "omega"]) writeSkill(name);

    // (a) Structured HookBus event referencing `alpha`.
    fs.writeFileSync(
      path.join(sessionsRoot, "a.jsonl"),
      [
        JSON.stringify({ kind: "lifecycle.skill.loaded", skillId: "alpha", timestamp: "2026-05-20T10:00:00Z" }),
        JSON.stringify({ kind: "tool.call", name: "read_file" }),
      ].join("\n") + "\n",
      "utf8",
    );

    // (b) Plain-text slug mention of `beta` (and a near-miss that must NOT match).
    fs.writeFileSync(
      path.join(sessionsRoot, "b.jsonl"),
      [
        JSON.stringify({ kind: "message", text: "Let's use the beta skill here." }),
        JSON.stringify({ kind: "message", text: "Do not match beta-extended please." }),
      ].join("\n") + "\n",
      "utf8",
    );

    // (c) Absolute SKILL.md path mention of `gamma`.
    fs.writeFileSync(
      path.join(sessionsRoot, "c.jsonl"),
      JSON.stringify({ kind: "message", text: `Loaded ${skillPaths["gamma"]} into context.` }) + "\n",
      "utf8",
    );

    // Out-of-window log referencing `omega` -- mtime set ~6 months back.
    const oldLog = path.join(sessionsRoot, "old.jsonl");
    fs.writeFileSync(
      oldLog,
      JSON.stringify({ kind: "lifecycle.skill.loaded", skillId: "omega" }) + "\n",
      "utf8",
    );
    const old = new Date();
    old.setMonth(old.getMonth() - 6);
    fs.utimesSync(oldLog, old, old);
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("includes every skill in the universe, even never-referenced ones", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    expect(new Set(usage.keys())).toEqual(new Set(["alpha", "beta", "gamma", "delta", "omega"]));
  });

  it("detects a structured HookBus event (high fidelity) with its event timestamp", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    const alpha = usage.get("alpha")!;
    expect(alpha.matchCount).toBeGreaterThanOrEqual(1);
    expect(alpha.lastSeen).not.toBeNull();
    expect(alpha.lastSeen!.toISOString()).toBe("2026-05-20T10:00:00.000Z");
  });

  it("detects a plain-text slug mention but not a longer slug superstring", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    // `beta` mentioned once; `beta-extended` must not increment beta a second time.
    expect(usage.get("beta")!.matchCount).toBe(1);
  });

  it("detects an absolute SKILL.md path mention (low fidelity)", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    expect(usage.get("gamma")!.matchCount).toBe(1);
  });

  it("reports never-referenced skills with matchCount 0 and lastSeen null", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    expect(usage.get("delta")).toEqual({ lastSeen: null, matchCount: 0 });
  });

  it("excludes logs whose mtime falls outside the look-back window", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    expect(usage.get("omega")).toEqual({ lastSeen: null, matchCount: 0 });
  });

  it("includes the out-of-window log when the window is widened", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 12 });
    expect(usage.get("omega")!.matchCount).toBe(1);
  });

  it("spans multiple skill roots in one pass (gap T012.P2.C)", async () => {
    // A second root (e.g. the nexus-hub catalog) alongside the user root.
    const hubRoot = path.join(root, "nexus-hub");
    const dir = path.join(hubRoot, "sigma");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: sigma\ndescription: Skill sigma.\n---\n\n# sigma\n`,
      "utf8",
    );

    const usage = await scanUsage({
      skillsRoot: [skillsRoot, hubRoot],
      sessionsRoot,
      months: 3,
    });
    // The combined universe spans both roots.
    expect(new Set(usage.keys())).toEqual(
      new Set(["alpha", "beta", "gamma", "delta", "omega", "sigma"]),
    );
    // Usage signals still resolve against the user-root skills.
    expect(usage.get("alpha")!.matchCount).toBeGreaterThanOrEqual(1);
    expect(usage.get("sigma")).toEqual({ lastSeen: null, matchCount: 0 });
  });

  it("accepts a single string root (back-compat)", async () => {
    const usage = await scanUsage({ skillsRoot, sessionsRoot, months: 3 });
    expect(usage.has("alpha")).toBe(true);
  });
});
