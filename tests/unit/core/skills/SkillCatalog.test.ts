import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemorySkillCatalog,
  type Skill,
} from "../../../../core/skills/SkillCatalog.js";

const SAMPLE: readonly Skill[] = [
  {
    id: "writing-editing",
    displayName: "Writing and Editing",
    category: "developer-experience",
    path: "/skills/writing-editing/SKILL.md",
    frontmatter: { name: "writing-editing" },
    body: "# Writing\n",
  },
  {
    id: "devai-hub/skill-eval-loop",
    displayName: "Skill Eval Loop",
    category: "workflow",
    path: "/skills/devai-hub/skill-eval-loop/SKILL.md",
    frontmatter: { name: "skill-eval-loop" },
    body: "# Eval\n",
  },
];

describe("InMemorySkillCatalog", () => {
  let catalog: InMemorySkillCatalog;
  beforeEach(() => {
    catalog = new InMemorySkillCatalog(SAMPLE);
  });

  it("list() returns id/display/category records (no body)", () => {
    const records = catalog.list();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual([
      "writing-editing",
      "devai-hub/skill-eval-loop",
    ]);
    expect((records[0] as { body?: string }).body).toBeUndefined();
  });

  it("load() returns the full skill including frontmatter and body", async () => {
    const skill = await catalog.load("writing-editing");
    expect(skill.frontmatter).toEqual({ name: "writing-editing" });
    expect(skill.body).toBe("# Writing\n");
  });

  it("load() throws for an unknown id", async () => {
    await expect(catalog.load("nope")).rejects.toThrow(/unknown skill id nope/);
  });

  it("namespaced devai-hub/<name> ids are first-class", () => {
    const records = catalog.list();
    expect(records.some((r) => r.id.startsWith("devai-hub/"))).toBe(true);
  });

  it("reload() resolves and may be a no-op", async () => {
    await expect(catalog.reload()).resolves.toBeUndefined();
  });

  it("resetForTesting() swaps the entire catalogue", () => {
    catalog.resetForTesting([SAMPLE[0]!]);
    expect(catalog.list()).toHaveLength(1);
  });

  it("default constructor yields an empty catalogue", () => {
    const empty = new InMemorySkillCatalog();
    expect(empty.list()).toEqual([]);
  });
});
