import { describe, it, expect } from "vitest";
import {
  auditSkills,
  formatAuditReport,
  UNUSED_FRAMING,
} from "../../../../core/skills/SkillAuditor.js";
import { InMemorySkillCatalog, type Skill } from "../../../../core/skills/SkillCatalog.js";
import { InMemoryModelRegistry } from "../../../../core/registry/ModelRegistry.js";
import type { SkillUsage } from "../../../../core/skills/SkillUsageScanner.js";

const HASH = "0".repeat(64);

function skill(over: Partial<Skill> & Pick<Skill, "id" | "path">): Skill {
  return {
    displayName: over.displayName ?? over.id,
    category: "test",
    provenance: { source: "builtin", contentHash: HASH },
    frontmatter: {},
    // A distinct, low-overlap body per skill so the default fixture produces no
    // spurious similarity pairs; tests that exercise the similarity detector
    // supply their own near-duplicate bodies.
    body: `# ${over.id}\n`,
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

describe("auditSkills -- defaults with no similarity or usage input", () => {
  it("reports no similar pairs and no unused candidates for the distinct-body fixture", async () => {
    const report = await auditSkills({ catalog: fixtureCatalog() });
    // Distinct per-skill bodies stay below the 0.85 Jaccard threshold; with no
    // skillsRoot / usage Map injected, the Unused report stays empty.
    expect(report.duplicates.bySimilarity).toEqual([]);
    expect(report.unused).toEqual([]);
  });
});

describe("auditSkills -- content-similarity duplicates (T011 / T013)", () => {
  it("populates bySimilarity for two near-duplicate bodies above threshold", async () => {
    const base =
      "This skill performs a comprehensive audit of the entire skill catalog and " +
      "produces a structured five-section report covering token budget pressure, " +
      "over-long descriptions, name collisions, content-similarity duplicates, and " +
      "skills with no recent usage evidence found in the session replay logs.";
    const catalog = new InMemorySkillCatalog([
      skill({ id: "dupe-a", path: "/skills/builtin/dupe-a/SKILL.md", body: base }),
      skill({
        id: "dupe-b",
        path: "/skills/builtin/dupe-b/SKILL.md",
        body: base + " End.",
      }),
      skill({
        id: "unrelated",
        path: "/skills/builtin/unrelated/SKILL.md",
        body: "Zebras quietly munch jungle vines while xylophones play softly nearby.",
      }),
    ]);
    const report = await auditSkills({ catalog });
    expect(report.duplicates.bySimilarity.length).toBeGreaterThanOrEqual(1);
    const pair = report.duplicates.bySimilarity[0]!;
    expect(new Set([pair.a, pair.b])).toEqual(new Set(["dupe-a", "dupe-b"]));
    expect(pair.score).toBeGreaterThanOrEqual(0.85);
  });
});

describe("auditSkills -- unused candidates (T012 / T013)", () => {
  it("lists zero-evidence skills from an injected usage map with a confidence label", async () => {
    const usage = new Map<string, SkillUsage>([
      ["seen-skill", { lastSeen: new Date("2026-05-20T00:00:00Z"), matchCount: 4 }],
      ["unused-skill", { lastSeen: null, matchCount: 0 }],
    ]);
    const report = await auditSkills({ catalog: fixtureCatalog(), usage, months: 3 });
    expect(report.unused).toHaveLength(1);
    expect(report.unused[0]!.id).toBe("unused-skill");
    expect(report.unused[0]!.lastSeen).toBeNull();
    expect(report.unused[0]!.confidence).toBe("low");
  });

  it("raises confidence for longer look-back windows", async () => {
    const usage = new Map<string, SkillUsage>([
      ["unused-skill", { lastSeen: null, matchCount: 0 }],
    ]);
    const high = await auditSkills({ catalog: fixtureCatalog(), usage, months: 12 });
    expect(high.unused[0]!.confidence).toBe("high");
  });

  it("surfaces the mandatory suggest-first framing in the rendered report", async () => {
    const usage = new Map<string, SkillUsage>([
      ["unused-skill", { lastSeen: null, matchCount: 0 }],
    ]);
    const report = await auditSkills({ catalog: fixtureCatalog(), usage });
    const md = formatAuditReport(report);
    expect(md).toContain(UNUSED_FRAMING);
    expect(md).toContain("unused-skill");
    // No imperative / destructive phrasing -- candidates only (insight I-12).
    expect(md).not.toMatch(/\bdelete \w/i);
  });
});

describe("auditSkills -- render rung diagnostic (T015)", () => {
  it("reports the `full` rung and a zero omit count under a generous budget", async () => {
    const report = await auditSkills({
      catalog: fixtureCatalog(),
      contextTokens: 1_000_000,
      budgetPercent: 100,
    });
    expect(report.budget.renderRung).toBe("full");
    expect(report.budget.renderOmittedCount).toBe(0);
  });

  it("falls to the `omitted` rung with a positive omit count under a tiny budget", async () => {
    const report = await auditSkills({
      catalog: fixtureCatalog(),
      contextTokens: 1000,
      budgetPercent: 0.1, // 1-token budget
    });
    expect(report.budget.renderRung).toBe("omitted");
    expect(report.budget.renderOmittedCount).toBeGreaterThan(0);
  });

  it("surfaces the render rung line in the formatted Skill Budget section", async () => {
    const report = await auditSkills({
      catalog: fixtureCatalog(),
      contextTokens: 1_000_000,
      budgetPercent: 100,
    });
    const md = formatAuditReport(report);
    expect(md).toContain("- Render rung: full (would drop 0 skills if rendered now)");
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
    expect(md).toContain(UNUSED_FRAMING);
  });
});
