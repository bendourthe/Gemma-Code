import { describe, it, expect } from "vitest";
import {
  renderSkillBlock,
  renderSkillBlockWithinBudget,
} from "../../../../core/skills/SkillRenderLine.js";
import { tokenize } from "../../../../core/observability/TokenCost.js";
import type { Skill } from "../../../../core/skills/SkillCatalog.js";

const HASH = "0".repeat(64);

function skill(over: Partial<Skill> & Pick<Skill, "id" | "path">): Skill {
  return {
    displayName: over.displayName ?? over.id,
    category: "test",
    provenance: { source: "builtin", contentHash: HASH },
    frontmatter: {},
    body: `# ${over.id}\n`,
    ...over,
  };
}

describe("renderSkillBlockWithinBudget -- full rung", () => {
  it("returns the unchanged full block when it fits the budget", () => {
    const skills = [
      skill({ id: "a", path: "/r/a/SKILL.md", frontmatter: { description: "Alpha." } }),
      skill({ id: "b", path: "/r/b/SKILL.md", frontmatter: { description: "Beta." } }),
    ];
    const res = renderSkillBlockWithinBudget(skills, 10_000);
    expect(res.rung).toBe("full");
    expect(res.omittedCount).toBe(0);
    expect(res.lines).toBe(renderSkillBlock(skills));
  });

  it("treats an empty catalog as a (trivially) full render", () => {
    const res = renderSkillBlockWithinBudget([], 0);
    expect(res.rung).toBe("full");
    expect(res.omittedCount).toBe(0);
    expect(res.lines).toBe("");
  });
});

describe("renderSkillBlockWithinBudget -- truncated rung", () => {
  it("equally truncates descriptions to fit and stays within budget", () => {
    const skills = [
      skill({
        id: "alpha",
        path: "/r/alpha/SKILL.md",
        frontmatter: { description: "Alpha summary. " + "x".repeat(300) },
      }),
      skill({
        id: "bravo",
        path: "/r/bravo/SKILL.md",
        frontmatter: { description: "Bravo summary. " + "y".repeat(300) },
      }),
    ];
    const full = tokenize(renderSkillBlock(skills));
    const skeleton = skills.map((s) => `- ${s.id}:  (file: ${s.path})`).join("\n");
    const budget = tokenize(skeleton) + 40; // room for truncated descriptions, well below `full`
    expect(budget).toBeLessThan(full);

    const res = renderSkillBlockWithinBudget(skills, budget);
    expect(res.rung).toBe("truncated");
    expect(res.omittedCount).toBe(0);
    expect(tokenize(res.lines)).toBeLessThanOrEqual(budget);
    // Both skills survive (no omission), and their ids + paths stay intact.
    expect(res.lines).toContain("- alpha:");
    expect(res.lines).toContain("(file: /r/alpha/SKILL.md)");
    expect(res.lines).toContain("- bravo:");
    // The long filler is dropped by truncation.
    expect(res.lines).not.toContain("xxxxxxxxxx");
  });

  it("prefers a clean first-sentence break when it fits the per-line budget", () => {
    const s = skill({
      id: "auditor",
      path: "/r/auditor/SKILL.md",
      frontmatter: {
        description: "Audit the skill catalog. " + "z".repeat(400),
      },
    });
    const skeleton = `- ${s.id}:  (file: ${s.path})`;
    const budget = tokenize(skeleton) + 12;

    const res = renderSkillBlockWithinBudget([s], budget);
    expect(res.rung).toBe("truncated");
    expect(res.lines).toContain("Audit the skill catalog.");
    expect(res.lines).not.toContain("zzz");
    expect(tokenize(res.lines)).toBeLessThanOrEqual(budget);
  });
});

describe("renderSkillBlockWithinBudget -- omitted rung", () => {
  it("drops devai-hub before user before builtin until the remainder fits", () => {
    // Equal-length ids + paths so every line tokenizes to the same cost; a
    // one-line budget then forces dropping all but the highest-priority source.
    const builtin = skill({
      id: "skill-bb",
      path: "/r/skill-bb/SKILL.md",
      frontmatter: { description: "x" },
    });
    const user = skill({
      id: "skill-uu",
      path: "/r/skill-uu/SKILL.md",
      provenance: { source: "user", contentHash: HASH },
      frontmatter: { description: "x" },
    });
    const hub = skill({
      id: "skill-hh",
      path: "/r/skill-hh/SKILL.md",
      provenance: { source: "devai-hub", contentHash: HASH },
      frontmatter: { description: "x" },
    });
    const budget = tokenize(renderSkillBlock([builtin])); // exactly one full line

    const res = renderSkillBlockWithinBudget([builtin, user, hub], budget);
    expect(res.rung).toBe("omitted");
    expect(res.omittedCount).toBe(2);
    expect(tokenize(res.lines)).toBeLessThanOrEqual(budget);
    // The highest-priority (builtin) skill survives; the other two are dropped.
    expect(res.lines).toContain("skill-bb");
    expect(res.lines).not.toContain("skill-uu");
    expect(res.lines).not.toContain("skill-hh");
  });

  it("drops everything when even one line cannot fit, converging to an empty block", () => {
    const skills = [
      skill({ id: "a", path: "/r/a/SKILL.md", frontmatter: { description: "A".repeat(50) } }),
      skill({ id: "b", path: "/r/b/SKILL.md", frontmatter: { description: "B".repeat(50) } }),
    ];
    const res = renderSkillBlockWithinBudget(skills, 1);
    expect(res.rung).toBe("omitted");
    expect(res.omittedCount).toBe(skills.length);
    expect(res.lines).toBe("");
  });
});
