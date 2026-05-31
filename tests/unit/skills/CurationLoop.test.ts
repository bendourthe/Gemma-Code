import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CurationLoop,
  describeManifest,
  listMissingFrontmatterFields,
  makeStaticInputs,
} from "../../../modules/coding/skills/CurationLoop.js";
import { SkillMetrics } from "../../../modules/coding/skills/SkillMetrics.js";

describe("CurationLoop", () => {
  let tmpDir: string;
  let metricsPath: string;
  let manifestDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-curator-"));
    metricsPath = path.join(tmpDir, "metrics.json");
    manifestDir = path.join(tmpDir, "curator");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeMetrics(): SkillMetrics {
    return new SkillMetrics(metricsPath, null, () => 1_700_000_000_000);
  }

  it("dry-run proposes stale-skill actions when metrics show no invocations", async () => {
    const metrics = makeMetrics();
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({ skills: ["unused-1", "unused-2"] }),
      manifestDir,
      true,
      () => 1_700_000_000_000,
    );
    const manifest = await loop.dryRun();
    expect(manifest.actions.length).toBe(2);
    for (const action of manifest.actions) {
      expect(action.type).toBe("archive-stale-skill");
    }
    expect(fs.existsSync(manifest.manifestPath)).toBe(true);
  });

  it("dry-run is idempotent in content (different IDs but same actions)", async () => {
    const metrics = makeMetrics();
    let nowCounter = 1_700_000_000_000;
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({ skills: ["a"] }),
      manifestDir,
      true,
      () => nowCounter,
    );
    const first = await loop.dryRun();
    nowCounter += 60_000;
    const second = await loop.dryRun();
    expect(first.id).not.toBe(second.id);
    expect(first.actions.length).toBe(second.actions.length);
    expect(first.actions[0]!.target).toBe(second.actions[0]!.target);
    expect(first.actions[0]!.type).toBe(second.actions[0]!.type);
  });

  it("apply writes a rollback manifest", async () => {
    const metrics = makeMetrics();
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({ skills: ["a"] }),
      manifestDir,
      true,
      () => 1_700_000_000_000,
    );
    const manifest = await loop.dryRun();
    const result = await loop.apply(manifest.id);
    expect(fs.existsSync(result.rollbackPath)).toBe(true);
    expect(result.actionsExecuted).toBe(manifest.actions.length);

    const rolled = await loop.rollback(result.rollbackId);
    expect(rolled.actionsReverted).toBe(manifest.actions.length);
  });

  it("apply throws when the manifest id is unknown", async () => {
    const metrics = makeMetrics();
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({ skills: [] }),
      manifestDir,
      true,
    );
    await expect(loop.apply("does-not-exist")).rejects.toThrow();
  });

  it("proposes consolidation actions when duplicates are reported", async () => {
    const metrics = makeMetrics();
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({
        duplicates: [{ keep: "row-A", remove: "row-B", similarity: 0.97 }],
      }),
      manifestDir,
      true,
      () => 1_700_000_000_000,
    );
    const manifest = await loop.dryRun();
    const dedup = manifest.actions.find(
      (a) => a.type === "consolidate-duplicate-memory-entries",
    );
    expect(dedup).toBeDefined();
    expect(dedup?.target).toBe("row-B");
    expect((dedup?.payload as { similarity: number }).similarity).toBeCloseTo(0.97);
  });

  it("proposes frontmatter patches for skills missing v0.8.0 fields", async () => {
    const skillDir = path.join(tmpDir, "skill-A");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: skill-A\ndescription: test\n---\n\nbody",
    );
    const metrics = makeMetrics();
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({
        skills: ["skill-A"],
        resolveSkillSkillMdPath: (n) =>
          n === "skill-A" ? path.join(skillDir, "SKILL.md") : null,
      }),
      manifestDir,
      true,
      () => 1_700_000_000_000,
    );
    const manifest = await loop.dryRun();
    const patch = manifest.actions.find((a) => a.type === "patch-skill-frontmatter");
    expect(patch).toBeDefined();
    expect(patch?.target).toBe("skill-A");
  });

  it("listMissingFrontmatterFields reports each missing field", () => {
    const content = "---\nname: x\ndescription: y\n---\n";
    expect(listMissingFrontmatterFields(content)).toEqual(["version", "platforms"]);
  });

  it("describeManifest summarises action counts", async () => {
    const metrics = makeMetrics();
    const loop = new CurationLoop(
      metrics,
      makeStaticInputs({
        skills: ["a", "b"],
        duplicates: [{ keep: "x", remove: "y", similarity: 0.99 }],
      }),
      manifestDir,
      true,
      () => 1_700_000_000_000,
    );
    const manifest = await loop.dryRun();
    const desc = describeManifest(manifest);
    expect(desc).toContain("archive-stale-skill");
    expect(desc).toContain("consolidate-duplicate-memory-entries");
  });
});
