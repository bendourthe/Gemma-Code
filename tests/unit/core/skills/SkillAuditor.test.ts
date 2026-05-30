import { describe, it, expect } from "vitest";
import { auditSkills, formatAuditReport } from "../../../../core/skills/SkillAuditor.js";
import { InMemorySkillCatalog, type Skill } from "../../../../core/skills/SkillCatalog.js";
import { InMemoryModelRegistry } from "../../../../core/registry/ModelRegistry.js";

const HASH = "0".repeat(64);

function skill(over: Partial<Skill> & Pick<Skill, "id" | "path">): Skill {
  return {
    displayName: over.displayName ?? over.id,
    category: "test",
    provenance: { source: "builtin", contentHash: HASH },
    frontmatter: {},
    body: "# x\n",
    ...over,
  };
}

/**
 * A small fixture catalog (8 skills): two divergent same-name skills across
 * the builtin + user sources, two over-long descriptions, the rest short.
 */
function fixtureCatalog(): InMemorySkillCatalog {
  const longA = "A".repeat(300);
  const longB = "B".repeat(200);
  return new InMemorySkillCatalog([
    skill({
      id: "long1",
      path: "/skills/builtin/long1/SKILL.md",
      frontmatter: { description: longA },
    }),
    skill({
      id: "long2",
      path: "/skills/builtin/long2/SKILL.md",
      frontmatter: { description: longB },
    }),
    skill({
      id: "short1",
      path: "/skills/builtin/short1/SKILL.md",
      frontmatter: { description: "Hi." },
    }),
    skill({
      id: "short2",
      path: "/skills/builtin/short2/SKILL.md",
      frontmatter: { description: "Yo." },
    }),
    // Divergent pair: same displayName across two sources -> diverged.
    skill({
      id: "dup-skill",
      displayName: "Dup Skill",
      path: "/skills/builtin/dup-skill/SKILL.md",
      frontmatter: { description: "Builtin variant." },
    }),
    skill({
      id: "user/dup-skill",
      displayName: "Dup Skill",
      path: "/skills/user/dup-skill/SKILL.md",
      provenance: { source: "user", contentHash: HASH },
      frontmatter: { description: "User variant." },
    }),
    skill({
      id: "user/notes",
      displayName: "Notes",
      path: "/skills/user/notes/SKILL.md",
      provenance: { source: "user", contentHash: HASH },
      frontmatter: { description: "Take notes." },
    }),
    skill({
      id: "devai-hub/research",
      displayName: "Research",
      path: "/skills/devai-hub/v1/research/SKILL.md",
      provenance: { source: "devai-hub", contentHash: HASH },
      frontmatter: { description: "Do research." },
    }),
  ]);
}

describe("auditSkills -- budget math", () => {
  it("derives budgetTokens from contextTokens * budgetPercent and a faithful pressurePct", async () => {
    const report = await auditSkills({
      catalog: fixtureCatalog(),
      contextTokens: 1000,
      budgetPercent: 10,
    });
    expect(report.budget.contextTokens).toBe(1000);
    expect(report.budget.budgetTokens).toBe(100); // floor(1000 * 0.10)
    expect(report.budget.usedTokens).toBeGreaterThan(0);
    const expectedPressure =
      Math.round((report.budget.usedTokens / 100) * 100 * 100) / 100;
    expect(report.budget.pressurePct).toBe(expectedPressure);
  });

  it("defaults to a 2% budget and the model registry's active context window", async () => {
    const registry = new InMemoryModelRegistry();
    registry.setActiveModel("gemma4:e4b"); // contextWindow 128_000
    const report = await auditSkills({ catalog: fixtureCatalog(), modelRegistry: registry });
    expect(report.budget.contextTokens).toBe(128_000);
    expect(report.budget.budgetTokens).toBe(2_560); // floor(128_000 * 0.02)
  });

  it("guards against a zero budget without producing NaN", async () => {
    const report = await auditSkills({
      catalog: fixtureCatalog(),
      contextTokens: 1000,
      budgetPercent: 0,
    });
    expect(report.budget.budgetTokens).toBe(0);
    expect(report.budget.pressurePct).toBe(0);
  });
});

describe("auditSkills -- description candidates", () => {
  it("ranks over-long lines descending and excludes short ones", async () => {
    const report = await auditSkills({
      catalog: fixtureCatalog(),
      maxDescriptionTokens: 20,
    });
    const ids = report.descriptions.map((d) => d.id);
    expect(ids).toContain("long1");
    expect(ids).toContain("long2");
    expect(ids).not.toContain("short1");
    expect(ids).not.toContain("short2");
    // Descending by lineTokens (300-char description outranks the 200-char one).
    expect(report.descriptions[0]!.id).toBe("long1");
    expect(report.descriptions[0]!.lineTokens).toBeGreaterThan(
      report.descriptions[1]!.lineTokens,
    );
  });
});

describe("auditSkills -- name duplicates", () => {
  it("detects same-name skills across two sources via the diverged flag", async () => {
    const report = await auditSkills({ catalog: fixtureCatalog() });
    expect(report.duplicates.byName).toHaveLength(1);
    expect(report.duplicates.byName[0]!.name).toBe("Dup Skill");
    expect(report.duplicates.byName[0]!.sources).toEqual(["builtin", "user"]);
  });
});

describe("auditSkills -- root summary", () => {
  it("rolls skills up by provenance source in precedence order", async () => {
    const report = await auditSkills({ catalog: fixtureCatalog() });
    const bySource = new Map(report.roots.map((r) => [r.source, r]));
    expect(report.roots.map((r) => r.source)).toEqual(["builtin", "user", "devai-hub"]);
    expect(bySource.get("builtin")!.skillCount).toBe(5);
    expect(bySource.get("user")!.skillCount).toBe(2);
    expect(bySource.get("devai-hub")!.skillCount).toBe(1);
    expect(bySource.get("builtin")!.root).toBe("/skills/builtin");
  });
});

describe("auditSkills -- phase 4 placeholders", () => {
  it("leaves similarity and unused empty until phase 4 wires them", async () => {
    const report = await auditSkills({ catalog: fixtureCatalog() });
    expect(report.duplicates.bySimilarity).toEqual([]);
    expect(report.unused).toEqual([]);
  });
});

describe("formatAuditReport", () => {
  it("renders the five canonical section headings in order", async () => {
    const report = await auditSkills({ catalog: fixtureCatalog() });
    const md = formatAuditReport(report);
    const headings = [
      "## Skill Budget",
      "## Description candidates",
      "## Duplicates",
      "## Unused candidates",
      "## Root summary",
    ];
    let cursor = 0;
    for (const h of headings) {
      const idx = md.indexOf(h, cursor);
      expect(idx, `expected heading "${h}" after index ${cursor}`).toBeGreaterThanOrEqual(0);
      cursor = idx + h.length;
    }
    expect(md).toContain("### By similarity");
    expect(md).toContain("_(populated by phase 4)_");
  });
});
